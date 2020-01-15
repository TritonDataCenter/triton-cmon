## Setting up CMON

This procedure walks you through the process of setting up the Container
Monitoring System, or CMON.

This procedure assumes you are able to:

* Install Triton
* Setup Triton CNS (Triton Container Name Service), and configure the same.

## Setup the Triton Installation

This step only needs to be done one time per environment.

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
      Updating node.config                         [=================================================================================================>] 100%        2
      Downloading agentsshar                       [=================================================================================================>] 100%        2
      Installing agentsshar                        [=================================================================================================>] 100%        2
      Deleting temporary /var/tmp/agent-cd27c168-c02e-48c3-896b-32b30e800863.sh
      Reloading sysinfo on updated servers
      Sysinfo reloaded for all the running servers
      Refreshing config-agent on all the updated servers
      Config-agent refreshed on updated servers
      Successfully updated agents (3m22s)

* Validate the agents (can check HN _and_ CNs)

      headnode# tail -f `svcs -L cmon-agent` | bunyan --color
      [2016-11-18T02:16:18.674Z]  INFO: cmon-agent/84455 on headnode: listening (url=http://10.99.99.7:9163)
      [2016-11-18T02:16:18.674Z]  INFO: cmon-agent/84455 on headnode: startup complete

## Install the Prometheus Server

Each user requires their own prometheus server, or some other way to scrape the
endpoints exposed by the cmon zone. For the purposes of this procedure, we will
be using prometheus. Note that you have two alternatives here - you can either
build your own server and follow these steps to manually configure it, or you
can build your own server and use the scripts designed to make it easier to set
things up.

### Create an Ubuntu 14.04 LX Instance

* This instance will need external connectivity (to reach the cmon instance).
* You can use either the portal guis (AdminUI or DevOps portal) or the command
  line tools.
* The owner should be the user that is the owner of the containers being
  monitored.
* Suggested image/package:
    * **Image UUID**: 7b27a514-89d7-11e6-bee6-3f96f367bee7
    * **Package**: sample-1G 1.0.0


**Note**: This assumes you are using sample packages. If you are using other
packages, you are going to want to pick one of a similar size.

**Example:**

     $ triton instance create 7b27a514-89d7-11e6-bee6-3f96f367bee7 sample-1G

### Install Necessary Applications

You will need git, build-essential, and dnsutils.

     promserver# apt-get update && apt-get dist-upgrade -y
     promserver# apt-get install -y git build-essential dnsutils git

### Install [Go](https://golang.org/doc/install)

     promserver# wget https://storage.googleapis.com/golang/go1.7.5.linux-amd64.tar.gz
     *-2016-11-18 02:45:50--  https://storage.googleapis.com/golang/go1.7.5.linux-amd64.tar.gz
     Resolving storage.googleapis.com (storage.googleapis.com)... 2607:f8b0:400a:809::2010, 172.217.3.208
     Connecting to storage.googleapis.com (storage.googleapis.com)|2607:f8b0:400a:809::2010|:443... failed: Network is unreachable.
     Connecting to storage.googleapis.com (storage.googleapis.com)|172.217.3.208|:443... connected.
     HTTP request sent, awaiting response... 200 OK
     Length: 82565628 (79M) [application/x-gzip]
     Saving to: ‘go1.7.5.linux-amd64.tar.gz’
     100%[====================================================================================================================================================================================================================================================================================>] 82,565,628  5.51MB/s   in 17s
     2016-11-18 02:46:07 (4.75 MB/s) - ‘go1.7.5.linux-amd64.tar.gz’ saved [82565628/82565628]
     promserver# tar -C /usr/local -xzf go1.7.5.linux-amd64.tar.gz

### Set Necessary Paths

     promserver# export GOPATH=$HOME/work
     promserver# export PATH=$PATH:/usr/local/go/bin

### Configure DNS

If you already have DNS setup using CNS as a resolver (either directly for via a
slave) for this instance you can skip this step.

### Get the external IP address for CNS

     headnode# sdc-vmadm ips $(sdc-vmname cns)

### Update the Resolver Config and Reload

     promserver# echo "## Add CNS Admin IP to resolv.conf" >> /etc/resolvconf/resolv.conf.d/base
     promserver# echo "nameserver 10.99.99.40" >> /etc/resolvconf/resolv.conf.d/base
     promserver# resolvconf -u

### Install Prometheus

**Note:** Replace the tag below (v1.5.2 at the time of this writing) with the
tag you wish to use as your build.

     promserver# mkdir -p $GOPATH/src/github.com/prometheus
     promserver# cd $GOPATH/src/github.com/prometheus
     promserver# git clone https://github.com/prometheus/prometheus.git
     promserver# cd prometheus
     promserver# git checkout tags/v1.5.2 -b v1.5.2
     promserver# export PATH=$PATH:/usr/local/go/bin
     promserver# make build

### Create a Link

This isn't necessary, but it helps to make life more bearable.

     promserver# ln -s /root/work/src/github.com/prometheus/prometheus/prometheus /root/prometheus

### Test Prometheus

     promserver#  ./prometheus --version
     prometheus, version 1.5.2
       build user:       root@dcb96268-457e-c640-a1a2-bd5591bc71ba
       build date:       20161223-21:29:10
       go version:       go1.7.5


### Create a Service Startup Script

*Note:* Like the rest of this setup guide, the script is pretty opinionated and
expects things to be named certain things and put in certain places.

This script should be called `prometheus.conf` and should be copied to
`/etc/init`. You can set it up to autostart if you desire.

     description "prometheus server"
     author      "Some Guy"
     # used to be: start on startup
     # until we found some mounts weren't ready yet while booting
     start on started mountall
     stop on shutdown
     # automatically respawn
     respawn
     respawn limit 99 5
     script
         export HOME="/root"
         export PATH=$PATH:/usr/local/go/bin
         exec cd /root&&/root/prometheus --config.file=/root/prom-config.yml >> /var/log/prometheus.log 2>&1
     end script
     post-start script
        # optionally put a script here that will notifiy you prometheus has (re)started
     end script

## Setup Authentication and Configuration

This walks you through the process of setting up a certificate for accessing the
metrics we are pulling.

You have a few choices here:

* Create a new keypair on the prometheus server which you add to your account.
  _This is the recommended way._
* Copy your public/private key pair to the prometheus server. Both keys are
  required. _This is not recommended._

### Create a Certificate from your private key

**Note:** Update with your own information.

     promserver# PRIVATE_KEY=~/.ssh/id_rsa
     promserver# YOUR_ACCOUNT_NAME=jay.schmidt
     promserver# openssl rsa -in $PRIVATE_KEY -outform pem > promkey.pem
     promserver# openssl req -new -key promkey.pem -out promcsr.pem -subj "/CN=$YOUR_ACCOUNT_NAME"
     promserver# openssl x509 -req -days 365 -in promcsr.pem -signkey promkey.pem -out promcert.pem

### Test your Certificate / Endpoint

**Note:** Add your domain.

     promserver# curl --insecure --cert-type pem --cert promcert.pem --key promkey.pem \
     "https://cmon.YOURDOMAIN:9163/v1/discover"

### Create a Prometheus Configuration

* **Note:** Substitute variables as appropriate.
* Filename should be `prom-config.yml`

      global:
        scrape_interval:     10s
        evaluation_interval: 8s
        # scrape_timeout is set to the global default 10s

      ## Note: you can create multiple stanzas starting with "job_name"
      scrape_configs:
      * job_name: triton
        scheme: https
        tls_config:
          cert_file: promcert.pem
          key_file: promkey.pem
          insecure_skip_verify: true
        triton_sd_configs:
          - account: 'admin'
            dns_suffix: 'cmon.cak-1.cns.virington.com'
            endpoint: 'cmon.cak-1.cns.virington.com'
            version: 1
            tls_config:
              cert_file: promcert.pem
              key_file: promkey.pem
              insecure_skip_verify: true
        relabel_configs:
          - source_labels: [__meta_triton_machine_alias]
            target_label: instance

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

