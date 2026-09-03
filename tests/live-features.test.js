// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    addProfile,
    connectNetBird,
    createDebugBundle,
    deselectNetworks,
    deregisterProfile,
    disconnectNetBird,
    getNetBirdConfig,
    getNetBirdFeatures,
    getNetBirdStatus,
    listNetworks,
    listProfiles,
    loginNetBird,
    NetBirdDaemonError,
    removeProfile,
    renameProfile,
    requestDaemonUpdate,
    selectNetworks,
    setNetBirdConfig,
    subscribeNetBirdStatus,
    switchProfile,
    waitForSsoLogin,
} from '../netbird/client.js';

const TIMEOUT_MS = 15000;
const STATE_TIMEOUT_SECONDS = 45;
const MANAGEMENT_URL = GLib.getenv('NETBIRD_TEST_MANAGEMENT_URL') || '';
const SETUP_KEY_FILE = GLib.getenv('NETBIRD_TEST_SETUP_KEY_FILE') || '';
const FAILURES = [];

const SETTINGS = [
    {api: 'serverSSHAllowed', label: 'Allow SSH', type: 'boolean'},
    {api: 'blockInbound', label: 'Block Inbound', type: 'boolean'},
    {api: 'blockLanAccess', label: 'Block LAN Access', type: 'boolean'},
    {api: 'disableAutoConnect', label: 'Connect on Startup', type: 'boolean'},
    {api: 'disableClientRoutes', label: 'Disable Client Routes', type: 'boolean'},
    {api: 'disableDns', label: 'Disable DNS', type: 'boolean'},
    {api: 'disableIpv6', label: 'Disable IPv6', type: 'boolean'},
    {api: 'disableServerRoutes', label: 'Disable Server Routes', type: 'boolean'},
    {api: 'disableSSHAuth', label: 'Disable SSH Authentication', type: 'boolean'},
    {api: 'interfaceName', label: 'Interface Name', type: 'idempotent'},
    {api: 'wireguardPort', label: 'Interface Port', type: 'integer'},
    {api: 'sshJWTCacheTTL', label: 'JWT Cache TTL', type: 'integer-toggle'},
    {api: 'lazyConnectionEnabled', label: 'Lazy Connections', type: 'boolean'},
    {api: 'managementUrl', label: 'Management URL', type: 'idempotent'},
    {api: 'mtu', label: 'MTU', type: 'integer'},
    {api: 'networkMonitor', label: 'Network Monitor', type: 'boolean'},
    {api: 'disableNotifications', label: 'Notifications', type: 'boolean'},
    {api: 'optionalPreSharedKey', label: 'Pre-shared Key', read: 'preSharedKey', type: 'secret'},
    {api: 'rosenpassPermissive', label: 'Quantum Resistance', type: 'boolean'},
    {api: 'enableSSHLocalPortForwarding', label: 'SSH Local Port Forwarding', type: 'boolean'},
    {api: 'enableSSHRemotePortForwarding', label: 'SSH Remote Port Forwarding', type: 'boolean'},
    {api: 'enableSSHRoot', label: 'SSH Root Login', type: 'boolean'},
    {api: 'enableSSHSFTP', label: 'SSH SFTP', type: 'boolean'},
];

const RECONNECT_SETTINGS = new Set([
    'blockInbound',
    'blockLanAccess',
    'disableClientRoutes',
    'disableDns',
    'disableIpv6',
    'disableServerRoutes',
    'interfaceName',
    'lazyConnectionEnabled',
    'managementUrl',
    'mtu',
    'networkMonitor',
    'optionalPreSharedKey',
    'rosenpassPermissive',
    'serverSSHAllowed',
    'wireguardPort',
]);

