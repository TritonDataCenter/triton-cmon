<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2017, Joyent, Inc.
-->

# Triton Container Monitor

This is the home of the public facing portion of the Triton Container
Monitor solution. Triton CMON acts as if it is many individual Prometheus
node exporters by supporting a polling route per container per datacenter
that the polling user has access to.

Please see
[RFD 27](https://github.com/joyent/rfd/blob/master/rfd/0027/README.md#) for more
information.

## Development

## Test

```
make test
```

## Lint

```
make check
```

## Release

```
make release
```

## Documentation

For an overview of the Triton Container Monitor solution, please see
[RFD 27](https://github.com/joyent/rfd/blob/master/rfd/0027/README.md#).

For documentation specific to CMON, please see
[docs/README.md](docs/README.md).

For installation instructions and for an overview of how to use with
prometheus, please see [docs/INSTALLING.md](docs/INSTALLING.md).

## License

"Triton CMON" is licensed under the
[Mozilla Public License version 2.0](http://mozilla.org/MPL/2.0/).
See the file LICENSE.
