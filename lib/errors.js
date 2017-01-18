/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

// jsl:ignore
'use strict';
// jsl:end

var mod_restify = require('restify');
var mod_util = require('util');

var RestError = mod_restify.RestError;

function CMONError(obj) {
    obj.constructorOpt = this.constructor;
    RestError.call(this, obj);
}
mod_util.inherits(CMONError, RestError);

function SSLRequiredError() {
    CMONError.call(this, {
        restCode: 'SecureTransportRequired',
        statusCode: 403,
        message: 'Container Monitor requires a secure transport (SSL/TLS)'
    });
}
mod_util.inherits(SSLRequiredError, CMONError);

module.exports = {
    CMONError: CMONError,
    SSLRequiredError: SSLRequiredError,
    UnauthorizedError: mod_restify.UnauthorizedError,
    ForbiddenError: mod_restify.ForbiddenError,
    NotFoundError: mod_restify.NotFoundError,
    InternalServerError: mod_restify.InternalServerError
};
