/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017 Joyent, Inc.
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
var lib_endpointsDiscover = require('./endpoints/discover');
var lib_endpointsMetrics = require('./endpoints/metrics');
var lib_updater = require('./updater');

var HOSTNAME = mod_os.hostname();
var MAX_TIMEOUT = 10000;
var MIN_TIMEOUT = 2000;
var RETRIES = Infinity;
var TLS_CERT = '/data/tls/cert.pem';
var TLS_KEY = '/data/tls/key.pem';

function App(opts) {
    mod_assert.object(opts, 'opts');
    mod_assert.object(opts.config, 'opts.config');
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
    var bootstrapper;

    function _callFetch(arg, lobj, datacb, cb) {
        _fetchVm(self.log, self.vmapi, arg, lobj, datacb, cb);
    }

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
        bootstrapper = new mod_lomstream.LOMStream({
            fetch: _callFetch,
            limit: 100,
            marker: _vmapiMarker
        });

        /* Pipe bootstrapper to updater, but let the app handle the end event */
        bootstrapper.pipe(updater, { end: false });

        /*
         * The bootstrap process has ended and updater responsibility is handed
         * to the cfListener.
         */
        bootstrapper.on('end', function _bootstrapEnd() {
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
    server.use(lib_common.authenticationHandler);
    server.use(lib_common.authorizationHandler);
    server.use(mod_restify.throttle(self.config.throttle_opts));

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

function _fetchVm(log, vmapi, arg, lobj, datacb, cb) {
    mod_assert.optionalObject(arg, 'arg');
    mod_assert.optionalFunc(datacb, 'datacb');

    var done = false;
    var vmapiFilter = { limit: lobj.limit, state: 'running' };
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
            }}, function _handleForEachMapError(fepErr) {
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
