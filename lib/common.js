/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2021 Joyent, Inc.
 */

// jsl:ignore
'use strict';
// jsl:end

var mod_assert = require('assert-plus');
var mod_restify = require('restify');
var mod_sshpk = require('sshpk');

var lib_errors = require('./errors');

var UUID_RGX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

var DEFAULT_HOST_PREFIX = 'cmon';

/*
 * Restify request handler which ensures that a request is authenticated.
 * Authentication is verified by checking the TLS certificate send in the header
 * against the Triton Mahi authentication cache.
 */
function authenticationHandler(req, res, next) {
    var peerCert = req.connection.getPeerCertificate();
    if (!peerCert || !peerCert.raw) {
        req.log.error({ cert: peerCert, certRaw: peerCert.raw }, 'No cert');
        next(new lib_errors.UnauthorizedError());
    } else {
        var cert = mod_sshpk.parseCertificate(peerCert.raw, 'x509');
        var keyId = cert.subjectKey.fingerprint('md5').toString('hex');

        /*
         * We support two kinds of certificates: the "old"-style self-signed
         * certs with subject CN = login name, where we ignore the expiration
         * on the cert and just verify the key matches one on the account;
         * and "new"-style certs which include the 'joyentCmon' X509 certificate
         * purpose.
         *
         * New-style certs get their expiry validated always, and if they're
         * not self-signed, we verify that their *issuer* is a key on the
         * account instead of the subject.
         *
         * This lets users have a separate private key just for CMON and sign
         * its certificate with their real account key.
         */
        if (cert.purposes && cert.purposes.indexOf('joyentCmon') !== -1) {
            if (cert.isExpired()) {
                req.log.error('Client certificate expired');
                next(new lib_errors.UnauthorizedError());
                return;
            }

            /* Check whether it's self-signed. */
            if (!cert.subjects[0].equals(cert.issuer)) {
                var fingerprint;
                try {
                    fingerprint = mod_sshpk.parseFingerprint(cert.issuer.cn);
                    if (fingerprint.algorithm === 'md5') {
                        keyId = fingerprint.toString('hex');
                    } else {
                        fingerprint = undefined;
                    }
                } catch (e) {
                    req.log.info({ parseErr: e }, 'Client cert issuer invalid');
                }
                /*
                 * If it isn't self-signed, we have to be able to locate the
                 * real account key that signed it. If the CN= didn't have a
                 * valid fingerprint in it, bail out here.
                 */
                if (fingerprint === undefined) {
                    next(new lib_errors.UnauthorizedError());
                    return;
                }
            }
        }
        var cn = cert.subjects[0].cn;
        req.app.mahi.getAccount(cn, function handleMahiAccount(err, acct) {
            if (err) {
                req.log.error({ mahiAcctErr: err }, 'Error getting acct');
                next(new lib_errors.UnauthorizedError());

            } else if (!acct.account.keys || acct.account.keys[keyId]) {
                var path = '/roles?account=' + cn + '&role=administrator';
                req.app.mahi._get(path, function mahierr(merr, info) {
                    if (merr || info.role === undefined) {
                        req.log.error({ keyId: keyId },
                            'Key not present on account');
                        next(new lib_errors.UnauthorizedError());
                        return;
                    }
                    var found = false;
                    for (var uuid in info.role.members) {
                        var keys = info.role.members[uuid].keys;
                        if (keys && keys[keyId]) {
                            var mkey = mod_sshpk.parseKey(keys[keyId]);
                            if (cert.isSignedByKey(mkey)) {
                                found = true;
                                break;
                            }
                        }
                    }
                    if (found) {
                        req.account = acct.account;
                        next();
                    } else {
                        req.log.error({ keyId: keyId },
                            'Key not present on account');
                        next(new lib_errors.UnauthorizedError());
                    }
                });

            } else {
                var key = mod_sshpk.parseKey(acct.account.keys[keyId]);
                /*
                 * Note that this works in both the self-signed and non-self-
                 * signed cases -- in both of them the cert they gave us has
                 * to be validly signed by the account key.
                 */
                if (cert.isSignedByKey(key)) {
                    req.account = acct.account;
                    next();
                } else {
                    next(new lib_errors.UnauthorizedError());
                }
            }
        });
    }
}

