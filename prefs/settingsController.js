// SPDX-License-Identifier: GPL-3.0-or-later

import {NetBirdClient} from '../netbird/client.js';

export const MASKED_PRESHARED_KEY = '**********';

const FIELDS = {
    allowSsh: {api: 'serverSSHAllowed', managed: 'allowServerSSH', type: 'boolean'},
    blockInbound: {api: 'blockInbound', managed: 'blockInbound', type: 'boolean'},
    blockLanAccess: {api: 'blockLanAccess', type: 'boolean'},
    connectOnStartup: {
        api: 'disableAutoConnect',
        inverted: true,
        managed: 'disableAutoConnect',
        type: 'boolean',
    },
    disableClientRoutes: {
        api: 'disableClientRoutes',
        managed: 'disableClientRoutes',
        type: 'boolean',
    },
    disableDns: {api: 'disableDns', type: 'boolean'},
    disableIpv6: {api: 'disableIpv6', type: 'boolean'},
    disableServerRoutes: {
        api: 'disableServerRoutes',
        managed: 'disableServerRoutes',
        type: 'boolean',
    },
    disableSshAuthentication: {api: 'disableSSHAuth', type: 'boolean'},
    interfaceName: {api: 'interfaceName', type: 'string'},
    interfacePort: {api: 'wireguardPort', managed: 'wireguardPort', type: 'number'},
    jwtCacheTtl: {api: 'sshJWTCacheTTL', type: 'number'},
    lazyConnections: {
        api: 'lazyConnectionEnabled',
        managed: 'lazyConnection',
        type: 'boolean',
    },
    managementUrl: {api: 'managementUrl', managed: 'managementURL', type: 'string'},
    mtu: {api: 'mtu', type: 'number'},
    networkMonitor: {api: 'networkMonitor', type: 'boolean'},
    notifications: {api: 'disableNotifications', inverted: true, type: 'boolean'},
    preSharedKey: {
        api: 'optionalPreSharedKey',
        managed: 'preSharedKey',
        read: 'preSharedKey',
        type: 'string',
    },
    quantumResistance: {
        api: 'rosenpassPermissive',
        managed: 'rosenpassPermissive',
        type: 'boolean',
    },
    sshLocalPortForwarding: {api: 'enableSSHLocalPortForwarding', type: 'boolean'},
    sshRemotePortForwarding: {api: 'enableSSHRemotePortForwarding', type: 'boolean'},
    sshRootLogin: {api: 'enableSSHRoot', type: 'boolean'},
    sshSftp: {api: 'enableSSHSFTP', type: 'boolean'},
};

const RECONNECT_FIELDS = new Set([
    'allowSsh',
    'blockInbound',
    'blockLanAccess',
    'disableClientRoutes',
    'disableDns',
    'disableIpv6',
    'disableServerRoutes',
    'interfaceName',
    'interfacePort',
    'lazyConnections',
    'managementUrl',
    'mtu',
    'networkMonitor',
    'preSharedKey',
    'quantumResistance',
]);

export class SettingsController {
    constructor({
        client = new NetBirdClient(),
        onBusyChanged,
        onError,
        onLoaded,
        onValueRestored,
    }) {
        this._busy = false;
        this._client = client;
        this._onBusyChanged = onBusyChanged;
        this._onError = onError;
        this._onLoaded = onLoaded;
        this._onValueRestored = onValueRestored;
        this._managedKeys = new Set();
        this._profileId = '';
        this._profiles = [];
        this._values = new Map();
    }

    get profileId() {
        return this._profileId;
    }

    get profiles() {
        return this._profiles;
    }

    get cancelled() {
        return this._client.cancelled;
    }

    destroy() {
        this._client.destroy();
    }

    async load(profileId = '') {
        this._setBusy(true);
        try {
            const profiles = await this._client.profiles();
            const selectedId = profileId ||
                profiles.profiles.find(profile => profile.isActive)?.id ||
                profiles.profiles[0]?.id || 'default';
            const [result, features] = await Promise.all([
                this._client.config(selectedId),
                this._client.features(),
            ]);
            if (this._client.cancelled)
                return;

            this._profileId = selectedId;
            this._profiles = profiles.profiles;
            this._managedKeys = readManagedKeys(result.config);
            this._values = readValues(result.config);
            this._onLoaded({
                managedKeys: [...this._managedKeys],
                profileId: this._profileId,
                profiles: this._profiles,
                features,
                values: new Map(this._values),
            });
        } catch (error) {
            if (!this._client.cancelled)
                this._onError('Settings Could Not Be Loaded', error);
        } finally {
            this._setBusy(false);
        }
    }

