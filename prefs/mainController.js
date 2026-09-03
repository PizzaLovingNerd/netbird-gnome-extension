// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {NetBirdClient} from '../netbird/client.js';

const RECONNECT_DELAYS_SECONDS = [1, 2, 5, 10, 30];
const LOGIN_STATES = ['NeedsLogin', 'LoginFailed', 'SessionExpired'];

export class MainController {
    constructor({onError, onStateChanged}) {
        this._busy = false;
        this._client = new NetBirdClient();
        this._features = {};
        this._networks = [];
        this._onError = onError;
        this._onStateChanged = onStateChanged;
        this._profileName = '';
        this._profiles = [];
        this._reconnectAttempt = 0;
        this._reconnectSourceId = 0;
        this._refreshing = false;
        this._snapshot = unavailableSnapshot();

        this._subscribe();
        void this.refresh();
    }

    get state() {
        return {
            busy: this._busy,
            features: this._features,
            networks: this._networks,
            profileName: this._profileName,
            profiles: this._profiles,
            snapshot: this._snapshot,
        };
    }

    destroy() {
        if (this._reconnectSourceId) {
            GLib.Source.remove(this._reconnectSourceId);
            this._reconnectSourceId = 0;
        }
        this._client.destroy();
    }

    async refresh() {
        if (this._client.cancelled || this._refreshing)
            return;

        this._refreshing = true;
        try {
            const [status, profiles, networks, features] = await Promise.all([
                this._client.status(),
                this._client.profiles(),
                this._client.networks(),
                this._client.features(),
            ]);
            if (this._client.cancelled)
                return;

            this._snapshot = status.snapshot;
            this._profileName = profiles.activeProfile;
            this._profiles = profiles.profiles;
            this._networks = networks.networks;
            this._features = features;
            this._emitChanged();
        } catch {
            if (!this._client.cancelled)
                this._setUnavailable();
        } finally {
            this._refreshing = false;
        }
    }

    async toggleConnection() {
        if (this._client.cancelled || this._busy)
            return;

        this._setBusy(true);
        try {
            if (this._snapshot.connected || this._snapshot.state === 'Connecting')
                await this._client.disconnect();
            else if (LOGIN_STATES.includes(this._snapshot.state))
                await this._login();
            else
                await this._client.connect(this._activeProfileId());
        } catch (error) {
            if (!this._client.cancelled)
                this._onError('Connection Could Not Be Changed', error);
        } finally {
            this._setBusy(false);
        }
    }

    async selectProfile(profileId) {
        const profile = this._profiles.find(item => item.id === profileId);
        if (!profile || profile.isActive || this._client.cancelled || this._busy)
            return;

        this._setBusy(true);
        const reconnect = this._snapshot.connected || this._snapshot.state === 'Connecting';
        try {
            if (reconnect)
                await this._client.disconnect();
            await this._client.switchProfile(profileId);
            if (reconnect)
                await this._client.connect(profileId);
            await this.refresh();
        } catch (error) {
            if (!this._client.cancelled)
                this._onError('Profile Could Not Be Switched', error);
        } finally {
            this._setBusy(false);
        }
    }

    async selectExitNode(networkId) {
        if (this._client.cancelled || this._busy)
            return;

        const selected = this._networks.find(network =>
            network.isExitNode && network.selected);
        if ((selected?.id ?? '') === networkId)
            return;

        this._setBusy(true);
        try {
            if (selected)
                await this._client.deselectNetworks([selected.id]);
            if (networkId)
                await this._client.selectNetworks([networkId], {append: true});
            await this.refresh();
        } catch (error) {
            if (!this._client.cancelled)
                this._onError('Exit Node Could Not Be Changed', error);
        } finally {
            this._setBusy(false);
        }
    }

    async setNetworkSelected(networkId, selected) {
        if (this._client.cancelled || this._busy)
            return;

        this._setBusy(true);
        try {
            if (selected)
                await this._client.selectNetworks([networkId], {append: true});
            else
                await this._client.deselectNetworks([networkId]);
            await this.refresh();
        } catch (error) {
            if (!this._client.cancelled)
                this._onError('Network Could Not Be Changed', error);
        } finally {
            this._setBusy(false);
        }
    }

    async _login() {
        const login = await this._client.login();
        if (login.needsSsoLogin) {
            const uri = login.verificationUriComplete || login.verificationUri;
            if (!/^https:\/\//.test(uri))
                throw new Error('NetBird returned an invalid sign-in address');
            Gio.AppInfo.launch_default_for_uri(uri, null);
            await this._client.waitForSso(login.userCode);
        }
        await this._client.connect(this._activeProfileId());
    }

    _subscribe() {
        if (this._client.cancelled)
            return;

        this._client.subscribeStatus(
            snapshot => {
                if (this._client.cancelled)
                    return;

                const networksChanged = snapshot.networksRevision !==
                    this._snapshot.networksRevision;
                this._snapshot = snapshot;
                this._reconnectAttempt = 0;
                this._emitChanged();
                if (networksChanged)
                    void this.refresh();
            },
            () => {
                if (this._client.cancelled)
                    return;

                this._setUnavailable();
                this._scheduleReconnect();
            });
    }

    _scheduleReconnect() {
        if (this._client.cancelled || this._reconnectSourceId)
            return;

        const delay = RECONNECT_DELAYS_SECONDS[
            Math.min(this._reconnectAttempt, RECONNECT_DELAYS_SECONDS.length - 1)];
        this._reconnectAttempt++;
        this._reconnectSourceId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            delay,
            () => {
                this._reconnectSourceId = 0;
                this._subscribe();
                return GLib.SOURCE_REMOVE;
            });
    }

    _setUnavailable() {
        this._snapshot = unavailableSnapshot(this._snapshot);
        this._emitChanged();
    }

    _setBusy(busy) {
        this._busy = busy;
        this._emitChanged();
    }

    _activeProfileId() {
        return this._profiles.find(profile => profile.isActive)?.id ?? '';
    }

    _emitChanged() {
        if (!this._client.cancelled)
            this._onStateChanged(this.state);
    }
}

function unavailableSnapshot(previous = null) {
    return {
        connected: false,
        daemonVersion: previous?.daemonVersion ?? '',
        localPeer: previous?.localPeer ?? {fqdn: '', ipv4: '', ipv6: ''},
        networksRevision: previous?.networksRevision ?? 0,
        peers: previous?.peers ?? [],
        sessionExpiresAt: previous?.sessionExpiresAt ?? 0,
        state: 'Unavailable',
    };
}
