// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    connectNetBird,
    disconnectNetBird,
    getNetBirdConfig,
    getNetBirdFeatures,
    getNetBirdStatus,
    listNetworks,
    listProfiles,
    setNetBirdConfig,
    subscribeNetBirdStatus,
} from '../netbird/client.js';

const TIMEOUT_MS = 15000;
const MUTATIONS_ENABLED = GLib.getenv('NETBIRD_LIVE_MUTATIONS') === '1';

async function main() {
    const status = await run('Status and GetActiveProfile', () =>
        getNetBirdStatus({timeoutMs: TIMEOUT_MS}));
    if (!status.status || !status.daemonVersion)
        throw new Error('live Status response omitted status or daemonVersion');

    const profiles = await run('ListProfiles', () =>
        listProfiles({timeoutMs: TIMEOUT_MS}));
    if (!Array.isArray(profiles.profiles))
        throw new Error('live ListProfiles response omitted profiles');

    const active = profiles.profiles.find(profile => profile.isActive);
    const profileHandle = active?.id || active?.name || status.profileName;
    if (!profileHandle)
        throw new Error('live daemon did not report an active profile');

    const config = await run('GetConfig', () =>
        getNetBirdConfig(profileHandle, {timeoutMs: TIMEOUT_MS}));
    await run('GetFeatures', () => getNetBirdFeatures({timeoutMs: TIMEOUT_MS}));
    await run('ListNetworks', () => listNetworks({timeoutMs: TIMEOUT_MS}));
    await run('SubscribeStatus first snapshot', firstStatusSnapshot);

    if (!MUTATIONS_ENABLED) {
        print('ok mutation checks skipped (set NETBIRD_LIVE_MUTATIONS=1)');
        return;
    }

    await run('SetConfig idempotent notification write', () =>
        setNetBirdConfig({
            disableNotifications: Boolean(config.config.disableNotifications),
            profileName: profileHandle,
        }, {timeoutMs: TIMEOUT_MS}));

    if (status.status === 'Connected') {
        await run('Down', () => disconnectNetBird({timeoutMs: TIMEOUT_MS}));
        await run('Status reaches Idle', () => waitForState('Idle'));
        await run('Up', () => connectNetBird({
            profileName: profileHandle,
            timeoutMs: TIMEOUT_MS,
        }));
        await run('Status returns to Connected', () => waitForState('Connected'));
    } else if (status.status === 'Idle') {
        await run('Up', () => connectNetBird({
            profileName: profileHandle,
            timeoutMs: TIMEOUT_MS,
        }));
        await run('Status reaches Connected', () => waitForState('Connected'));
        await run('Down', () => disconnectNetBird({timeoutMs: TIMEOUT_MS}));
        await run('Status returns to Idle', () => waitForState('Idle'));
    } else {
        print(`ok connection cycle skipped from ${status.status}`);
    }
}

function firstStatusSnapshot() {
    return new Promise((resolve, reject) => {
        const cancellable = new Gio.Cancellable();
        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TIMEOUT_MS, () => {
            cancellable.cancel();
            reject(new Error('live SubscribeStatus timed out'));
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
                    reject(new Error('live status stream returned no state'));
                else
                    resolve(snapshot);
            },
        });
    });
}

async function waitForState(expected) {
    const deadline = GLib.get_monotonic_time() + 30 * GLib.USEC_PER_SEC;
    let last = '';
    while (GLib.get_monotonic_time() < deadline) {
        const status = await getNetBirdStatus({timeoutMs: TIMEOUT_MS});
        last = status.status;
        if (last === expected)
            return;
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

await main();
