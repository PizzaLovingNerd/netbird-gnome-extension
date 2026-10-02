// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';

import {disconnectOtherVpns} from './vpnConnections.js';

export class VpnButtonGuard {
    constructor(quickSettings, injections, onError = () => {}) {
        this._cancellable = new Gio.Cancellable();
        this._disconnecting = null;
        this._onError = onError;
        this._vpnSignal = 0;
        this._injections = injections;
        this._quickSettings = quickSettings;
        this._network = null;
        this._toggle = null;
        this._blocked = false;
        this._entries = [];
        this._updating = false;
        // Shell may create its network indicator after extensions are enabled.
        this._indicatorSignal = quickSettings._indicators.connect('child-added', () =>
            this.setBlocked(this._blocked));
    }

    setBlocked(blocked) {
        this._blocked = blocked;
        if (!this._toggle)
            this._attach();
        if (!this._toggle || blocked === (this._entries.length > 0))
            return;
        if (!blocked) {
            this._restore();
            return;
        }

        // QuickMenuToggle has separate clickable content and arrow buttons in GNOME 46–51.
        const actors = new Set([
            this._toggle,
            this._toggle._box.get_first_child(),
            this._toggle._menuButton,
        ]);
        for (const actor of actors) {
            this._watch(actor, 'reactive', 'reactive');
            this._watch(actor, 'can_focus', 'can-focus');
        }
        this._watch(this._toggle, 'menuEnabled', 'menu-enabled');
        this._toggle.menu.close();
        this._updating = true;
        for (const entry of this._entries)
            entry.actor[entry.key] = false;
        this._updating = false;
        this._disconnectInBackground();
    }

    disconnectActiveVpns() {
        if (!this._toggle)
            this._attach();
        if (!this._disconnecting) {
            this._disconnecting = disconnectOtherVpns(this._toggle?._client, this._cancellable)
                .finally(() => {
                    this._disconnecting = null;
                });
        }
        return this._disconnecting;
    }

    _disconnectInBackground() {
        void this.disconnectActiveVpns().catch(error => {
            if (!this._cancellable.is_cancelled())
                this._onError(error);
        });
    }

    destroy() {
        this._cancellable.cancel();
        if (this._vpnSignal)
            this._toggle.disconnect(this._vpnSignal);
        this._vpnSignal = 0;
        if (this._indicatorSignal)
            this._quickSettings._indicators.disconnect(this._indicatorSignal);
        this._indicatorSignal = 0;
        this._restore();
        this._injections.clear();
        if (this._toggle) {
            // Rebuild from current NM state, which may have changed while wt0 was hidden.
            for (const connection of this._toggle._client?.get_connections() ?? [])
                this._toggle._addConnection(connection);
            this._toggle._syncActiveConnections();
            this._toggle._sync();
        }
        this._quickSettings = null;
        this._toggle = null;
        this._network = null;
    }

    _attach() {
        this._network = this._quickSettings._network;
        this._toggle = this._network?._vpnToggle;
        if (!this._toggle)
            return;

        // NetBird owns wt0; Shell must not promote it over the user's VPN profile.
        this._injections.overrideMethod(this._toggle, '_shouldHandleConnection', original =>
            function (connection) {
                return !isNetBirdConnection(connection) && original.call(this, connection);
            });
        for (const connection of [...this._toggle._items.keys()]) {
            if (isNetBirdConnection(connection))
                this._toggle._removeConnection(connection);
        }
        this._toggle._syncActiveConnections();
        this._toggle._sync();
        this._vpnSignal = this._toggle.connect('notify::checked', () => {
            if (this._blocked)
                this._disconnectInBackground();
        });
    }

    _watch(actor, key, property) {
        const entry = {actor, key, value: actor[key], signalId: 0};
        entry.signalId = actor.connect(`notify::${property}`, () => {
            if (this._updating || actor[key] === false)
                return;
            // Preserve Shell permission/state changes made while NetBird holds the button disabled.
            entry.value = actor[key];
            this._updating = true;
            actor[key] = false;
            this._updating = false;
        });
        this._entries.push(entry);
    }

    _restore() {
        for (const entry of this._entries)
            entry.actor.disconnect(entry.signalId);
        for (const entry of this._entries) {
            const permissionDenied = entry.actor === this._toggle && entry.key === 'reactive' &&
                this._network._configPermission?.allowed === false;
            entry.actor[entry.key] = permissionDenied ? false : entry.value;
        }
        if (this._entries.length)
            this._toggle._menuButton.reactive = this._toggle.reactive;
        this._entries = [];
    }
}

function isNetBirdConnection(connection) {
    return connection.get_connection_type() === 'wireguard' &&
        connection.get_interface_name() === 'wt0';
}
