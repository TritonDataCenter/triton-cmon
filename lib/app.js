/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2022 Joyent, Inc.
 */

// jsl:ignore
'use strict';
// jsl:end

var mod_assert = require('assert-plus');
var mod_changefeed = require('changefeed');
var mod_cnapi = require('sdc-clients').CNAPI;
var mod_fs = require('fs');
var mod_lomstream = require('lomstream');
var mod_mahi = require('mahi');
var mod_os = require('os');
var mod_restify = require('restify');
var mod_vasync = require('vasync');
var mod_vmapi = require('sdc-clients').VMAPI;

var lib_common = require('./common');
var lib_endpointsPing = require('./endpoints/_ping');
var lib_endpointsDiscover = require('./endpoints/discover');
var lib_endpointsMetrics = require('./endpoints/metrics');
var lib_updater = require('./updater');

/*
 * 900000 milliseconds is 15 minutes and 15 minutes was choosen to strike a
 * balance between a tolerable delay in new CNs showing up in CMON and not
 * creating any real load on CNAPI. In theory this seems reasonable, but should
 * it become problematic in practice then it can easily be adjusted as long as
 * we are mindful of the increased load on CNAPI.
 */
var CN_POLL_INT = 900000;
var HOSTNAME = mod_os.hostname();
var MAX_TIMEOUT = 10000;
var MIN_TIMEOUT = 2000;
var RETRIES = Infinity;
var TLS_CERT = '/data/tls/cert.pem';
var TLS_KEY = '/data/tls/key.pem';

function App(opts) {
    mod_assert.object(opts, 'opts');
    mod_assert.object(opts.config, 'opts.config');
    mod_assert.object(opts.config.metricsManager, 'opts.config.metricsManager');
    mod_assert.object(opts.log, 'opts.log');

    var self = this;
    self.config = opts.config;
    self.log = opts.log;
    self.vmapi = new mod_vmapi(
        {
            url: self.config.vmapi.url,
            retry: {
                retries: RETRIES,
                minTimeout: MIN_TIMEOUT,
                maxTimeout: MAX_TIMEOUT
            },
            log: opts.log,
            agent: false
        });
    self.cnapi = new mod_cnapi(
        {
            url: self.config.cnapi.url,
            retry: {
                retries: RETRIES,
                minTimeout: MIN_TIMEOUT,
                maxTimeout: MAX_TIMEOUT
            },
            log: opts.log,
            agent: false
        });
    self.mahi = mod_mahi.createClient({ url: self.config.mahi.url });
    self.cache = { admin_ips: new Map(), owners: new Map(), vms: new Map() };

    var changefeedOpts = {
        log: self.log,
        url: self.config.vmapi.url,
        instance: self.config.changefeed_opts.instance,
        service: 'cmon',
        changeKind: {
            resource: self.config.changefeed_opts.resource,
            subResources: self.config.changefeed_opts.subResources
        },
        backoff: {
            retries: RETRIES,
            minTimeout: MIN_TIMEOUT,
            maxTimeout: MAX_TIMEOUT
        }
    };

    var cfListener = mod_changefeed.createListener(changefeedOpts);
    var updater = new lib_updater({ app: self });
    var cnapiPoller;
    var vmBootstrapper;

    function _callFetchCn(arg, lobj, datacb, cb) {
        _fetchCn(self.log, self.cnapi, arg, lobj, datacb, cb);
    }

    function _callFetchVm(arg, lobj, datacb, cb) {
        _fetchVm(self.log, self.vmapi, self.config, arg, lobj, datacb, cb);
    }

    /*
     * The changefeed mechanism will provide the admin IP and UUID of each CN
     * with >= 1 VM. However, to support discovery and polling of GZ metrics for
     * CNs that are setup but have no VMs, we need to periodically poll CNAPI.
     * Here we poll CNAPI every 15 minutes and update the cache with the
     * admin IP and UUID of CNs without VMs.
     */
    function _processCNs() {
        cnapiPoller = new mod_lomstream.LOMStream({
            fetch: _callFetchCn,
            limit: 100,
            offset: true
        });

        cnapiPoller.pipe(updater, { end: false });
        setTimeout(_processCNs, CN_POLL_INT);
    }

    _processCNs();

    /*
     * When cfListener emits bootstrap, we initialize a new LOMStream to fetch
     * all active VM records from VMAPI and pipe them to the updater. This
     * populates the local cache and brings the app up to date with the state of
     * the world. Once the bootstrap process is complete, and bootstrapper emits
     * end, we pipe cfListener to the updater, releasing all queued changefeed
     * items, so that it can keep the app up to date from that point forward.
     */
    cfListener.on('bootstrap', function _bootstrapBegin() {
        self.log.debug('cfListener emitted bootstrap');
        vmBootstrapper = new mod_lomstream.LOMStream({
            fetch: _callFetchVm,
            limit: 100,
            marker: _vmapiMarker
        });


        /* Pipe bootstrapper to updater, but let the app handle the end event */
        vmBootstrapper.pipe(updater, { end: false });

        /*
         * The bootstrap process has ended and updater responsibility is handed
         * to the cfListener.
         */
        vmBootstrapper.on('end', function _bootstrapEnd() {
            self.log.debug('bootstrapper emitted end');
            cfListener.pipe(updater);
        });
    });

    cfListener.on('error', function _cfListenerError() {
        mod_assert.fail('cfListener fail!');
    });

    /*
     * If our connection to the publisher ends, the bootstrap process needs to
     * start over again. Here we handle that event so that cfListener does not
     * continue feeding the updater. It will resume after bootstrap takes place.
     *
     * It is important to note that the backoff functionality in
     * changefeed will attempt to reconnect to the publisher. Once it reconnects
     * the bootstrap event will be emitted and the process will start again.
     */
    cfListener.on('connection-end', function _cfListenerConnEnd() {
        self.log.debug('cfListener emitted connection-end');
        cfListener.unpipe(updater);
    });

    cfListener.register();

    var serverOpts = {
        name: 'cmon',
        log: self.log,
        handleUpgrades: false,
        certificate: mod_fs.readFileSync(TLS_CERT),
        key: mod_fs.readFileSync(TLS_KEY),
        requestCert: true,
        rejectUnauthorized: false
    };

    var server = self.server = mod_restify.createServer(serverOpts);
    server.use(function basicResReq(req, res, next) {
        res.on('header', function onHeader() {
            var now = Date.now();
            res.header('Date', new Date());
            res.header('Server', server.name);
            res.header('x-request-id', req.getId());
            var t = now - req.time();
            res.header('x-response-time', t);
            res.header('x-server-name', HOSTNAME);
        });

        req.app = self;
        next();
    });

    server.use(mod_restify.requestLogger());
    server.use(lib_common.enforceHostHandler);
    server.use(lib_common.enforceSSLHandler);

    // We want /_ping to be unauthenticated so it has to be registered before
    // authentication.
    lib_endpointsPing.mount({ server: server });

    server.use(lib_common.authenticationHandler);
    server.use(lib_common.authorizationHandler);
    server.use(mod_restify.throttle(self.config.throttle_opts));

    server.use(mod_restify.gzipResponse());

    server.on('uncaughtException', lib_common.uncaughtHandler);

    server.on('after', function audit(req, res, route, err) {
        // Successful GET res bodies are uninteresting and *big*.
        var body = !(req.method === 'GET' &&
            Math.floor(res.statusCode / 100) === 2);

        mod_restify.auditLogger({
            log: req.log.child(
                {
                    route: route && route.name,
                    action: req.query.action
                },
                true),
            body: body
        })(req, res, route, err);
    });

    var metricsManager = self.config.metricsManager;
    server.on('after', metricsManager.collectRestifyMetrics
        .bind(metricsManager));

    lib_endpointsMetrics.mount({ server: server });
    lib_endpointsDiscover.mount({ server: server });
}

