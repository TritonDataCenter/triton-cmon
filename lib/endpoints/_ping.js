/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

// jsl:ignore
'use strict';
// jsl:end

var mod_assert = require('assert-plus');



/**
 * GET /_ping
 */
function ping(req, res, next) {
    var body = 'OK';
    res.writeHead(200, {
        'Content-Length': Buffer.byteLength(body),
        'Content-Type': 'text/plain; charset=utf-8'
    });
    res.write(body);
    res.end();
    next();
}



/**
 * Register all endpoints with the restify server
 */
function mount(opts) {
    mod_assert.object(opts.server, 'opts.server');
    opts.server.get({ path: /^(\/v[^\/]+)?\/_ping$/, name: 'Ping' }, ping);
}

module.exports = { mount: mount };