    async setValue(key, value) {
        const field = FIELDS[key];
        if (!field || this._client.cancelled || this._managedKeys.has(key))
            return;

        const previous = this._values.get(key);
        if (Object.is(previous, value))
            return;
        if (key === 'preSharedKey' && value === MASKED_PRESHARED_KEY)
            return;

        if (this._busy) {
            this._onValueRestored(key, previous);
            return;
        }

        this._setBusy(true);
        let writeSucceeded = false;
        try {
            const apiValue = field.inverted ? !value : value;
            await this._client.updateConfig({
                [field.api]: apiValue,
                profileName: this._profileId,
            });
            writeSucceeded = true;

            if (RECONNECT_FIELDS.has(key)) {
                const status = await this._client.status();
                if (status.snapshot.connected) {
                    await this._client.disconnect();
                    await this._client.connect(this._profileId);
                }
            }

            const result = await this._client.config(this._profileId);
            const applied = readValues(result.config).get(key);
            if (!settingWasApplied(key, value, applied)) {
                throw new Error(
                    `NetBird accepted the ${field.api} change but did not apply it.`);
            }
            this._values.set(key, value);
        } catch (error) {
            if (!this._client.cancelled) {
                if (writeSucceeded) {
                    const apiPrevious = field.inverted ? !previous : previous;
                    try {
                        await this._client.updateConfig({
                            [field.api]: apiPrevious,
                            profileName: this._profileId,
                        });
                    } catch {
                        // Keep the original error and restore the visible value.
                    }
                }
                this._onValueRestored(key, previous);
                this._onError('Setting Could Not Be Saved', error);
            }
        } finally {
            this._setBusy(false);
        }
    }

    async addProfile(name) {
        return this._changeProfiles(
            'Profile Could Not Be Added',
            async () => {
                const result = await this._client.addProfile(name);
                await this.load(String(result.data.id ?? ''));
            });
    }

    async renameProfile(name) {
        return this._changeProfiles(
            'Profile Could Not Be Renamed',
            async () => {
                await this._client.renameProfile(this._profileId, name);
                await this.load(this._profileId);
            });
    }

    async removeProfile() {
        return this._changeProfiles(
            'Profile Could Not Be Removed',
            async () => {
                await this._client.removeProfile(this._profileId);
                await this.load();
            });
    }

    async logoutProfile() {
        return this._changeProfiles(
            'Profile Could Not Be Signed Out',
            async () => {
                await this._client.logoutProfile(this._profileId);
                await this.load(this._profileId);
            });
    }

    async createDebugBundle() {
        this._setBusy(true);
        try {
            const result = await this._client.createDebugBundle();
            return String(result.data.path ?? 'Debug bundle created');
        } finally {
            this._setBusy(false);
        }
    }

    async triggerUpdate() {
        this._setBusy(true);
        try {
            return await this._client.triggerUpdate();
        } finally {
            this._setBusy(false);
        }
    }

    async _changeProfiles(title, operation) {
        if (this._client.cancelled || this._busy)
            return;

        this._setBusy(true);
        try {
            await operation();
        } catch (error) {
            if (!this._client.cancelled)
                this._onError(title, error);
        } finally {
            this._setBusy(false);
        }
    }

    _setBusy(busy) {
        this._busy = busy;
        if (!this._client.cancelled)
            this._onBusyChanged(busy);
    }
}

function readValues(config) {
    const values = new Map();
    for (const [key, field] of Object.entries(FIELDS)) {
        const raw = config[field.read ?? field.api];
        if (field.type === 'boolean')
            values.set(key, field.inverted ? !raw : Boolean(raw));
        else if (field.type === 'number')
            values.set(key, Number(raw ?? 0));
        else
            values.set(key, String(raw ?? ''));
    }
    return values;
}

function readManagedKeys(config) {
    const managedFields = new Set(
        Array.isArray(config.mDMManagedFields)
            ? config.mDMManagedFields.filter(value => typeof value === 'string')
            : []);
    const keys = Object.entries(FIELDS)
        .filter(([, field]) => field.managed && managedFields.has(field.managed))
        .map(([key]) => key);
    return new Set(keys);
}

function settingWasApplied(key, requested, applied) {
    if (key === 'preSharedKey') {
        return requested === ''
            ? applied === ''
            : applied === MASKED_PRESHARED_KEY;
    }
    if (typeof requested === 'number')
        return Number(applied) === requested;
    return Object.is(applied, requested);
}
