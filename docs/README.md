# cmon

CMON is responsible for authentication, authorization, accounting of containers
which can be monitored, and proxying results from cmon-agents back to public
callers. The canonical source of requests to CMON are customer Prometheus
servers.

At a minimum, CMON runs on the headnode in the cmon0 zone. In an HA deployment
it will be run on at least two compute nodes in a cmon1, cmon2,
cmon(n) zone configuration.

# cmon exposes the following HTTP API:

## List Metrics (GET /metrics)

Retrieve Prometheus
[text formatted](https://prometheus.io/docs/instrumenting/exposition_formats/#text-format-details)
metrics data for the HOST specified in the request header.

### Responses

| Code | Description         | Response                         |
| ---- | ------------------- | -------------------------------- |
| 200  | Response OK         | Prometheus text formatted output |
| 401  | Unauthorized error  | Unauthorized error string        |
| 403  | Forbidden error     | Forbidden error string           |
| 404  | Not found error     | Not found error string           |
| 500  | Internal error      | Internal error string            |

### Example

```
GET https://<container_uuid>.cmon.<az>.triton.zone:9163/metrics
---
# HELP cpu_user_usage User CPU utilization in nanoseconds
# TYPE cpu_user_usage counter
cpu_user_usage 63967515436752
# HELP cpu_sys_usage System CPU usage in nanoseconds
# TYPE cpu_sys_usage counter
cpu_sys_usage 1162987685940
# HELP cpu_wait_time CPU wait time in nanoseconds
# TYPE cpu_wait_time counter
cpu_wait_time 45927954147062
# HELP load_average Load average
# TYPE load_average gauge
load_average 0.08203125
# HELP mem_agg_usage Aggregate memory usage in bytes
# TYPE mem_agg_usage gauge
mem_agg_usage 821420032
# HELP mem_limit Memory limit in bytes
# TYPE mem_limit gauge
mem_limit 1073741824
# HELP mem_swap Swap in bytes
# TYPE mem_swap gauge
mem_swap 820187136
# HELP mem_swap_limit Swap limit in bytes
# TYPE mem_swap_limit gauge
mem_swap_limit 4294967296
# HELP net_agg_packets_in Aggregate inbound packets
# TYPE net_agg_packets_in counter
net_agg_packets_in 16276932
# HELP net_agg_packets_out Aggregate outbound packets
# TYPE net_agg_packets_out counter
net_agg_packets_out 19376660
# HELP net_agg_bytes_in Aggregate inbound bytes
# TYPE net_agg_bytes_in counter
net_agg_bytes_in 3625990126
# HELP net_agg_bytes_out Aggregate outbound bytes
# TYPE net_agg_bytes_out counter
net_agg_bytes_out 14279416929
# HELP zfs_used zfs space used in bytes
# TYPE zfs_used gauge
zfs_used 2249691136
# HELP zfs_available zfs space available in bytes
# TYPE zfs_available gauge
zfs_available 24593854464
# HELP time_of_day System time in seconds since epoch
# TYPE time_of_day counter
time_of_day 1485284623598
```

## Discover Containers (GET /v1/discover)

Retrieve containers that can be scraped by a Prometheus server for metrics.

### Responses


| Code | Description         | Response                         |
| ---- | ------------------- | -------------------------------- |
| 200  | Response OK         | Discovery JSON                   |
| 401  | Unauthorized error  | Unauthorized error string        |
| 403  | Forbidden error     | Forbidden error string           |
| 500  | Internal error      | Internal error string            |

### Example
```
GET https://cmon.<az>.triton.zone:9163/v1/discover
---
{
    "containers":[
        {
            "server_uuid":"44454c4c-5000-104d-8037-b7c04f5a5131",
            "source":"Bootstrapper",
            "vm_alias":"container01",
            "vm_image_uuid":"7b27a514-89d7-11e6-bee6-3f96f367bee7",
            "vm_owner_uuid":"466a7507-1e4f-4792-a5ed-af2e2101c553",
            "vm_uuid":"ad466fbf-46a2-4027-9b64-8d3cdb7e9072",
            "cached_date":1484956672585
        },
        {
            "server_uuid":"44454c4c-5000-104d-8037-b7c04f5a5131",
            "source":"Bootstrapper",
            "vm_alias":"container02",
            "vm_image_uuid":"7b27a514-89d7-11e6-bee6-3f96f367bee7",
            "vm_owner_uuid":"466a7507-1e4f-4792-a5ed-af2e2101c553",
            "vm_uuid":"a5894692-bd32-4ca1-908a-e2dda3c3a5e6",
            "cached_date":1484956672672
        }
    ]
}
```

## Installing

```
[root@headnode (hn) ~]$ sdcadm self-update --latest
[root@headnode (hn) ~]$ sdcadm post-setup cmon
[root@headnode (hn) ~]$ sdcadm up cmon
```

## Manual verification of functionality

### Testing (GET /metrics)

```
[root@node ~]$ curl --insecure --cert-type pem --cert cert.pem --key key.pem \
"https://48392ade-b01a-c5f1-f88d-b660cb5e0322.cmon.us-east-3b.triton.zone:9163/metrics"
```

#### Healthy
* 200 OK with Prometheus text
```
# HELP cpu_user_usage User CPU utilization in nanoseconds
# TYPE cpu_user_usage counter
cpu_user_usage 58708613676893
...
```
* 401 Not Authorized (only healthy if you're not using proper credentials)
```
Not Authorized
```
* 403 Forbidden (only healthy if you're using credentials for a different user)
```
Forbidden
```
* 404 Not Found (only healthy if you've used an vm uuid that doesn't exist)
```
Not found
```

#### Unhealthy

* 401 Not Authorized (only unhealthy if your credentials are valid)
```
Not Authorized
```
  * Check that mahi is working properly
  * Check that vmapi is working properly
  * Check that cmon is receiving changefeed events (check logs)
    * Restarting cmon will cause it to re-bootstrap and refresh its cache
* 403 Forbidden (only unhealthy if the credentials are correct for the vm)
```
Forbidden
```
  * Check that mahi is working properly
  * Check that vmapi is working properly
  * Check that cmon is receiving changefeed events (check logs)
    * Restarting cmon will cause it to re-bootstrap and refresh its cache
* 404 Not Found (only unhealthy if the vm uuid that does exist)
```
Not found
```
  * Check that vmapi is working properly
  * Check that cmon is receiving changefeed events (check logs)
    * Restarting cmon will cause it to re-bootstrap and refresh its cache

#### Unhealthy
* 500 Internal Error
```
Internal error
```
  * Check logs

### Checking logs

```
[root@cmon ~]$ tail -f `svcs -L cmon` | bunyan --color
```

* Check for ERROR and WARN output
* Check for expected changefeed events

## Metrics

CMON exposes metrics via [node-triton-metrics](https://github.com/joyent/node-triton-metrics) on `http://<ADMIN_IP>:8881/metrics.`