async function main() {
    if (GLib.getenv('NETBIRD_LIVE_FULL') !== '1')
        throw new Error('Set NETBIRD_LIVE_FULL=1 to authorize reversible mutations');

    const originalStatus = await run('Status and GetActiveProfile', () =>
        getNetBirdStatus({timeoutMs: TIMEOUT_MS}));
    const originalProfiles = await run('ListProfiles', () =>
        listProfiles({timeoutMs: TIMEOUT_MS}));
    const originalProfile = originalProfiles.profiles.find(profile => profile.isActive);
    const originalHandle = originalProfile?.id || originalProfile?.name ||
        originalStatus.profileName;
    if (!originalHandle)
        throw new Error('daemon did not report an active profile');

    await run('GetConfig', () =>
        getNetBirdConfig(originalHandle, {timeoutMs: TIMEOUT_MS}));
    await run('GetFeatures', () => getNetBirdFeatures({timeoutMs: TIMEOUT_MS}));
    await run('SubscribeStatus', firstStatusSnapshot);
    await testSettings(originalHandle);
    await keepTesting('Networks feature group', testNetworks);
    await keepTesting('Diagnostics feature group', testDiagnostics);
    await keepTesting('WaitSSOLogin feature', testInvalidSsoWait);
    if (SETUP_KEY_FILE) {
        await keepTesting('Disposable profile feature group', () =>
            testDisposableProfile(originalHandle, originalStatus.status));
    } else {
        print('ok disposable profile Login/Logout skipped (no setup-key file)');
    }
    await keepTesting('Connection feature group', () =>
        testConnectionCycle(originalHandle, originalStatus.status));

    const restoredProfiles = await listProfiles({timeoutMs: TIMEOUT_MS});
    const restored = restoredProfiles.profiles.find(profile => profile.isActive);
    if (restored?.id !== originalProfile?.id || restored?.name !== originalProfile?.name)
        throw new Error('active profile was not restored');
    await assertStateRestored(originalStatus.status);
    print('ok original profile and connection state restored');
    if (FAILURES.length > 0)
        throw new Error(`${FAILURES.length} live feature check(s) failed`);
}

async function testSettings(profileHandle) {
    for (const setting of SETTINGS) {
        await keepTesting(`SetConfig ${setting.label}`, () =>
            testSetting(profileHandle, setting));
    }
}

async function testSetting(profileHandle, setting) {
    const before = await getNetBirdConfig(profileHandle, {timeoutMs: TIMEOUT_MS});
    const readField = setting.read ?? setting.api;
    if (!(readField in before.config))
        throw new Error(`${setting.label} is missing from GetConfig`);

    const original = before.config[readField];
    const candidate = candidateValue(setting, original);
    if (candidate.skip) {
        print(`ok SetConfig ${setting.label} protected value preserved`);
        return;
    }

    let changed = false;
    let testError = null;
    try {
        try {
            await setNetBirdConfig({
                [setting.api]: candidate.value,
                profileName: profileHandle,
            }, {timeoutMs: TIMEOUT_MS});
            changed = !sameValue(candidate.value, original);
        } catch (error) {
            if (error instanceof NetBirdDaemonError && error.privilegeRequired) {
                print(`ok SetConfig ${setting.label} structured privilege refusal`);
                return;
            }
            throw error;
        }

        let after = await getNetBirdConfig(profileHandle, {timeoutMs: TIMEOUT_MS});
        if (!sameValue(after.config[readField], candidate.value) &&
            RECONNECT_SETTINGS.has(setting.api)) {
            await reconnectIfConnected(profileHandle);
            after = await getNetBirdConfig(profileHandle, {timeoutMs: TIMEOUT_MS});
        }
        if (!sameValue(after.config[readField], candidate.value)) {
            throw new Error(
                `${setting.label} readback mismatch: ${after.config[readField]}`);
        }
        print(`ok SetConfig ${setting.label} write and readback`);
    } catch (error) {
        testError = error;
    }

    if (changed) {
        await setNetBirdConfig({
            [setting.api]: original,
            profileName: profileHandle,
        }, {timeoutMs: TIMEOUT_MS});
        const restored = await getNetBirdConfig(
            profileHandle, {timeoutMs: TIMEOUT_MS});
        if (!sameValue(restored.config[readField], original))
            throw new Error(`${setting.label} was not restored`);
    }

    if (testError)
        throw testError;
}

async function reconnectIfConnected(profileHandle) {
    const status = await getNetBirdStatus({timeoutMs: TIMEOUT_MS});
    if (status.status !== 'Connected' && status.status !== 'Connecting')
        return;
    await disconnectNetBird({timeoutMs: TIMEOUT_MS});
    await waitForState('Idle');
    await connectNetBird({profileName: profileHandle, timeoutMs: TIMEOUT_MS});
    await waitForState('Connected');
}

function candidateValue(setting, original) {
    switch (setting.type) {
    case 'boolean':
        return {value: !original};
    case 'integer-toggle': {
        const value = Number(original);
        return {value: Number.isFinite(value) && value < 2147483647 ? value + 1 : 900};
    }
    case 'integer':
        return {value: Number(original)};
    case 'idempotent':
        return {value: String(original ?? '')};
    case 'secret':
        return String(original ?? '') === ''
            ? {value: ''}
            : {skip: true};
    default:
        throw new Error(`unknown setting test type: ${setting.type}`);
    }
}