/*
 * Restify request handler which ensures that a request is authorized to access
 * resource at the specified URI. This is achieved by checking our local cache
 * (which is kept up to date by listening to changefeed events) for the
 * presence of the authenticated user. In the case of a request for a specific
 * VM, the cache is also checked for the prescence of the requested VM in the
 * users vms list.
 *
 * This function must be applied *after* the authenticationHandler function
 */
function authorizationHandler(req, res, next) {
    req.log.trace({ requestAcct: req.account }, 'Current request account');

    mod_assert.object(req.account);
    mod_assert.uuid(req.account.uuid);
    mod_assert.string(req.account.login);

    /* req.username is set for the restify throttle plugin */
    req.username = req.account.login;

    var account_uuid = req.account.uuid;
    var cache = req.app.cache;
    var isOperator = req.account.isOperator;

    mod_assert.object(cache, 'cache object');

    /* base URI is being called by an authenticated user */
    if (req.host_prefix === DEFAULT_HOST_PREFIX) {
        next();
    } else if (cache.owners.has(account_uuid)) {
        var accountVms = cache.owners.get(account_uuid).vms;
        /* vm specific URI is being called */
        if (accountVms.has(req.host_prefix)) {
            next();
        } else if (isOperator && cache.admin_ips.has(req.host_prefix)) {
            /* authenticated operator user is asking for CN metrics */
            next();
        } else {
            /*
             * This is an authenticated user asking for a VM they do not own. In
             * order to make it a bit harder to map existing accounts and vms,
             * we intentionally return a 404 instead of a 403 or 401.
             */
            next(new lib_errors.NotFoundError());
        }
    } else {
        next(new lib_errors.NotFoundError());
    }
}

/*
 * Returns a handler that will log uncaught exceptions properly
 */
function uncaughtHandler(req, res, route, err) {
    res.send(new mod_restify.InternalError(err, 'Internal error'));
    /**
     * We don't bother logging the `res` here because it always looks like
     * the following, no added info to the log.
     *
     *      HTTP/1.1 500 Internal Server Error
     *      Content-Type: application/json
     *      Content-Length: 51
     *      Date: Wed, 29 Oct 2014 17:33:02 GMT
     *      x-request-id: a1fb11c0-5f91-11e4-92c7-3755959764aa
     *      x-response-time: 9
     *      Connection: keep-alive
     *
     *      {"code":"InternalError","message":"Internal error"}
     */
    req.log.error({err: err, route: route && route.name,
        req: req}, 'Uncaught exception');
}

/*
 * Restify request handler which requires SSL to be used
 */
function enforceSSLHandler(req, res, next) {
    if (!req.isSecure()) {
        next(new lib_errors.SSLRequiredError());
    } else {
        next();
    }
}

/*
 * Restify request handler which enforces that only valid HOST headers are
 * allowed in a request.
 *
 * Valid HOST headers contain a HOST prefixed with 'cmon.' or a VM uuid.
 */
function enforceHostHandler(req, res, next) {
    var host = req.header('HOST');
    if (!host) {
        next(new lib_errors.NotFoundError());
        return;
    }

    var prefix = host.toLowerCase().split('.')[0];
    if (prefix === 'cmon' || UUID_RGX.test(prefix)) {
        req.host_prefix = prefix;
        next();
    } else {
        next(new lib_errors.NotFoundError());
    }
}

/*
 * Takes a vm object, validates it, applies a source property, and maps it to a
 * new simplified vm object with only the necessary properites set.
 *
 * If a vm object cannot be validated, this function will return an error object
 * with a string describing the property or properties which could not be
 * validated. Additionally in an error case, mappedVm will be undefined.
 */
