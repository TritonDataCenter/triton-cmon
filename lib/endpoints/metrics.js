/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

// jsl:ignore
'use strict';
// jsl:end

var mod_assert = require('assert-plus');
var mod_restify = require('restify');

var lib_errors = require('../errors');

// 499 is an unofficial HTTP status code used by nginx
var HTTP_CLIENT_CLOSED_REQUEST = 499;
var HTTP_INTERNAL_SERVER_ERROR = 500;

function forwardMetrics(req, res, creq, cb) {
    creq.on('result', function _processMetrics(err, cres) {
        if (err)  {
            req.log.error(err, 'Failed to fetch metrics from cmon-agent');
            cb(new lib_errors.InternalServerError());
            return;
        }

        /*
         * If the client closed the connection while we were fetching
         * metrics from cmon-agent, we need to destroy cres to avoid
         * memory leak.
         */
        if (req.__closed === true) {
            req.log.error('Client closed the connection'
                + ' while we were fetching metrics from cmon-agent');
            cres.destroy();
            res.statusCode = HTTP_CLIENT_CLOSED_REQUEST;
            cb();
        }

        res.header('content-type', 'text/plain');
        cres.pipe(res);
        res.once('end', cb);

        function abortForwardingMetrics(statusCode) {
            if (req.__aborted) {
                return;
            }
            req.__aborted = true;
            cres.unpipe(res);
            cres.destroy();
            res.statusCode = statusCode;
            cb();
        }

        /*
         * In case client closed the connection while we are
         * sending metrics.
         */
        req.on('close', function _connectionToClientClosed() {
            req.log.error('Client closed the connection'
                + ' while we are sending metrics');
            abortForwardingMetrics(HTTP_CLIENT_CLOSED_REQUEST);
        });

        /*
         * In case cmon-agent closed the connection while we are
         * sending metrics.
         */
        creq.on('close', function _connectionToCmonAgentClosed() {
            req.log.error('cmon-agent closed the connection'
                + ' while we are sending metrics');
            abortForwardingMetrics(HTTP_INTERNAL_SERVER_ERROR);
        });
    });
}

function connectToCmonAgent(req, url, path, headers, cb) {

    var client = mod_restify.createClient({ url: url, headers: headers });
    client.get(path, function _connectedToCmonAgent(err, creq) {
        if (err) {
            req.log.error(err, 'Failed to connect to cmon-agent');
            cb(new lib_errors.InternalServerError());
            return;
        }
        cb(null, creq);
    });
}

function apiGetMetrics(req, res, next) {
    var serverCacheItem, admin_ip, cmon_agent_url, cmon_agent_path;

    var target_uuid = req.header('HOST').split('.')[0];
    var cache = req.app.cache;
    mod_assert.object(cache, 'cache object');

    /*
     * Connecting to cmon-agent and fetching metrics take time. There is a
     * slim chance the client closes the connection while we are trying to
     * connect to cmon-agent. We register this handler early in order to be
     * able to detect closed connections later on.
     */
    req.on('close', function _reqClosed() {
        req.__closed = true;
    });

    if (cache.admin_ips.has(target_uuid)) {
        serverCacheItem = cache.admin_ips.get(target_uuid);
        mod_assert.object(serverCacheItem, 'serverCacheItem');

        admin_ip = serverCacheItem.admin_ip;
        mod_assert.string(admin_ip, 'admin_ip');

        cmon_agent_url = 'http://' + admin_ip + ':9163';
        cmon_agent_path = '/v1/gz/metrics';

        connectToCmonAgent(req, cmon_agent_url,
            cmon_agent_path, {}, function _connectedToCmonAgent(err, creq) {
            if (err) {
                /*
                 * This CN is either gone or having issues, so we'll remove it
                 * from the cache to prevent it from being discovered. If the CN
                 * was not decomissioned, it will be picked up on the next poll
                 * of CNAPI and re-added.
                 */
                cache.admin_ips.delete(target_uuid);
                next(err);
                return;
            }
            forwardMetrics(req, res, creq, next);
        });
    } else if (cache.vms.has(target_uuid)) {
        var vmCacheItem = cache.vms.get(target_uuid);
        mod_assert.object(vmCacheItem, 'vm cache obj');

        var server_uuid = vmCacheItem.server_uuid;
        mod_assert.uuid(server_uuid, 'server_uuid');

        serverCacheItem = cache.admin_ips.get(server_uuid);

        /*
         * If there is no admin ip entry for the CN of the given zone then the
         * CN may have previously been removed from the cache because it was not
         * responding, or it was removed from the cache because the CN itself
         * was removed from Triton.
         */
        if (!serverCacheItem) {
            req.log.error({ vm: vmCacheItem }, 'Could not find the given CN');
            next(new lib_errors.NotFoundError());
            return;
        }

        mod_assert.object(serverCacheItem, 'admin ip cache obj');

        admin_ip = serverCacheItem.admin_ip;
        mod_assert.string(admin_ip, 'admin_ip');

        var headerObj = {
            isCoreZone: vmCacheItem.has_core_tag && req.account.isOperator
        };

        // Convert header object to base64 JSON string
        var jsonStr = JSON.stringify(headerObj);
        var headerStr = Buffer.from(jsonStr, 'utf8').toString('base64');

        /*
         * Header name must match name in
         * triton-cmon-agent/lib/endpoints/metrics.js.
         */
        var headers = {
            'x-joyent-cmon-opts': headerStr
        };

        cmon_agent_url = 'http://' + admin_ip + ':9163';
        cmon_agent_path = '/v1/' + target_uuid + '/metrics';

        connectToCmonAgent(req, cmon_agent_url, cmon_agent_path,
            headers, function _connected(err, creq) {
            if (err) {
                next(err);
                return;
            }
            forwardMetrics(req, res, creq, next);
        });

    } else {
        req.log.info({ cache: cache, uuid: target_uuid}, 'target not in cache');
        next(new lib_errors.NotFoundError());
    }
}

function mount(opts) {
    mod_assert.object(opts.server, 'opts.server');
    opts.server.get({ name: 'GetMetrics', path: '/metrics' }, apiGetMetrics);
}

module.exports = { mount: mount };