function sameValue(left, right) {
    if (typeof left === 'boolean' || typeof right === 'boolean')
        return Boolean(left) === Boolean(right);
    if (!Number.isNaN(Number(left)) && !Number.isNaN(Number(right)) &&
        String(left) !== '' && String(right) !== '')
        return Number(left) === Number(right);

    return String(left ?? '') === String(right ?? '');
}

async function testNetworks() {
    const initial = await run('ListNetworks', () =>
        listNetworks({timeoutMs: TIMEOUT_MS}));
    const route = initial.networks.find(network => network.id && !network.isExitNode) ||
        initial.networks.find(network => network.id);
    if (!route) {
        print('ok SelectNetworks/DeselectNetworks skipped (daemon returned no routes)');
        return;
    }

    try {
        if (route.selected) {
            await run('DeselectNetworks', () =>
                deselectNetworks([route.id], {timeoutMs: TIMEOUT_MS}));
            await assertNetworkSelection(route.id, false);
            await run('SelectNetworks restore', () =>
                selectNetworks([route.id], {append: true, timeoutMs: TIMEOUT_MS}));
        } else {
            await run('SelectNetworks', () =>
                selectNetworks([route.id], {append: true, timeoutMs: TIMEOUT_MS}));
            await assertNetworkSelection(route.id, true);
            await run('DeselectNetworks restore', () =>
                deselectNetworks([route.id], {timeoutMs: TIMEOUT_MS}));
        }
        await assertNetworkSelection(route.id, route.selected);
    } catch (error) {
        await restoreNetwork(route);
        throw error;
    }
}

async function restoreNetwork(route) {
    const current = await listNetworks({timeoutMs: TIMEOUT_MS});
    const selected = current.networks.find(network => network.id === route.id)?.selected;
    if (selected === route.selected)
        return;
    if (route.selected)
        await selectNetworks([route.id], {append: true, timeoutMs: TIMEOUT_MS});
    else
        await deselectNetworks([route.id], {timeoutMs: TIMEOUT_MS});
}

async function assertNetworkSelection(id, expected) {
    const networks = await listNetworks({timeoutMs: TIMEOUT_MS});
    const route = networks.networks.find(network => network.id === id);
    if (!route || route.selected !== expected)
        throw new Error(`network ${id} selected=${route?.selected}; expected ${expected}`);
}

async function testDiagnostics() {
    const bundle = await run('DebugBundle', () => createDebugBundle({
        anonymize: true,
        systemInfo: false,
        timeoutMs: TIMEOUT_MS,
    }));
    if (!bundle.data.path && !bundle.data.uploadedKey)
        throw new Error('DebugBundle returned no path or upload key');

    const update = await run('TriggerUpdate', () =>
        requestDaemonUpdate({timeoutMs: TIMEOUT_MS}));
    if (typeof update.success !== 'boolean')
        throw new Error('TriggerUpdate returned no success flag');
}

async function testInvalidSsoWait() {
    try {
        await waitForSsoLogin('INVALID-LIVE-TEST-CODE', {
            hostname: GLib.get_host_name(),
            timeoutMs: 1000,
        });
    } catch {
        print('ok WaitSSOLogin invalid-code error');
        return;
    }
    throw new Error('WaitSSOLogin unexpectedly accepted an invalid code');
}

async function testDisposableProfile(originalHandle, originalState) {
    const suffix = GLib.uuid_string_random().slice(0, 8);
    const firstName = `GNOME API Test ${suffix}`;
    const secondName = `GNOME API Renamed ${suffix}`;
    let temporaryHandle = '';

    try {
        if (originalState === 'Connected' || originalState === 'Connecting') {
            await run('Down before disposable profile', () =>
                disconnectNetBird({timeoutMs: TIMEOUT_MS}));
            await waitForState('Idle');
        }

        const added = await run('AddProfile', () =>
            addProfile(firstName, {timeoutMs: TIMEOUT_MS}));
        temporaryHandle = String(added.data.id ?? '');
        if (!temporaryHandle)
            throw new Error('AddProfile returned no profile ID');

        await run('RenameProfile', () => renameProfile(
            temporaryHandle, secondName, {timeoutMs: TIMEOUT_MS}));
        await run('SwitchProfile disposable', () =>
            switchProfile(temporaryHandle, {timeoutMs: TIMEOUT_MS}));

        const setupKey = readSecretFile(SETUP_KEY_FILE);
        const login = await run('Login disposable profile', () => loginNetBird({
            managementUrl: MANAGEMENT_URL,
            setupKey,
            timeoutMs: 60000,
        }));
        if (login.needsSsoLogin)
            throw new Error('setup-key Login unexpectedly requested SSO');

        await run('Up disposable profile', () => connectNetBird({
            profileName: temporaryHandle,
            timeoutMs: TIMEOUT_MS,
        }));
        await waitForState('Connected');
        await run('Logout disposable profile', () =>
            deregisterProfile(temporaryHandle, {timeoutMs: TIMEOUT_MS}));
    } finally {
        await restoreOriginalProfile(originalHandle, originalState, temporaryHandle);
    }
}

