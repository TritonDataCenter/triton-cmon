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
var mod_triton_tags = require('triton-tags');
var mod_vasync = require('vasync');

var lib_errors = require('../errors');

function apiGetCNs(req, res, next) {
    var cache = req.app.cache;
    var account = req.account;
    mod_assert.object(cache, 'cache object');
    mod_assert.uuid(account.uuid, 'account uuid');

    var payload = { cns: [] };
    mod_vasync.forEachPipeline({
        'inputs': Array.from(cache.admin_ips),
        'func': function _processCnObj(cnObj, nextCnObj) {
            var server_uuid = cnObj[0];
            var cn_hostname = cnObj[1].cn_hostname;
            var cn = { server_uuid: server_uuid, server_hostname: cn_hostname };
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
    /*
     * If we're given a query parameter for groups we want to ensure it is valid
     * before doing any work.
     */
    var qGroups;
    if (req.query && req.query['groups'] !== undefined) {
        var tagVal = 'triton.cmon.groups';
        var pVal = mod_triton_tags.validateTritonTag(tagVal, req.query.groups);
        if (pVal) {
            req.app.log.error({ discoveryError: pVal });
            next(new lib_errors.BadRequestError('invalid "groups":' + pVal));
            return;
        }

        qGroups = req.query.groups.split(',');
    }

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
                    groups: obj.groups,
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

                var containers = Array.from(accountVms.values());

                // filter out VMs that have the 'triton.cmon.disable' tag set to true
                containers = containers.filter(
                    function cmonEnabled(container) {
                        return !(container.vm_tags && container.vm_tags['_triton.cmon.disable'] === 'true');
                    });

                /*
                 * If a group tag filter was specified then we remove containers
                 * from the payload that do not match the specified tag(s).
                 * Importantly, if multiple groups are supplied then we treat
                 * our criteria as a logical OR (e.g. if a container has any of
                 * the supplied groups associated with it then it is a match).
                 */
                if (qGroups) {
                    payload.containers = containers.filter(
                        function inGroup(container) {
                            var groups = container.groups;
                            /*
                             * If this is poseidon, append manta groups to the
                             * list of triton.cmon.groups for purposes of group
                             * matching.
                             * This helps significantly in scaling and sharding
                             * prometheus in large manta installations.
                             */
                            if (req.account.login === 'poseidon') {
                                groups = container.groups.concat(
                                    container.manta_group);
                            }
                            for (var i = 0; i < qGroups.length; i++) {
                                if (groups.indexOf(qGroups[i]) !== -1) {
                                    return true;
                                }
                            }

                            return false;
                        });
                } else {
                    payload.containers = containers;
                }

                res.send(payload);
                next();
        });
    } else {
        res.send(payload);
        next();
    }
}

function mount(opts) {
    mod_assert.object(opts.server, 'opts.server');
    opts.server.get(
        {
            name: 'GetContainers',
            path: '/v1/discover'
        },
        mod_restify.queryParser({allowDots: false, plainObjects: false}),
        apiGetContainers);
    opts.server.get(
        {
            name: 'GetCNs',
            path: '/v1/gz/discover'
        }, apiGetCNs);
}

module.exports = { mount: mount };
