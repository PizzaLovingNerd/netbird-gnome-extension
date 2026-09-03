// SPDX-License-Identifier: GPL-3.0-or-later

import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle} from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {StatusController} from './statusController.js';

export const NetBirdToggle = GObject.registerClass({
    GTypeName: 'NetBirdExtensionToggle',
}, class NetBirdToggleImpl extends QuickMenuToggle {
    constructor(extension, statusIcons, panelIcon) {
        super({
            gicon: statusIcons.forState('Unavailable'),
            subtitle: 'Loading…',
            title: 'NetBird',
            toggleMode: false,
        });

        this._busy = false;
        this._extension = extension;
        this._panelIcon = panelIcon;
        this._statusIcons = statusIcons;
        this._profileSection = new PopupMenu.PopupMenuSection();
        this._profileSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this._signalIds = [];

        this.menu.addMenuItem(this._profileSection);
        this.menu.addMenuItem(this._profileSeparator);

        this._refreshItem = this.menu.addAction('Refresh', () => {
            void this._controller.refreshLists();
        }, 'view-refresh-symbolic');
        this._openItem = this.menu.addAction('Open NetBird', () => {
            this.menu.close();
            this._extension.openPreferences();
        }, 'network-vpn-symbolic');
        this._openItem.visible = Main.sessionMode.allowSettings;
        this.menu._settingsActions[extension.uuid] = this._openItem;
        this.menu.setHeader(statusIcons.forState('Unavailable'), 'NetBird');

        this._controller = new StatusController({
            onActionError: (title, error) => this._notifyError(title, error),
            onStateChanged: state => this._sync(state),
        });

        this._signalIds.push([
            this,
            this.connect('clicked', () => void this._toggleConnection()),
        ]);
        this._signalIds.push([
            this.menu,
            this.menu.connect('open-state-changed', (_menu, open) => {
                if (open)
                    void this._controller.refreshLists();
            }),
        ]);
    }

    destroy() {
        this._controller.destroy();
        this._controller = null;
        this._statusIcons = null;
        for (const [object, id] of this._signalIds)
            object.disconnect(id);
        this._signalIds = [];
        super.destroy();
    }

    async _toggleConnection() {
        if (this._busy)
            return;

        this._busy = true;
        this.reactive = false;
        const controller = this._controller;
        const handledInShell = await controller.toggleConnection();
        if (this._controller !== controller)
            return;

        this.reactive = true;
        this._busy = false;
        if (!handledInShell) {
            this.menu.close();
            this._extension.openPreferences();
        }
    }

    _sync({profileName, profiles, snapshot}) {
        const gicon = this._statusIcons.forState(snapshot.state);
        this.gicon = gicon;
        this._panelIcon.gicon = gicon;
        this.menu.setHeader(
            gicon, 'NetBird', statusLabel(snapshot.state, snapshot.localPeer.ipv4));
        this.checked = snapshot.connected || snapshot.state === 'Connecting';
        this.subtitle = statusLabel(snapshot.state, snapshot.localPeer.ipv4);
        this._panelIcon.visible = true;
        this._rebuildProfiles(profiles, profileName);
    }

    _rebuildProfiles(profiles, profileName) {
        this._profileSection.removeAll();
        this._profileSection.actor.visible = profiles.length > 0;
        this._profileSeparator.visible = profiles.length > 0;
        if (profiles.length === 0)
            return;

        const heading = new PopupMenu.PopupMenuItem(
            profileName ? `Profile: ${profileName}` : 'Profiles',
            {can_focus: false, reactive: false});
        this._profileSection.addMenuItem(heading);

        for (const profile of profiles) {
            const item = this._profileSection.addAction(profile.name, () => {
                void this._controller.selectProfile(profile.id);
            });
            if (profile.isActive)
                item.setOrnament(PopupMenu.Ornament.CHECK);
        }
    }

    _notifyError(title, error) {
        const message = String(error?.message ?? error).trim() || 'Unknown error';
        Main.notify(title, message);
    }
});

function statusLabel(state, ip) {
    if (state === 'Connected' && ip)
        return ip;

    const labels = {
        Connected: 'Connected',
        Connecting: 'Connecting…',
        Idle: 'Disconnected',
        LoginFailed: 'Sign-in failed',
        NeedsLogin: 'Sign in required',
        SessionExpired: 'Session expired',
        Unavailable: 'Finish setup',
    };
    return labels[state] ?? state;
}