function readSecretFile(path) {
    const [ok, contents] = Gio.File.new_for_path(path).load_contents(null);
    if (!ok)
        throw new Error('could not read the setup-key file');
    const secret = new TextDecoder().decode(contents).trim();
    if (!secret)
        throw new Error('setup-key file is empty');
    return secret;
}

async function restoreOriginalProfile(originalHandle, originalState, temporaryHandle) {
    try {
        await disconnectNetBird({timeoutMs: TIMEOUT_MS});
    } catch {
        // The disposable profile may already be logged out and idle.
    }
    await switchProfile(originalHandle, {timeoutMs: TIMEOUT_MS});
    if (temporaryHandle) {
        try {
            await removeProfile(temporaryHandle, {timeoutMs: TIMEOUT_MS});
            print('ok RemoveProfile disposable cleanup');
        } catch (error) {
            printerr(`not ok RemoveProfile disposable cleanup: ${error}`);
            throw error;
        }
    }
    if (originalState === 'Connected' || originalState === 'Connecting') {
        await connectNetBird({profileName: originalHandle, timeoutMs: TIMEOUT_MS});
        await waitForState('Connected');
    }
}

async function testConnectionCycle(profileHandle, originalState) {
    if (originalState === 'Connected' || originalState === 'Connecting') {
        await run('Down connection cycle', () =>
            disconnectNetBird({timeoutMs: TIMEOUT_MS}));
        await run('Status reaches Idle', () => waitForState('Idle'));
        await run('Up connection cycle', () => connectNetBird({
            profileName: profileHandle,
            timeoutMs: TIMEOUT_MS,
        }));
        await run('Status reaches Connected', () => waitForState('Connected'));
    } else if (originalState === 'Idle') {
        await run('Up connection cycle', () => connectNetBird({
            profileName: profileHandle,
            timeoutMs: TIMEOUT_MS,
        }));
        await run('Status reaches Connected', () => waitForState('Connected'));
        await run('Down connection cycle', () =>
            disconnectNetBird({timeoutMs: TIMEOUT_MS}));
        await run('Status reaches Idle', () => waitForState('Idle'));
    } else {
        print(`ok connection cycle skipped from ${originalState}`);
    }
}

async function assertStateRestored(originalState) {
    if (originalState === 'Connected' || originalState === 'Connecting')
        await waitForState('Connected');
    else if (originalState === 'Idle')
        await waitForState('Idle');
}

function firstStatusSnapshot() {
    return new Promise((resolve, reject) => {
        const cancellable = new Gio.Cancellable();
        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TIMEOUT_MS, () => {
            cancellable.cancel();
            reject(new Error('SubscribeStatus timed out'));
            return GLib.SOURCE_REMOVE;
        });

        subscribeNetBirdStatus({
            cancellable,
            onError: error => {
                GLib.Source.remove(timeoutId);
                reject(error);
            },
            onStatus: snapshot => {
                GLib.Source.remove(timeoutId);
                cancellable.cancel();
                if (!snapshot.state)
                    reject(new Error('SubscribeStatus returned no state'));
                else
                    resolve(snapshot);
            },
        });
    });
}

async function waitForState(expected) {
    const deadline = GLib.get_monotonic_time() +
        STATE_TIMEOUT_SECONDS * GLib.USEC_PER_SEC;
    let last = '';
    while (GLib.get_monotonic_time() < deadline) {
        const status = await getNetBirdStatus({timeoutMs: TIMEOUT_MS});
        last = status.status;
        if (last === expected)
            return status;
        await delay(250);
    }
    throw new Error(`expected ${expected}, last state was ${last}`);
}

function delay(milliseconds) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

async function run(name, callback) {
    try {
        const result = await callback();
        print(`ok ${name}`);
        return result;
    } catch (error) {
        printerr(`not ok ${name}: ${error}`);
        throw error;
    }
}

async function keepTesting(name, callback) {
    try {
        return await callback();
    } catch (error) {
        FAILURES.push({error, name});
        printerr(`not ok ${name}: ${error}`);
        return null;
    }
}

await main();
