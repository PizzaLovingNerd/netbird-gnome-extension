// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';

import {NetBirdClient} from '../netbird/client.js';

const RECONNECT_DELAYS_SECONDS = [1, 2, 5, 10, 30];

export class StatusController {
    constructor({
        client = new NetBirdClient(),
        onActionError,
        onStateChanged,
    }) {
        this._client = client;
        this._onActionError = onActionError;
        this._onStateChanged = onStateChanged;
        this._profiles = [];
        this._profileName = '';
        this._reconnectAttempt = 0;
        this._reconnectSourceId = 0;
        this._refreshing = false;
        this._snapshot = {
            connected: false,
            daemonVersion: '',
            localPeer: {fqdn: '', ipv4: '', ipv6: ''},
            networksRevision: 0,
            peers: [],
            sessionExpiresAt: 0,
            state: 'Unavailable',
        };
        this._switching = false;

        this._emitChanged();
        this._subscribe();
        void this.refreshLists();
    }

    get state() {
        return {
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

    async refreshLists() {
        if (this._client.cancelled || this._refreshing)
            return;

        this._refreshing = true;
        try {
            const [profiles, features] = await Promise.all([
                this._client.profiles(),
                this._client.features(),
            ]);
            if (this._client.cancelled)
                return;

            this._profiles = features.disableProfiles ? [] : profiles.profiles;
            this._profileName = features.disableProfiles
                ? ''
                : profiles.activeProfile;
            this._emitChanged();
        } catch {
            if (!this._client.cancelled)
                this._setUnavailable();
        } finally {
            this._refreshing = false;
        }
    }

    async toggleConnection() {
        if (this._client.cancelled)
            return true;

        try {
            if (this._snapshot.connected || this._snapshot.state === 'Connecting')
                await this._client.disconnect();
            else if (this._snapshot.state === 'Unavailable' || this._needsLogin())
                return false;
            else
                await this._client.connect(this._activeProfileId());
            return true;
        } catch (error) {
            if (!this._client.cancelled)
                this._onActionError('Connection Could Not Be Changed', error);
            return true;
        }
    }

    async selectProfile(profileId) {
        const profile = this._profiles.find(item => item.id === profileId);
        if (!profile || profile.isActive || this._switching ||
            this._client.cancelled)
            return;

        this._switching = true;
        const reconnect = this._snapshot.connected || this._snapshot.state === 'Connecting';
        try {
            if (reconnect)
                await this._client.disconnect();
            await this._client.switchProfile(profileId);
            if (reconnect)
                await this._client.connect(profileId);
            await this.refreshLists();
        } catch (error) {
            if (!this._client.cancelled)
                this._onActionError('Profile Could Not Be Switched', error);
        } finally {
            this._switching = false;
        }
    }

    _subscribe() {
        if (this._client.cancelled)
            return;

        this._client.subscribeStatus(
            snapshot => {
                if (this._client.cancelled)
                    return;

                this._snapshot = snapshot;
                this._reconnectAttempt = 0;
                this._emitChanged();
            },
            () => {
                if (this._client.cancelled)
                    return;

                this._setUnavailable();
                this._scheduleReconnect();
            });
    }

    _scheduleReconnect() {
        if (this._reconnectSourceId || this._client.cancelled)
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
        if (this._snapshot.state === 'Unavailable')
            return;

        this._snapshot = {
            ...this._snapshot,
            connected: false,
            state: 'Unavailable',
        };
        this._emitChanged();
    }

    _emitChanged() {
        if (!this._client.cancelled)
            this._onStateChanged(this.state);
    }

    _activeProfileId() {
        return this._profiles.find(profile => profile.isActive)?.id ?? '';
    }

    _needsLogin() {
        return ['NeedsLogin', 'LoginFailed', 'SessionExpired']
            .includes(this._snapshot.state);
    }
}
