#!/usr/bin/bash
# -*- mode: shell-script; fill-column: 80; -*-
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2017 Joyent, Inc.
#

export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
set -o xtrace
set -o errexit
set -o pipefail

DEFAULT_HOSTNAME="*.triton"
PATH=/opt/local/bin:/opt/local/sbin:/usr/bin:/usr/sbin
role=cmon

function setup_tls_certificate() {
    if [[ -f /data/tls/base_key.pem && -f /data/tls/base_cert.pem ]]; then
        echo "Base TLS Certificate Exists"
    else
        echo "Generating Base TLS Certificate"
        mkdir -p /data/tls
        /opt/local/bin/openssl req -x509 -nodes -subj "/CN=$DEFAULT_HOSTNAME" \
            -newkey rsa:2048 -keyout /data/tls/base_key.pem \
            -out /data/tls/base_cert.pem -days 365
        # Remember the certificate's host name used in the cert.
        echo "$HOST" > /data/tls/hostname
    fi

    if [[ -f /data/tls/base_key.pem && -f /data/tls/base_cert.pem ]]; then
        echo "Wildcard TLS Certificate Exists"
    else
        # The generated certificates are simply for local test. We don't need to
        # generate a new cert since it won't be any more valid than the base
        # cert.
        echo "Generating Wildcard TLS Certificate"
        cp /data/tls/base_cert.pem /data/tls/wildcard_cert.pem
        cp /data/tls/base_key.pem /data/tls/wildcard_key.pem
    fi
}

# Include common utility functions (then run the boilerplate)
source /opt/smartdc/boot/lib/util.sh
CONFIG_AGENT_LOCAL_MANIFESTS_DIRS=/opt/triton/$role
sdc_common_setup

# Mount our delegate dataset at '/data'.
zfs set mountpoint=/data zones/$(zonename)/data

setup_tls_certificate

/usr/sbin/svccfg import /opt/triton/cmon/smf/manifests/cmon.xml

# Add app bin dirs to the PATH.
echo "" >>/root/.profile
echo "export PATH=\$PATH:/opt/triton/$role/build/node/bin:/opt/triton/$role/node_modules/.bin" >>/root/.profile

# Log rotation.
sdc_log_rotation_add config-agent /var/svc/log/*config-agent*.log 1g
sdc_log_rotation_add registrar /var/svc/log/*registrar*.log 1g
sdc_log_rotation_add $role /var/svc/log/*$role*.log 1g
sdc_log_rotation_setup_end

# All done, run boilerplate end-of-setup
sdc_setup_complete

exit 0
