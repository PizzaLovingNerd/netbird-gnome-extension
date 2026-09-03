// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import {populateMainWindow} from '../prefs/mainWindow.js';

const application = new Adw.Application({
    application_id: 'io.netbird.NetBirdPrefsSmoke',
});

application.connect('activate', () => {
    const window = new Adw.PreferencesWindow({application});
    const ui = populateMainWindow(window);
    if (!window.visible_page)
        throw new Error('Preferences did not register a page with the GNOME host');
    const sampleState = {
        busy: false,
        networks: [{
            domains: ['git.internal.example'],
            id: 'Engineering',
            isExitNode: false,
            range: '10.20.0.0/16',
            resolvedIps: [],
            selected: true,
        }, {
            domains: [],
            id: 'exit-node',
            isExitNode: true,
            range: '0.0.0.0/0',
            resolvedIps: [],
            selected: false,
        }],
        snapshot: {
            connected: true,
            peers: [{
                fqdn: 'workstation.example',
                ip: '100.64.0.2',
                ipv6: '',
                latencyMs: 24,
                relayed: false,
                state: 'Connected',
            }, {
                fqdn: 'server.example',
                ip: '100.64.0.3',
                ipv6: '',
                latencyMs: 0,
                relayed: true,
                state: 'Disconnected',
            }],
        },
    };
    ui.peers.update(sampleState);
    ui.resources.update(sampleState);
    window.present();

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
        ui.stack.visible_child_name = 'peers';
        if (ui.stack.visible_child_name !== 'peers')
            throw new Error('Peers page could not be selected');
        return GLib.SOURCE_REMOVE;
    });
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        ui.stack.visible_child_name = 'resources';
        if (ui.stack.visible_child_name !== 'resources')
            throw new Error('Resources page could not be selected');
        return GLib.SOURCE_REMOVE;
    });
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 750, () => {
        ui.stack.visible_child_name = 'home';
        window.activate_action('netbird.settings', null);
        return GLib.SOURCE_REMOVE;
    });
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
        application.quit();
        return GLib.SOURCE_REMOVE;
    });
});

const status = application.run([]);
if (status !== 0)
    throw new Error(`Preferences smoke test exited with status ${status}`);
