## Installing and Configuring CMON

This procedure walks you through the process of setting up the Container
Monitoring System, or CMON. This guide is intended to cover CMON itself, and
only provides an example of setting Prometheus to monitor CMON. Adequately
scaling Prometheus, or using alternative metric collection agents is outside
the scope of this document.

This procedure assumes you have already completed the following tasks:

* Install Triton.
* Setup  and configure Triton CNS (Triton Container Name Service).
* Have the `node-triton` command line tool installed on your workstation.

## Setup the Triton Installation

This step only needs to be done one time per datacenter.

* Update to the latest sdcadm

        headnode# sdcadm self-update --latest

* Install the cmon0 zone on the headnode

        headnode# sdcadm post-setup cmon

* Validate the cmon0 instance

        headnode# sdcadm insts cmon
        INSTANCE                              SERVICE  HOSTNAME  VERSION                                     ALIAS
        fad6801f-0a6b-4c10-a0ad-18e7e6737181  cmon     headnode  release-20170316-20170315T212914Z-gd76e78a  cmon0

* Update the agents

        headnode# sdcadm experimental update-agents --latest --all
        Finding latest "agentsshar" on updates server (channel "release")
        Latest is agentsshar cd27c168-c02e-48c3-896b-32b30e800863 (1.0.0-release-20170413-20170413T073348Z-g707200f)
        Finding servers to update

        This update will make the following changes:
            Ensure core agent SAPI services exist
            Download agentsshar cd27c168-c02e-48c3-896b-32b30e800863
                (1.0.0-release-20170413-20170413T073348Z-g707200f)
            Update GZ agents on 2 (of 2) servers using
                agentsshar 1.0.0-release-20170413-20170413T073348Z-g707200f

        Would you like to continue? [y/N] Y

        Downloading agentsshar from updates server (channel "release")
            to /var/tmp/agent-cd27c168-c02e-48c3-896b-32b30e800863.sh
        Copy agentsshar to assets dir: /usbkey/extra/agents
        Create /usbkey/extra/agents/latest symlink
        Starting agentsshar update on 2 servers
        Updating node.config       [=================================>] 100%  2
        Downloading agentsshar     [=================================>] 100%  2
        Installing agentsshar      [=================================>] 100%  2
        Deleting temporary /var/tmp/agent-cd27c168-c02e-48c3-896b-32b30e800863.sh
        Reloading sysinfo on updated servers
        Sysinfo reloaded for all the running servers
        Refreshing config-agent on all the updated servers
        Config-agent refreshed on updated servers
        Successfully updated agents (3m22s)