function mapVm(vm, source, cb) {
    var err;
    var mappedVm;

    if (!(typeof (vm) === 'object')) {
        err = new Error('vm must be an object');
    } else if (!(typeof (vm.server_uuid) === 'string')) {
        err = new Error('vm.server_uuid must be a string');
    } else if (!(typeof (source) === 'string')) {
        err = new Error('source must be a string');
    } else if (vm.alias && !(typeof (vm.alias) === 'string')) {
        err = new Error('vm.alias must be a string');
    } else if (vm.brand && !(typeof (vm.brand) === 'string')) {
        err = new Error('vm.brand must be a string');
    } else if (vm.image_uuid && !(typeof (vm.image_uuid) === 'string')) {
        err = new Error('vm.image_uuid must be a string');
    } else if (!(typeof (vm.owner_uuid) === 'string')) {
        err = new Error('vm.owner_uuid must be a string');
    } else if (!(typeof (vm.uuid) === 'string')) {
        err = new Error('vm.uuid must be a string');
    } else {
        var cmon_groups_str = vm.tags['triton.cmon.groups'];
        var cmon_groups = [];
        if (cmon_groups_str && cmon_groups_str.length > 0) {
            cmon_groups = cmon_groups_str.split(',');
        }

        /*
         * The has_core_tag field is used when determining how to set the
         * x-joyent-cmon-opts header in the apiGetMetrics function in
         * lib/endpoints/metrics.js.
         *
         * If has_core_tag is true AND the zone belongs to an
         * operator (which we determine in apiGetMetrics using the account data
         * from mahi), the isCoreZone field of the header payload is set to
         * true.
         */
        var has_core_tag = false;
        if (vm.tags['smartdc_role'] || vm.tags['manta_role']) {
            if (vm.tags['smartdc_role'] && vm.tags['smartdc_role'] === 'nat') {
                err = new Error('do not cache nat zone');
            } else {
                has_core_tag = true;
            }
        }
        /*
         * record manta_role, if any, which will be joined with
         * groups during discovery if the account is poseidon
         */
        var manta_role;
        if (vm.tags['manta_role']) {
            manta_role = vm.tags['manta_role'];
        }

        mappedVm =
        {
            groups: cmon_groups,
            manta_group: manta_role,
            has_core_tag: has_core_tag,
            server_uuid: vm.server_uuid,
            source: source,
            vm_alias: vm.alias,
            vm_brand: vm.brand,
            vm_image_uuid: vm.image_uuid,
            vm_owner_uuid: vm.owner_uuid,
            vm_uuid: vm.uuid
        };
    }

    cb(err, mappedVm);
}

/*
 * Validates a vm object, adds a cached_date property set to Date.now(), and
 * adds the vm to the provided cache object.
 *
 * If a vm object cannot be validated, this function will return an error object
 * with a string describing the property or properties which could not be
 * validated.
 */
function cacheVm(vm, cache, cb) {
    var err;
    if (!(typeof (vm) === 'object')) {
        err = new Error('vm must be an object');
    } else if (!(typeof (cache) === 'object')) {
        err = new Error('cache must be an object');
    } else if (!(typeof (cache.vms) === 'object')) {
        err = new Error('cache.vms must be an object');
    } else if (!(typeof (cache.owners) === 'object')) {
        err = new Error('cache.owners must be an object');
    } else if (!Array.isArray(vm.groups)) {
        err = new Error('vm.groups must be an array');
    } else if (!(typeof (vm.server_uuid) === 'string')) {
        err = new Error('vm.server_uuid must be a string');
    } else if (!(typeof (vm.source) === 'string')) {
        err = new Error('vm.source must be a string');
    } else if (vm.vm_alias && !(typeof (vm.vm_alias) === 'string')) {
        err = new Error('vm.vm_alias must be a string');
    } else if (vm.vm_brand && !(typeof (vm.vm_brand) === 'string')) {
        err = new Error('vm.vm_brand must be a string');
    } else if (vm.vm_image_uuid && !(typeof (vm.vm_image_uuid) === 'string')) {
        err = new Error('vm.vm_image_uuid must be a string');
    } else if (!(typeof (vm.vm_owner_uuid) === 'string')) {
        err = new Error('vm.vm_owner_uuid must be a string');
    } else if (!(typeof (vm.vm_uuid) === 'string')) {
        err = new Error('vm.vm_uuid must be a string');
    } else {
        vm.cached_date = Date.now();
        cache.vms.set(vm.vm_uuid, vm);

        if (!cache.owners.has(vm.vm_owner_uuid)) {
            cache.owners.set(vm.vm_owner_uuid, { vms: new Map() });
        }

        var ownerVms = cache.owners.get(vm.vm_owner_uuid).vms;
        ownerVms.set(vm.vm_uuid, vm);
    }

    cb(err);
}

module.exports = {
    authenticationHandler: authenticationHandler,
    authorizationHandler: authorizationHandler,
    cacheVm: cacheVm,
    enforceHostHandler: enforceHostHandler,
    enforceSSLHandler: enforceSSLHandler,
    mapVm: mapVm,
    uncaughtHandler: uncaughtHandler
};
