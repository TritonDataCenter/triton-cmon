# Introduction

This procedure describes the process of setting up the Container Monitoring
System, or CMON.

This guide covers CMON itself, and only provides an example of setting up
Prometheus to monitor CMON. Adequately scaling Prometheus, or using alternative
metric collection agents is outside the scope of this document.

This procedure assumes you have already completed the following prerequisite
tasks:

* Install Triton DataCenter.
* [Setup and configure Triton CNS][cns] (Triton Container Name Service).
* Install the `node-triton` command line tool on your workstation.

[cns]: https://github.com/joyent/triton-cns/blob/master/docs/operator-guide.md

## Install and Configure CMON

Installing and configuring CMON is done once per data center.

### Create the CMON zone

Update to the latest sdcadm, run:

    sdcadm self-update --latest

Install the cmon zone on the headnode, run:

    sdcadm post-setup cmon

Validate the cmon0 instance. This example shows that the cmon0 instance was
created.

    [root@headnode (eg1) ~]# sdcadm insts cmon
    INSTANCE                              SERVICE  HOSTNAME  VERSION                                     ALIAS
    fad6801f-0a6b-4c10-a0ad-18e7e6737181  cmon     headnode  release-20170316-20170315T212914Z-gd76e78a  cmon0

### Update/Install Agents

The `cmon-agent` runs on every compute node and relays metrics for each running
instance. The example below shows updating the Triton agents, which will also
ensure cmon-agent is on all compute nodes.

    [root@headnode (eg1) ~]# sdcadm experimental update-agents --latest --all
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

Validate the agents. This example shows the `cmon-agent` is installed, and the
status is `online`.

    [root@headnode (eg1) ~]# sdcadm insts cmon-agent
    INSTANCE                              SERVICE     HOSTNAME  VERSION  ALIAS
    9ad1e01c-fd15-4d80-b1ca-22bea979dd0c  cmon-agent  headnode  1.16.2   -
    d26974d8-d579-4636-8d24-2abe2cb933af  cmon-agent  cn1       1.16.2   -
    bcb3efc6-30d2-453f-8157-b09599521661  cmon-agent  cn2       1.16.2   -

    [root@headnode (eg1) ~]# sdc-oneachnode -a 'svcs -H cmon-agent'
    HOSTNAME              STATUS
    headnode              online         Apr_08   svc:/smartdc/agent/cmon-agent:default
    cn1                   online         Apr_08   svc:/smartdc/agent/cmon-agent:default
    cn2                   online         Apr_08   svc:/smartdc/agent/cmon-agent:default

