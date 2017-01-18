# cmon

Update to the latest experimental sdcadm

```
[root@headnode (coal) ~]# sdcadm self-update -C experimental --latest
Using channel experimental
Update to sdcadm 1.12.0 (CMON-8-20160912T214251Z-g6decf68)
Download update from https://updates.joyent.com
Run sdcadm installer (log at
/var/sdcadm/self-updates/20160912T214859Z/install.log)
Updated to sdcadm 1.12.0 (CMON-8-20160912T214251Z-g6decf68, elapsed 19s)
```

Install the cmon0 zone on the headnode

```
[root@headnode (coal) ~]# sdcadm post-setup cmon -C experimental
Downloading image 538a92a2-7701-11e6-9b27-47cc3c8243ea
    (cmon@CMON-8-20160910T024731Z-g9fc6513)
Imported image 538a92a2-7701-11e6-9b27-47cc3c8243ea
    (cmon@CMON-8-20160910T024731Z-g9fc6513)
Creating "cmon" service
Creating "cmon" instance
Created VM 3c720d74-1d92-4205-9745-bb7810ea6a37 (cmon0)
Setup "cmon" (84s)

[root@headnode (coal) ~]# sdcadm insts cmon
INSTANCE                              SERVICE  HOSTNAME  VERSION                           ALIAS
3c720d74-1d92-4205-9745-bb7810ea6a37  cmon     headnode  CMON-8-20160910T024731Z-g9fc6513  cmon0

[root@headnode (coal) ~]# sdcadm up -C experimental cmon
Finding candidate update images for the "cmon" service.
Using channel experimental

This update will make the following changes:
    download 1 image (50 MiB):
        image 2c7866f6-791f-11e6-9588-eb4a42d3a379
            (cmon@CMON-8-20160912T192536Z-g4ece7ca)
    update "cmon" service to image 2c7866f6-791f-11e6-9588-eb4a42d3a379
        (cmon@CMON-8-20160912T192536Z-g4ece7ca)

Would you like to continue? [y/N] y

Create work dir: /var/sdcadm/updates/20160912T193220Z
Downloading image 2c7866f6-791f-11e6-9588-eb4a42d3a379
    (cmon@CMON-8-20160912T192536Z-g4ece7ca)
Imported image 2c7866f6-791f-11e6-9588-eb4a42d3a379
    (cmon@CMON-8-20160912T192536Z-g4ece7ca)
Updating image for SAPI service "cmon"
    service uuid: b752ba9d-03ae-48ec-8c94-acc153c35047
"cmon" VM already has a delegate dataset
Installing image 2c7866f6-791f-11e6-9588-eb4a42d3a379
    (cmon@CMON-8-20160912T192536Z-g4ece7ca)
Reprovisioning cmon VM 3c720d74-1d92-4205-9745-bb7810ea6a37
Waiting for cmon instance 3c720d74-1d92-4205-9745-bb7810ea6a37 to come up
Updated successfully (elapsed 95s).
```

# cmon-agent

```
[root@headnode (coal) ~]# sdcadm self-update -C experimental --latest

[root@headnode (coal) ~]# sdcadm experimental add-new-agent-svcs
Checking for minimum SAPI version
Checking if service 'vm-agent' exists
Checking if service 'net-agent' exists
Checking if service 'cn-agent' exists
Checking if service 'agents_core' exists
Checking if service 'cmon-agent' exists
Checking if service 'amon-agent' exists
Checking if service 'amon-relay' exists
Checking if service 'cabase' exists
Checking if service 'cainstsvc' exists
Checking if service 'config-agent' exists
Checking if service 'firewaller' exists
Checking if service 'hagfish-watcher' exists
Checking if service 'smartlogin' exists
Adding service for agent 'cmon-agent'
Add new agent services finished (elapsed 0s).

[root@headnode (coal) ~]# sdcadm experimental update-agents --latest --all -C experimental
Found agentsshar 671b7f40-b479-4cbf-b758-7b96299fa098 (1.0.0-CMON-8-20161118T014828Z-g5c4baca)
Finding servers to update

This update will make the following changes:
    Download agentsshar 671b7f40-b479-4cbf-b758-7b96299fa098
        (1.0.0-CMON-8-20161118T014828Z-g5c4baca)
    Update GZ agents on 1 (of 1) servers using
        agentsshar 1.0.0-CMON-8-20161118T014828Z-g5c4baca

Would you like to continue? [y/N] y

Downloading agentsshar from updates server (channel "experimental")
    to /var/tmp/agent-671b7f40-b479-4cbf-b758-7b96299fa098.sh
Copy agentsshar to assets dir: /usbkey/extra/agents
Create /usbkey/extra/agents/latest symlink
Starting agentsshar update on 1 servers
...ting node.config [=======================>] 100%        1
...ading agentsshar [=======================>] 100%        1
...lling agentsshar [=======================>] 100%        1
Deleting temporary /var/tmp/agent-671b7f40-b479-4cbf-b758-7b96299fa098.sh
Reloading sysinfo on updated servers
Sysinfo reloaded for all the running servers
Refreshing config-agent on all the updated servers
Config-agent refreshed on updated servers
Successfully updated agents (3m51s)

[root@headnode (coal) ~]# tail -f `svcs -L cmon-agent` | bunyan --color
[2016-11-18T02:16:18.674Z]  INFO: cmon-agent/84455 on headnode: listening (url=http://10.99.99.7:9163)
[2016-11-18T02:16:18.674Z]  INFO: cmon-agent/84455 on headnode: startup complete
```

