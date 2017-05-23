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
var mod_vasync = require('vasync');

var lib_errors = require('../errors');

function apiGetCNs(req, res, next) {
    var cache = req.app.cache;
    var account = req.account;
    mod_assert.object(cache, 'cache object');
    mod_assert.uuid(account.uuid, 'account uuid');

    var payload = { cns: [] };
    mod_vasync.forEachPipeline({
        'inputs': Array.from(cache.admin_ips.keys()),
        'func': function _processCnObj(cnObj, nextCnObj) {
            var cn = { server_uuid: cnObj };
            payload.cns.push(cn);
            nextCnObj();
        }}, function _processCnObjError(fepErr) {
            if (fepErr) {
                req.app.log.error({ discoveryError: fepErr });
                next(new lib_errors.InternalServerError());
                return;
            }

            res.send(payload);
            next();
    });
}

function apiGetContainers(req, res, next) {
    var cache = req.app.cache;
    mod_assert.object(cache, 'cache object');
    mod_assert.uuid(req.account.uuid, 'account uuid');
    var payload = { containers: [] };
    var account_uuid = req.account.uuid;
    var account_is_cached = cache.owners.has(account_uuid);
    if (account_is_cached && cache.owners.get(account_uuid).vms.size !== 0) {
        var accountVms = cache.owners.get(account_uuid).vms;
        var containerArray = [];
        mod_vasync.forEachPipeline({
            'inputs': Array.from(accountVms.values()),
            'func': function _processObj(obj, nextObj) {
                var container =
                {
                    server_uuid: obj.server_uuid,
                    vm_alias: obj.vm_alias,
                    vm_image_uuid: obj.vm_image_uuid,
                    vm_uuid: obj.vm_uuid
                };
                containerArray.push(container);
                nextObj();
            }}, function _processObjError(fepErr) {
                if (fepErr) {
                    req.app.log.error({ discoveryError: fepErr });
                    next(new lib_errors.InternalServerError());
                    return;
                }

                payload.containers = Array.from(accountVms.values());
                res.send(payload);
                next();
        });
    }
}

function mount(opts) {
    mod_assert.object(opts.server, 'opts.server');
    opts.server.get(
        {
            name: 'GetContainers',
            path: '/v1/discover'
        }, apiGetContainers);
    opts.server.get(
        {
            name: 'GetCNs',
            path: '/v1/gz/discover'
        }, apiGetCNs);
}

module.exports = { mount: mount };
