// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    callDaemon,
    DEFAULT_TIMEOUT_MS,
    NETBIRD_MINIMUM_VERSION,
    subscribeDaemon,
} from './transport.js';
import {
    normalizeNetwork,
    normalizeProfile,
    normalizeStatus,
} from './normalize.js';

export {
    DEFAULT_TIMEOUT_MS,
    isNetBirdSocketAvailable,
    NETBIRD_MINIMUM_VERSION,
    NETBIRD_SOCKET_PATH,
    NetBirdDaemonError,
} from './transport.js';

export async function createDebugBundle({
    anonymize = false,
    cancellable = null,
    systemInfo = true,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    return callDaemon('DebugBundle', {
        anonymize,
        systemInfo,
        // Never upload; the bundle stays local.
        uploadURL: '',
    }, {cancellable, timeoutMs});
}

export async function requestDaemonUpdate({
    cancellable = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    const result = await callDaemon('TriggerUpdate', {}, {cancellable, timeoutMs});
    const success = Boolean(result.data.success);
    const errorMessage = String(result.data.errorMsg ?? '').trim();

    return {
        ...result,
        errorMessage,
        message: success
            ? 'Daemon update started'
            : errorMessage || 'No daemon update was started',
        success,
    };
}

export function deregisterProfile(profileName = '', {
    cancellable = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    return callDaemon(
        'Logout',
        requestWithProfile(profileName),
        {cancellable, timeoutMs});
}

export async function disconnectNetBird({
    cancellable = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    const result = await callDaemon('Down', {}, {cancellable, timeoutMs});

    return {
        ...result,
        status: 'Disconnected',
    };
}

export async function getNetBirdConfig(profileName = '', {
    cancellable = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    const result = await callDaemon('GetConfig', {
        profileName,
        username: currentUsername(),
    }, {cancellable, timeoutMs});

    return {
        ...result,
        config: result.data,
    };
}

export async function listNetworks({
    cancellable = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    const result = await callDaemon('ListNetworks', {}, {cancellable, timeoutMs});

    return {
        ...result,
        networks: (result.data.routes ?? []).map(normalizeNetwork),
    };
}

export function selectNetworks(networkIds = [], {
    all = false,
    append = true,
    cancellable = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    return callDaemon('SelectNetworks', {
        all,
        append,
        networkIDs: networkIds,
    }, {cancellable, timeoutMs});
}

export function deselectNetworks(networkIds = [], {
    all = false,
    cancellable = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    return callDaemon('DeselectNetworks', {
        all,
        networkIDs: networkIds,
    }, {cancellable, timeoutMs});
}

export async function listProfiles({
    cancellable = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    const result = await callDaemon('ListProfiles', {
        username: currentUsername(),
    }, {cancellable, timeoutMs});
    const profiles = (result.data.profiles ?? [])
        .filter(profile => typeof profile.name === 'string' && profile.name)
        .map(normalizeProfile)
        .map(profile => ({
            ...profile,
            selected: profile.isActive,
        }));

    return {
        ...result,
        activeProfile: profiles.find(profile => profile.selected)?.name ?? '',
        profiles,
    };
}

export async function addProfile(profileName, {
    cancellable = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    assertProfileName(profileName);
    const result = await callDaemon('AddProfile', {
        profileName,
        username: currentUsername(),
    }, {cancellable, timeoutMs});

    return {
        ...result,
        profile: profileName,
    };
}

export async function removeProfile(profileName, {
    cancellable = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    assertProfileName(profileName);
    const result = await callDaemon('RemoveProfile', {
        profileName,
        username: currentUsername(),
    }, {cancellable, timeoutMs});

    return {
        ...result,
        profile: profileName,
    };
}

export async function renameProfile(profileName, newProfileName, {
    cancellable = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    assertProfileName(profileName);
    assertProfileName(newProfileName);
    return callDaemon('RenameProfile', {
        handle: profileName,
        newProfileName,
        username: currentUsername(),
    }, {cancellable, timeoutMs});
}

export async function switchProfile(profileName, {
    cancellable = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    assertProfileName(profileName);
    const result = await callDaemon('SwitchProfile', {
        profileName,
        username: currentUsername(),
    }, {cancellable, timeoutMs});

    return {
        ...result,
        activeProfile: profileName,
    };
}

export function setNetBirdConfig(config = {}, {
    cancellable = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    return callDaemon('SetConfig', {
        ...config,
        username: currentUsername(),
    }, {cancellable, timeoutMs});
}

export async function getNetBirdStatus({
    cancellable = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    const result = await callDaemon('Status', {
        getFullPeerStatus: true,
        shouldRunProbes: false,
    }, {cancellable, timeoutMs});
    const activeProfile = await getActiveProfile({cancellable, timeoutMs});
    const status = typeof result.data.status === 'string'
        ? result.data.status
        : '';
    const daemonVersion = typeof result.data.daemonVersion === 'string'
        ? result.data.daemonVersion
        : '';

    if (daemonVersion && !isNetBirdVersionSupported(daemonVersion))
        throw new NetBirdVersionError(daemonVersion);

    return {
        ...result,
        connected: status.toLowerCase() === 'connected',
        daemonVersion,
        details: result.data,
        profileName: activeProfile,
        snapshot: normalizeStatus(result.data),
        status,
    };
}

export function subscribeNetBirdStatus({
    cancellable,
    onError,
    onStatus,
}) {
    return subscribeDaemon('SubscribeStatus', {
        getFullPeerStatus: true,
        shouldRunProbes: false,
    }, {
        cancellable,
        onError,
        onMessage: data => onStatus(normalizeStatus(data)),
    });
}

export async function getNetBirdFeatures({
    cancellable = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    const result = await callDaemon('GetFeatures', {}, {cancellable, timeoutMs});
    return {
        disableAdvancedView: Boolean(result.data.disableAdvancedView),
        disableNetworks: Boolean(result.data.disableNetworks),
        disableProfiles: Boolean(result.data.disableProfiles),
        disableUpdateSettings: Boolean(result.data.disableUpdateSettings),
    };
}

export async function loginNetBird({
    cancellable = null,
    hostname = GLib.get_host_name(),
    managementUrl = '',
    setupKey = '',
    timeoutMs = 60000,
} = {}) {
    const request = {
        hostname,
        isUnixDesktopClient: true,
    };
    if (managementUrl)
        request.managementUrl = managementUrl;
    if (setupKey)
        request.setupKey = setupKey;

    const result = await callDaemon('Login', request, {cancellable, timeoutMs});
    return {
        needsSsoLogin: Boolean(result.data.needsSSOLogin),
        userCode: String(result.data.userCode ?? ''),
        verificationUri: String(result.data.verificationURI ?? ''),
        verificationUriComplete: String(result.data.verificationURIComplete ?? ''),
    };
}

export async function waitForSsoLogin(userCode, {
    cancellable = null,
    hostname = GLib.get_host_name(),
    timeoutMs = 300000,
} = {}) {
    if (!userCode)
        throw new Error('A NetBird SSO user code is required');

    const result = await callDaemon('WaitSSOLogin', {
        hostname,
        userCode,
    }, {cancellable, timeoutMs});
    return String(result.data.email ?? '');
}

export function isNetBirdVersionSupported(version) {
    const current = parseVersion(version);
    const minimum = parseVersion(NETBIRD_MINIMUM_VERSION);
    if (!current || !minimum)
        return false;

    for (let index = 0; index < minimum.length; index++) {
        if (current[index] !== minimum[index])
            return current[index] > minimum[index];
    }

    return true;
}

export class NetBirdVersionError extends Error {
    constructor(version) {
        super(
            `NetBird ${version} is too old. Update to NetBird ` +
            `${NETBIRD_MINIMUM_VERSION} or later.`);

        this.name = 'NetBirdVersionError';
        this.minimumVersion = NETBIRD_MINIMUM_VERSION;
        this.version = version;
    }
}

export async function connectNetBird({
    cancellable = null,
    profileName = '',
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    const result = await callDaemon('Up', {
        ...requestWithProfile(profileName),
        async: true,
    }, {cancellable, timeoutMs});

    return {
        ...result,
        status: 'Connecting',
    };
}

function currentUsername() {
    return GLib.get_user_name() || '';
}

function parseVersion(version) {
    const match = String(version ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
    if (!match)
        return null;

    return match.slice(1).map(Number);
}

async function getActiveProfile({cancellable, timeoutMs}) {
    const result = await callDaemon(
        'GetActiveProfile',
        {},
        {cancellable, timeoutMs});

    return typeof result.data.profileName === 'string'
        ? result.data.profileName
        : '';
}

function requestWithProfile(profileName) {
    const request = {
        username: currentUsername(),
    };

    if (profileName)
        request.profileName = profileName;

    return request;
}

function assertProfileName(profileName) {
    if (typeof profileName !== 'string' || profileName.trim() === '')
        throw new Error('A NetBird profile name is required');
}

export class NetBirdClient {
    constructor({
        commandTimeoutMs = 30000,
        queryTimeoutMs = 5000,
    } = {}) {
        this._cancellable = new Gio.Cancellable();
        this._commandTimeoutMs = commandTimeoutMs;
        this._queryTimeoutMs = queryTimeoutMs;
    }

    get cancelled() {
        return this._cancellable.is_cancelled();
    }

    destroy() {
        this._cancellable.cancel();
    }

    status() {
        return getNetBirdStatus(this._queryOptions());
    }

    subscribeStatus(onStatus, onError) {
        return subscribeNetBirdStatus({
            cancellable: this._cancellable,
            onError,
            onStatus,
        });
    }

    profiles() {
        return listProfiles(this._queryOptions());
    }

    networks() {
        return listNetworks(this._queryOptions());
    }

    config(profileId) {
        return getNetBirdConfig(profileId, this._queryOptions());
    }

    features() {
        return getNetBirdFeatures(this._queryOptions());
    }

    connect(profileId = '') {
        return connectNetBird({
            ...this._commandOptions(),
            profileName: profileId,
        });
    }

    disconnect() {
        return disconnectNetBird(this._commandOptions());
    }

    switchProfile(profileId) {
        return switchProfile(profileId, this._commandOptions());
    }

    addProfile(name) {
        return addProfile(name, this._commandOptions());
    }

    renameProfile(profileId, name) {
        return renameProfile(profileId, name, this._commandOptions());
    }

    removeProfile(profileId) {
        return removeProfile(profileId, this._commandOptions());
    }

    logoutProfile(profileId) {
        return deregisterProfile(profileId, this._commandOptions());
    }

    selectNetworks(ids, {all = false, append = true} = {}) {
        return selectNetworks(ids, {
            ...this._commandOptions(),
            all,
            append,
        });
    }

    deselectNetworks(ids = [], {all = false} = {}) {
        return deselectNetworks(ids, {
            ...this._commandOptions(),
            all,
        });
    }

    updateConfig(changes) {
        return setNetBirdConfig(changes, this._commandOptions());
    }

    login(options = {}) {
        return loginNetBird({...options, cancellable: this._cancellable});
    }

    waitForSso(userCode, options = {}) {
        return waitForSsoLogin(userCode, {
            ...options,
            cancellable: this._cancellable,
        });
    }

    createDebugBundle(options = {}) {
        return createDebugBundle({...options, ...this._commandOptions()});
    }

    triggerUpdate() {
        return requestDaemonUpdate(this._commandOptions());
    }

    _queryOptions() {
        return {
            cancellable: this._cancellable,
            timeoutMs: this._queryTimeoutMs,
        };
    }

    _commandOptions() {
        return {
            cancellable: this._cancellable,
            timeoutMs: this._commandTimeoutMs,
        };
    }
}
