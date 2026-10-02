// SPDX-License-Identifier: GPL-3.0-or-later

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

const DEACTIVATING = 3;
const DEACTIVATED = 4;

export async function disconnectOtherVpns(client, cancellable) {
    if (cancellable.is_cancelled())
        throw new Error('VPN disconnection cancelled');
    const activeVpns = (client?.get_active_connections() ?? []).filter(active => {
        const connection = active.connection;
        const type = connection?.get_connection_type();
        return ['vpn', 'wireguard'].includes(type) &&
            !(type === 'wireguard' && connection.get_interface_name() === 'wt0') &&
            active.get_state() !== DEACTIVATED;
    });
    await Promise.all(activeVpns.map(async active => {
        if (active.get_state() !== DEACTIVATING) {
            await new Promise((resolve, reject) => {
                client.deactivate_connection_async(active, cancellable, (object, result) => {
                    try {
                        object.deactivate_connection_finish(result);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });
            });
        }
        await waitForDeactivation(active, cancellable);
    }));
}

function waitForDeactivation(active, cancellable) {
    if (cancellable.is_cancelled())
        return Promise.reject(new Error('VPN disconnection cancelled'));
    if (active.get_state() === DEACTIVATED)
        return Promise.resolve();

    return new Promise((resolve, reject) => {
        let signalId = 0;
        let timeoutId = 0;
        let cancelId = 0;
        const finish = error => {
            active.disconnect(signalId);
            if (timeoutId)
                GLib.Source.remove(timeoutId);
            if (cancelId)
                GObject.Object.prototype.disconnect.call(cancellable, cancelId);
            if (error)
                reject(error);
            else
                resolve();
        };
        signalId = active.connect('notify::state', () => {
            if (active.get_state() === DEACTIVATED)
                finish();
        });
        timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
            timeoutId = 0;
            finish(new Error('The previous VPN did not disconnect in time'));
            return GLib.SOURCE_REMOVE;
        });
        // Generic signal connection permits safe cleanup inside the cancellation handler.
        cancelId = GObject.Object.prototype.connect.call(cancellable, 'cancelled', () =>
            finish(new Error('VPN disconnection cancelled')));
    });
}