* Validate the agents (can check HN _and_ CNs)

        headnode# tail -f $(svcs -L cmon-agent) | bunyan --color
        [2016-11-18T02:16:18.674Z]  INFO: cmon-agent/84455 on headnode: listening (url=http://10.99.99.7:9163)
        [2016-11-18T02:16:18.674Z]  INFO: cmon-agent/84455 on headnode: startup complete

## Create additional CMON instances as necessary

CMON scales horizontally. If/when you need to scale CMON for capacity, create
additional instances.

    sdcadm -s <compute_node_uuid> cmon

## Configure TLS for CMON

By default, cmon will instances will be deployed with a self-signed TLS
certificate. It's highly recomended to use [`triton-dehydrated`][td] to
generate a certificate via Let's Encrypt. You will need to create a SAN
certificate with both a hostname and wildcard name. CMON will *only* use the
DNS name configured for the external interface designated in CMON. Unlike other
Triton services, you *may not* use a CNAME. It's also *highly* recommended to
use ECDSA. RSA certificates carry a severe performance penalty due to the added
crypto overhead.

Example `domains.ecdsa.txt`:

    cmon.us-west-1.triton.zone *.cmon.us-west-1.triton.zone

Then generate your certificate.

	./dehydrated -c -f config.ecdsa

See [`triton-dehycrated`][td] for additional information.

[td]: https://github.com/joyent/triton-dehydrated

## Install the Prometheus Server

Each user requires their own prometheus server, or some other way to scrape the
endpoints exposed by the cmon zone. For the purposes of this procedure, we will
be using prometheus. Note that you have two alternatives here - you can either
build your own server and follow these steps to manually configure it, or you
can build your own server and use the scripts designed to make it easier to set
things up.

### Create an Instance

* This instance will need external connectivity (to reach the cmon instance).
  A fabric network is ideal, if available.
* You can use either the portal guis (AdminUI or DevOps portal) or the command
  line tools.
* The owner should be the user that is the owner of the containers being
  monitored.
* Any version of Linux supported by Prometheus is recomended. You can use LX,
  KVM, or Bhyve.
* The required memory and disk space will depend on how many other instances
  are being monitored 1GB of RAM and 15GB is sufficient to collect metrics for
  about 50 triton instances with a 14 day retention period.

**Example:**

This example uses a sample package from the dev data that can be optional added
to Triton for non-production environments. For a production environment, choose
an appropriately sized package available in your Triton datacenter.

     $ triton instance create ubuntu-certified-18.04 sample-1G

### Configure DNS

If you have already configured CNS for global name resolution resolver you can
skip this step.  See the [CNS Operator's Guide][cns-op-g] for details.

[cns-op-g]: https://github.com/joyent/triton-cns/blob/master/docs/operator-guide.md

#### Get the external IP address for CNS

     headnode# sdc-vmadm ips $(sdc-vmname cns)

#### Update the Resolver Config and Reload

     promserver# echo "## Add CNS Admin IP to resolv.conf" >> /etc/resolvconf/resolv.conf.d/base
     promserver# echo "nameserver 10.99.99.40" >> /etc/resolvconf/resolv.conf.d/base
     promserver# resolvconf -u

### Install Prometheus

It's recomended to use one of the following methods to install prometheus.

* apt or apt-get
* [download directly from prometheus][prom-dl]
* [build via `go get`][prom-build]

See the documentation for details on which method you choose.

[prom-dl]: https://prometheus.io/download/
[prom-build]: https://github.com/prometheus/prometheus#building-from-source

### Create a Service Startup Script

This may not be necessary, depending on the installation method you chose.

This script should be called `prometheus` and placed in
`/etc/init.d/`. Adjust values as necessary. You can set it up to autostart if
you desire. See the documentation for your init system for additional
information.

     description "prometheus server"
     author      "Joyent"
     # used to be: start on startup
     # until we found some mounts weren't ready yet while booting
     start on started mountall
     stop on shutdown
     # automatically respawn
     respawn
     respawn limit 99 5
     script
         export HOME="/opt"
         export PATH=$PATH:/usr/local/go/bin
         exec cd /opt && /opt/prometheus --config.file=/root/prom-cmon.yml >> /var/log/prometheus.log 2>&1
     end script
     post-start script
        # optionally put a script here that will notifiy you prometheus has (re)started
     end script

## Setup Authentication and Configuration

This walks you through the process of setting up a certificate for accessing
the metrics we are pulling.

### Create a Certificate from your private key

Use the `node-triton` command line utility to generate a new key and sign a
certificate to be used with CMON. This key/certificate pair will only be valid
for use with CMON. It cannot be used to authenticate with CloudAPI or Docker.
The certificate will be signed by the SSH key designated by your Triton profile
`keyId`. If for some reason you remove the SSH key used to sign the
certificate, the certificate will no longer be valid and you will need to
generate a new key/certificate pair.

Do this on your workstation.

    triton profile cmon-certgen

You'll get two files, `cmon-<account>-key.pem` and `cmon-<account>-cert.pem`.
The account used will be the one specified in your profile.

After generating the key/certificate pair, you can either `scp` these to your
prometheus instance or add them to the instance metadata. See [CloudAPI
documentation][cloudapi-doc] for details.

[cloudapi-doc]: https://github.com/joyent/sdc-cloudapi/blob/master/docs/index.md#updatemachinemetadata-post-loginmachinesidmetadata

### Test your Certificate / Endpoint

**Note:** Add your domain.

    $ curl --insecure --cert-type pem \
        --cert "cmon-${TRITON_ACCOUNT}-cert.pem" \
        --key "cmon-${TRITON_ACCOUNT}-key.pem" \
        "https://cmon.YOURDOMAIN:9163/v1/discover"

### Create a Prometheus Configuration

Substitute values as appropriate. Filename should be `prom-cmon.yml`

    global:
      scrape_interval:     10s
      evaluation_interval: 8s
      # scrape_timeout is set to the global default 10s

    ## Note: you can create multiple stanzas starting with "job_name"
    scrape_configs:
    * job_name: triton
      scheme: https
      tls_config:
        cert_file: cmon-<account>-cert.pem
        key_file: cmon-<account>-key.pem
        # If you did not use triton-dehydreated to generate certs for cmon
        # uncomment the following line.
        # insecure_skip_verify: true
      triton_sd_configs:
        - account: 'admin'
          dns_suffix: 'cmon.eg-1.cns.example.com'
          endpoint: 'cmon.eg-1.cns.example.com'
          version: 1
          tls_config:
            cert_file: cmon-<account>-cert.pem
            key_file: cmon-<account>-key.pem
            insecure_skip_verify: true
      # The following additional labels will be useful querying Prometheus
      relabel_configs:
        - source_labels: [__meta_triton_machine_alias]
          target_label: instance
        - source_labels: [__param_datacenter_name]
          target_label: datacenter_name
          replacement: eg-1
        - source_labels: [__param_account]
          target_label: account_name
          replacement: <account>

## Start up Prometheus

We are going to use the service we created above here; however, one could also
go through and use the command line exclusively to run it.

### Run the Service Control Script

     promserver# service prometheus start

### Check the Log File

Any issues are going to be shown in the log file here; there are also numerous
flags you can set in the invocation to adjust the way things are logged, so have
at it if desired.

     promserver# tail -f /var/log/prometheus.log

