# NetBird for GNOME

This repository contains a native GNOME Shell extension for controlling a local
NetBird client. The extension targets GNOME Shell 46–50 and communicates with
NetBird's local HTTP/JSON Unix socket, which was designed for integrations like
this one.

Development of this extension is done by Cameron Knauff and funded by
[NetBird](https://netbird.io/).

## Requirements

- NetBird 0.76.0 or newer (the JSON socket arrived in 0.75; 0.76 is the
  security floor for local control clients)
- GNOME Shell 46–50
- the NetBird JSON socket enabled at `/var/run/netbird-http.sock`

The JSON socket is disabled by default. To enable it after installing and
enabling the NetBird service, use this command:

```sh
sudo netbird service reconfigure --enable-json-socket
```

Reconfiguring the service restarts NetBird and can briefly interrupt tunnel
connectivity, routes, and DNS. The extension only displays this guidance; it
never runs privileged commands.

## Installation

Run the installer from a terminal:

```sh
./install.sh
```

The script builds and installs the extension for the current user. Log out and
back in after installation, then enable **NetBird for GNOME** using the
Extensions app or `gnome-extensions enable gnome@netbird.io`.

## Development

Install the development-only linter once, then run the full local check:

```sh
npm ci
make check
```

This checks the GNOME/GJS JavaScript style, parses every module, runs the
transport and controller suites, validates metadata, enforces the Shell/GTK
process boundary, and rejects subprocess or `eval` use in runtime code.

Build the extension ZIP with:

```sh
make package
```

The repository root is the extension source directory. Development tests live
under `tests/` and are not included in the ZIP.

## License

Extension source is GPL-3.0-or-later. Reused NetBird artwork is distributed
under its retained BSD-3-Clause notice in `LICENSES/`.