App.prototype.start = function start(cb) {
    var self = this;
    self.server.listen(
        this.config.port,
        this.config.address,
        function _logListening() {
            self.log.info({url: self.server.url}, 'listening');
            cb();
    });
};

App.prototype.close = function close(cb) {
    var self = this;
    self.server.on('close', function _handleClose() {
        cb();
    });
    self.server.close();
};

function _fetchCn(log, cnapi, arg, lobj, datacb, cb) {
    mod_assert.optionalObject(arg, 'arg');
    mod_assert.optionalFunc(datacb, 'datacb');

    var done = false;
    var cnapiFilter =
        {
            limit: lobj.limit,
            offset: lobj.offset,
            setup: true,
            extras: 'sysinfo'
        };
    var cns = [];

    cnapi.listServers(cnapiFilter, function _handleCnapiResponse(err, obj_arr) {
        /*
         * If we encounter an error talking to CNAPI we don't want to blow up
         * and take everything down. To keep everything running smoothly we
         * treat CNAPI errors as if they are the end of the result set and carry
         * on. Existing CNs will remain in cache and accessible to users. New
         * CNs will be discovered via the VM changefeed or on the next CNAPI
         * poll interval (assuming CNAPI is back up by then).
         */
        if (err) {
            done = true;
            log.error(err, '_fetchCn failed');
            cb(null, { done: done, results: cns });
            return;
        }

        if (obj_arr.length === 0) {
            done = true;
            log.debug('_fetchCn: no more results');
        }

        mod_vasync.forEachPipeline({
            'inputs': obj_arr,
            'func': function _applySourceToCn(obj, next) {
                obj.source = 'cnapiPoller';
                cns.push(obj);
                next();
            }}, function _handleForEachMapCnError(fepErr) {
                var resultObj;
                if (!fepErr) {
                    resultObj = { done: done, results: cns };
                }

                cb(fepErr, resultObj);
            });
    });
}

function _fetchVm(log, vmapi, config, arg, lobj, datacb, cb) {
    mod_assert.optionalObject(arg, 'arg');
    mod_assert.optionalFunc(datacb, 'datacb');

    var done = false;

    var vmapiFilter = {
        limit: lobj.limit
    };

    // optionally include stopped instances
    if (config.discover_include_stopped === 'true') {
        vmapiFilter.predicate = JSON.stringify({
            or: [
                { eq: ['state', 'running'] },
                { eq: ['state', 'stopped'] }
            ]
        });
    } else {
        vmapiFilter.state = 'running';
    }

    if (lobj.marker) {
        vmapiFilter.marker = lobj.marker;
    }

    var vms = [];
    vmapi.listVms(vmapiFilter, function _handleVmapiResponse(err, obj_arr) {
        mod_assert.ifError(err, 'fetchVm failed');

        if (obj_arr.length === 0) {
            done = true;
            log.debug('_fetchVm: no more results');
        }

        mod_vasync.forEachPipeline({
            'inputs': obj_arr,
            'func': function _applySourceToVm(obj, next) {
                obj.source = 'Bootstrapper';
                vms.push(obj);
                next();
            }}, function _handleForEachMapVmError(fepErr) {
                var resultObj;
                if (!fepErr) {
                    resultObj = { done: done, results: vms };
                }

                cb(fepErr, resultObj);
            });
    });
}

function _vmapiMarker(obj) {
    mod_assert.uuid(obj.uuid);
    var marker = JSON.stringify({ uuid: obj.uuid });
    return (marker);
}

module.exports = App;