If necessary, check the `cmon-agent` service log for errors. For example:

    [root@headnode (eg1) ~] headnode# tail -f $(svcs -L cmon-agent) | bunyan --color
    [2016-11-18T02:16:18.674Z]  INFO: cmon-agent/84455 on headnode: listening (url=http://10.99.99.7:9163)
    [2016-11-18T02:16:18.674Z]  INFO: cmon-agent/84455 on headnode: startup complete

### Create additional CMON instances as necessary

CMON scales horizontally. If/when you need to scale CMON for capacity, create
additional instances, preferably on separate compute nodes.

To create a cmon instance, run:

    sdcadm -s <compute_node_uuid> cmon

### Configure TLS for the CMON Service

By default, cmon instances will be deployed with a self-signed TLS
certificate. It's highly recommended that you use [`triton-dehydrated`][td] to
generate a certificate via [Let's Encrypt][le].

You must create a SAN certificate with both a hostname and wildcard name. CMON
will *only* use the DNS name configured for the external interface designated
in [CNS][cns]. Unlike other Triton services, you *may not* use a CNAME.

It's also *highly* recommended to use ECDSA. RSA certificates carry a severe
performance penalty due to the added crypto overhead.

This needs to be done on headnode in each Triton DataCenter. The TLS
certificate will be deployed to all running CMON instances in that data center.

Create `domains.ecdsa.txt`. The base name and wildcard name need to be on
the same line. For example:

    cmon.eg1.cns.example.com *.cmon.eg1.cns.example.com

Then to generate your certificate run:

    cd /path/to/triton-dehydrated
    ./dehydrated -c -f config.ecdsa

See [`triton-dehycrated`][td] for additional information.

[td]: https://github.com/joyent/triton-dehydrated
[le]: https://www.letsencrypt.org/

<!-- Note: link for CNS is above so it doesn't need to be repeated here. -->

### Add CMON to the CloudAPI Services

CloudAPI can be queried to discover additional services provided by the
data center. Run this to

Be sure to specify the correct CMON endpoint.

    cmon_endpoint="https://cmon.eg1.cns.example.com:9163"

    cloudapi_svc=$(sdc-sapi /services?name=cloudapi | json -H 0.uuid)
    sapiadm get "$cloudapi_svc" \
        | json -e "
            svcs = JSON.parse(this.metadata.CLOUDAPI_SERVICES || '{}');
            svcs.cmon = '$cmon_endpoint';
            this.update = {metadata: {CLOUDAPI_SERVICES: JSON.stringify(svcs)}};
        " update | sapiadm update "$cloudapi_svc"

**Note:** This will cause a restart of the CloudAPI service.

### Create a Client Certificate for Accessing CMON

Use the `node-triton` command line utility to generate a new key and sign a
certificate to be used with CMON. The certificate will be signed by the SSH
key designated by your Triton profile `keyId`.

This key/certificate pair will only be valid for use with CMON. It cannot be
used to authenticate against CloudAPI or Docker.

If for some reason you remove the SSH key used to sign the certificate, this
certificate will no longer be valid and you will need to generate a new
key/certificate pair. Some users choose to create a dedicated SSH key for
signing CMON keys to avoid this.

To generate the certificate, run this on your workstation:

    triton profile cmon-certgen

You'll get two files, `cmon-<account>-key.pem` and `cmon-<account>-cert.pem`.
The account used will be the one specified in your profile.

This key pair can be used with any Triton DataCenter that shares the same
UFDS database.

### Test your Certificate / Endpoint

Use `curl` to validate that you are able to access CMON. You should get a 200
response along with a JSON payload.

To test CMON with curl, run:

    curl --include --cert-type pem \
        --cert "cmon-${TRITON_ACCOUNT}-cert.pem" \
        --key "cmon-${TRITON_ACCOUNT}-key.pem" \
        "https://cmon.eg1.cns.example.com:9163/v1/discover"

## Sample Prometheus Server

Each account requires their own Prometheus server, or some other way to scrape
the endpoints exposed by the cmon service. For the purposes of this example, we
will be using Prometheus by downloading the `prometheus` binary directly. For
other methods (distribution package manager, compile yourself, etc.) see the
respective documentation as necessary.

**Important:** Adequately scaling a Prometheus infrastructure is outside the
scope of this document. There's an entire industry around this, and we would not
attempt to cover that topic here.

### Create an Instance

* This instance will need external connectivity (to reach the cmon instance).
  A fabric network is ideal, if available.
* You can use either the portal GUI (AdminUI or DevOps portal) or the command
  line tools.
* The owner should be the user that is the owner of the instances being
  monitored.
* Any version of Linux that is supported by Prometheus is recommended. You can
  use LX, KVM, or Bhyve.
* The required memory and disk space will depend on how many other instances
  are being monitored 1GB of RAM and 15GB should be sufficient to collect
  metrics for about 50 triton instances with a 14 day retention period.

You can either `scp` the client certificate/key you created earlier to your
Prometheus instance or add them to the instance metadata. See [CloudAPI
documentation][cloudapi-doc] for details.

[cloudapi-doc]: https://github.com/joyent/sdc-cloudapi/blob/master/docs/index.md#updatemachinemetadata-post-loginmachinesidmetadata

#### Example

This example uses a sample package from the dev data that can be optional added
to Triton for non-production environments. For a production environment, choose
an appropriately sized package available in your Triton DataCenter.

    triton instance create ubuntu-certified-18.04 sample-1G

**Important:** Copy the client certificate and key you created earlier to your
Prometheus instance. Remember to protect your Triton SSH key because it has
full access to everything in your account. Whereas the generated cmon sub-key
can only be used for accessing CMON.

### Configure DNS

If you have already configured CNS for global name resolution skip this step.
See the [CNS Operator's Guide][cns] for details. This is only necessary if you
are unable to configure global name resolution.

<!-- Note: link for CNS is above so it doesn't need to be repeated here. -->

#### Get the external IP address for CNS

     headnode# sdc-vmadm ips $(sdc-vmname cns)

#### Update the Resolver Config and Reload

     promserver# echo "## Add CNS Admin IP to resolv.conf" >> /etc/resolvconf/resolv.conf.d/base
     promserver# echo "nameserver 10.99.99.40" >> /etc/resolvconf/resolv.conf.d/base
     promserver# resolvconf -u

### Install Prometheus

[Download the latest release][prom-dl] of Prometheus for your platform,
then extract it.

    promserver# tar xvfz prometheus-*.tar.gz
    promserver# cd prometheus-*

Consult the [Prometheus documentation][prom-site] for additional information.

[prom-dl]: https://prometheus.io/download/
[prom-site]: https://prometheus.io/

### Create a Service Startup Script

This script should be called `prometheus` and placed in `/etc/init.d/`. Adjust
values as necessary. You can set it up to autostart if you desire. See the
documentation for your distribution's init system for additional information.

     description "Prometheus server"
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

### Create a Prometheus Configuration File

Substitute values as appropriate. In this example the filename will be
`prom-cmon.yml`.

You can create jobs for additional data centers, or create separate Prometheus
instances.

    global:
      scrape_interval:     10s
      evaluation_interval: 8s
      # scrape_timeout is set to the global default 10s

    ## You can create multiple stanzas starting with "job_name"
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

### Start up Prometheus

We are going to use the service we created above here; however, one could also
go through and use the command line exclusively to run it.

    promserver# service prometheus start

Any issues are going to be shown in the log file here; there are also numerous
flags you can set in the invocation to adjust the way things are logged, so
have at it if desired.

     promserver# tail -f /var/log/prometheus.log