# prometheus server

Create an Ubuntu 14.04 LX zone for Prometheus with an External NIC (via AdminUI or triton-cli)
```
Image UUID: 7b27a514-89d7-11e6-bee6-3f96f367bee7
Package: sample-1G 1.0.0
```

Install necessary applications in your Ubuntu 14.04 LX zone:
```
root@e3902c56-cea8-691b-fa78-963e2447682a:~# apt-get update && apt-get dist-upgrade
root@e3902c56-cea8-691b-fa78-963e2447682a:~# apt-get install git
root@e3902c56-cea8-691b-fa78-963e2447682a:~# apt-get install build-essential
root@e3902c56-cea8-691b-fa78-963e2447682a:~# sudo apt-get install dnsutils
```

Install [Go](https://golang.org/doc/install) on the newly created Ubuntu 14.04 LX zone
```
root@e3902c56-cea8-691b-fa78-963e2447682a:~# wget https://storage.googleapis.com/golang/go1.7.3.linux-amd64.tar.gz
--2016-11-18 02:45:50--  https://storage.googleapis.com/golang/go1.7.3.linux-amd64.tar.gz
Resolving storage.googleapis.com (storage.googleapis.com)... 2607:f8b0:400a:809::2010, 172.217.3.208
Connecting to storage.googleapis.com (storage.googleapis.com)|2607:f8b0:400a:809::2010|:443... failed: Network is unreachable.
Connecting to storage.googleapis.com (storage.googleapis.com)|172.217.3.208|:443... connected.
HTTP request sent, awaiting response... 200 OK
Length: 82565628 (79M) [application/x-gzip]
Saving to: ‘go1.7.3.linux-amd64.tar.gz’

100%[====================================================================================================================================================================================================================================================================================>] 82,565,628  5.51MB/s   in 17s

2016-11-18 02:46:07 (4.75 MB/s) - ‘go1.7.3.linux-amd64.tar.gz’ saved [82565628/82565628]

root@e3902c56-cea8-691b-fa78-963e2447682a:~# tar -C /usr/local -xzf go1.7.3.linux-amd64.tar.gz
root@e3902c56-cea8-691b-fa78-963e2447682a:~# export GOPATH=$HOME/work
```


Configure DNS in the LX zone to point at CNS:
```
## Add CNS Admin IP to resolv.conf
## nameserver 10.99.99.40
root@e3902c56-cea8-691b-fa78-963e2447682a:~# vim /etc/resolvconf/resolv.conf.d/base
root@e3902c56-cea8-691b-fa78-963e2447682a:~# resolvconf -u
```

Generate key and cert from your CoaL user private key:
```
root@e3902c56-cea8-691b-fa78-963e2447682a:~/.ssh# openssl rsa -in \
your_private_rsa -outform
pem >promkey.pem
writing RSA key
root@e3902c56-cea8-691b-fa78-963e2447682a:~/.ssh# openssl req -new -key \
promkey.pem -out promcsr.pem -subj "/CN=YOUR_ACCOUNT_NAME"
root@e3902c56-cea8-691b-fa78-963e2447682a:~/.ssh# openssl x509 -req -days 365 \
-in promcsr.pem -signkey promkey.pem -out promcert.pem
Signature ok
subject=/CN=richard
Getting Private key
```

Test from the LX zone that the CMON endpoint us up and running:
```
root@e3902c56-cea8-691b-fa78-963e2447682a:~# curl --insecure --cert-type pem \
--cert your_cert.pem --key your_key.pem \
"https://cmon.coal.cns.joyent.us:9163/v1/discover"
```

Install Prometheus from the joyent/prometheus fork on the CMON-8 branch:
```
root@e3902c56-cea8-691b-fa78-963e2447682a:~# mkdir -p $GOPATH/src/github.com/prometheus
root@e3902c56-cea8-691b-fa78-963e2447682a:~# cd $GOPATH/src/github.com/prometheus
root@e3902c56-cea8-691b-fa78-963e2447682a:~# git clone https://github.com/joyent/prometheus.git
root@e3902c56-cea8-691b-fa78-963e2447682a:~# cd prometheus
root@e3902c56-cea8-691b-fa78-963e2447682a:~# git checkout CMON-8
root@e3902c56-cea8-691b-fa78-963e2447682a:~# make build
```

Create a configuration file for your prometheus instance:
```
global:
  scrape_interval:     10s
  evaluation_interval: 8s
  # scrape_timeout is set to the global default 10s

scrape_configs:
- job_name: triton-coal
  scheme: https
  tls_config:
    cert_file: your_cert.pem
    key_file: your_key.pem
    insecure_skip_verify: true
  triton_sd_configs:
    - account: 'your_username'
      cert: 'your_cert.pem'
      dns_suffix: 'cmon.coal.cns.joyent.us'
      endpoint: 'cmon.coal.cns.joyent.us'
      insecure_skip_verify: true
      key: 'your_key.pem'
      version: 1
```

Start up prometheus:
```
$ ./prometheus -config.file=your_config.yml
```
