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

function fetchAndSendMetrics(req, res, req2, next) {
    req2.on('result', function _fetchMetrics(err2, res2) {
        if (err2) {
            req.log.error(err2, 'Error fetching metrics');
            next(new lib_errors.InternalServerError());
            return;
        }

        // Let the client know about 'Content-Encoding'.
        var encoding;
        if ((encoding = res2.header('Content-Encoding'))) {
            res.header('Content-Encoding', encoding);
        }

        res.header('content-type', 'text/plain');

        var data = [];
        res2.on('data', function _onData(chunk) {
            data.push(chunk);
        }).on('end', function _onEnd() {
            var buffer = Buffer.concat(data);
            res.end(buffer);
            next();
        });
    });
}

function apiGetMetrics(req, res, next) {
    var serverCacheItem, admin_ip, cmon_agent_url, cmon_agent_path, client;

    var target_uuid = req.header('HOST').split('.')[0];
    var cache = req.app.cache;
    var config = req.app.config;

    mod_assert.object(cache, 'cache object');
    mod_assert.object(config, 'config object');

    var encoding;
    var headers = {};
    var server_opts = config.server_opts;
    /*
     * Here we check if the client has set 'Accept-Encoding' and
     * pass the header down to cmon-agent. This is mainly used to
     * tell cmon-agent to compress metrics before sending them to
     * cmon. Later on, when we get a response from cmon-agent, we
     * relay 'Content-Encoding' back to the client.
     *
     * This behavior is disabled by default. It can be enabled by
     * setting HTTP_ACCEPT_ENCODING to 'enabled' in SAPI.
     */
    if ((encoding = req.header('Accept-Encoding')) &&
       (server_opts.http_accept_encoding === 'enabled')) {
             headers['Accept-Encoding'] = encoding;
    }

    if (cache.admin_ips.has(target_uuid)) {
        serverCacheItem = cache.admin_ips.get(target_uuid);
        mod_assert.object(serverCacheItem, 'serverCacheItem');

        admin_ip = serverCacheItem.admin_ip;
        mod_assert.string(admin_ip, 'admin_ip');

        cmon_agent_url = 'http://' + admin_ip + ':9163';
        cmon_agent_path = '/v1/gz/metrics';
        client = mod_restify.createClient({
            url: cmon_agent_url,
            headers: headers
        });
        client.get(cmon_agent_path, function _agentConnect(err, req2) {
            if (err) {
                req.log.error(err, 'Error reaching cmon-agent');
                /*
                 * This CN is either gone or having issues, so we'll remove it
                 * from the cache to prevent it from being discovered. If the CN
                 * was not decomissioned, it will be picked up on the next poll
                 * of CNAPI and re-added.
                 */
                cache.admin_ips.delete(target_uuid);
                next(new lib_errors.InternalServerError());
                return;
            }
            fetchAndSendMetrics(req, res, req2, next);
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

        /* 
         * Avoid calling cmon-agent for VMs that are not running since that 
         * will return an error anyway. Return a non-200 response code so that 
         * prometheus will set its built-in "up" metric to "0" which allows 
         * for alert rules to detect containers that are not running.
         */
        if (vmCacheItem.vm_state !== 'running') {
            req.log.info({ vm: vmCacheItem }, 
                'Not calling cmon-agent because VM is not running');
            next(new lib_errors.NotFoundError());
            return;
        }

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
        headers['x-joyent-cmon-opts'] = headerStr;

        cmon_agent_url = 'http://' + admin_ip + ':9163';
        cmon_agent_path = '/v1/' + target_uuid + '/metrics';
        client = mod_restify.createClient({
            url: cmon_agent_url,
            headers: headers
        });
        client.get(cmon_agent_path, function _onAgentConnect(err, req2) {
            if (err) {
                req.log.error(err, 'Error reaching cmon-agent');
                next(new lib_errors.InternalServerError());
                return;
            }
            fetchAndSendMetrics(req, res, req2, next);
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
