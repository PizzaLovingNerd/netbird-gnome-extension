# NetBird for GNOME

This repository contains a native GNOME Shell extension for controlling a local
NetBird client. The extension targets GNOME Shell 46–51 and communicates with
NetBird's local HTTP/JSON Unix socket, which was designed for integrations like
this one.

Development of this extension is done by Cameron Knauff and funded by
[NetBird](https://netbird.io/).

## Requirements

- NetBird 0.76.0 or newer (the JSON socket arrived in 0.75; 0.76 is the
  security floor for local control clients)
- GNOME Shell 46–51
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

While NetBird is connected, GNOME's built-in VPN button is insensitive,
including its menu and keyboard controls. Disconnecting NetBird or disabling
the extension restores the controls, respecting GNOME's network permissions.
While the extension is enabled, NetBird's `wt0` WireGuard interface is excluded
from GNOME's VPN list so it cannot replace the selected VPN profile. Saved VPN
profiles are preserved. Connecting NetBird disconnects active GNOME VPNs first;
if NetBird is enabled externally, the extension also disconnects them when its
connected status arrives. They remain disconnected until you enable them again.

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

### GNOME Shell compatibility

GNOME Shell 46–51 share the same extension sources. The
[GNOME Shell 51 migration guide](https://gjs.guide/extensions/upgrading/gnome-shell-51.html)
requires no runtime changes for the APIs this extension uses: `disable()` is
synchronous, no removed St/Clutter/Shell APIs are used, and popup menus are
closed without version-specific animation arguments. GTK widget orientation
in preferences is unaffected by the removal of St's `vertical` property.

When changing Shell code, keep APIs available on GNOME 46 or feature-detect
newer APIs and retain a fallback. In a test session on each supported Shell
version, check Quick Settings, connection and profile actions, preferences,
and repeated enable/disable cycles (`bash tests/vm-cycle.sh`). Local
`make check` validates shared logic but does not exercise the running Shell UI.

## License

Extension source is GPL-3.0-or-later. Reused NetBird artwork is distributed
under its retained BSD-3-Clause notice in `LICENSES/`.
