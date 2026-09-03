// SPDX-License-Identifier: GPL-3.0-or-later

import {MASKED_PRESHARED_KEY, SettingsController} from
    '../prefs/settingsController.js';

const tests = [
    ['load maps inverted and direct settings', async () => {
        const fixture = createFixture();
        await fixture.controller.load();
        const values = fixture.loaded.values;
        if (values.get('connectOnStartup') !== false ||
            values.get('notifications') !== false ||
            values.get('blockInbound') !== false)
            throw new Error('settings were not mapped from GetConfig');
    }],
    ['non-reconnect setting writes and verifies readback', async () => {
        const fixture = createFixture();
        await fixture.controller.load();
        await fixture.controller.setValue('notifications', true);
        if (fixture.client.configData.disableNotifications !== false)
            throw new Error('notification inversion was not sent');
        if (fixture.restored.length || fixture.errors.length)
            throw new Error('successful setting was reported as failed');
        assertCalls(fixture.client, ['update:disableNotifications', 'config']);
    }],
    ['reconnect setting disconnects, reconnects, and verifies', async () => {
        const fixture = createFixture();
        await fixture.controller.load();
        await fixture.controller.setValue('blockInbound', true);
        assertCalls(fixture.client, [
            'update:blockInbound', 'status', 'disconnect', 'connect:default', 'config',
        ]);
        if (fixture.client.configData.blockInbound !== true)
            throw new Error('reconnect setting was not persisted');
    }],
    ['silently ignored daemon write restores the row', async () => {
        const fixture = createFixture({ignoredField: 'lazyConnectionEnabled'});
        await fixture.controller.load();
        await fixture.controller.setValue('lazyConnections', true);
        if (fixture.restored.length !== 1 ||
            fixture.restored[0].key !== 'lazyConnections' ||
            fixture.restored[0].value !== false)
            throw new Error('ignored write did not restore its old value');

        if (fixture.errors.length !== 1 ||
            !String(fixture.errors[0].error).includes('did not apply'))
            throw new Error('ignored write did not report a useful error');

        assertCalls(fixture.client, [
            'update:lazyConnectionEnabled',
            'status',
            'disconnect',
            'connect:default',
            'config',
            'update:lazyConnectionEnabled',
        ]);
    }],
    ['failed daemon write restores the row without reconnecting', async () => {
        const fixture = createFixture({failedField: 'disableNotifications'});
        await fixture.controller.load();
        await fixture.controller.setValue('notifications', true);
        if (fixture.restored[0]?.value !== false || fixture.errors.length !== 1)
            throw new Error('failed write did not restore the row');
        assertCalls(fixture.client, ['update:disableNotifications']);
    }],
    ['numeric protobuf readback accepts int64 strings', async () => {
        const fixture = createFixture({stringifyNumbers: true});
        await fixture.controller.load();
        await fixture.controller.setValue('interfacePort', 51821);
        if (fixture.restored.length || fixture.errors.length)
            throw new Error('numeric string readback was rejected');
    }],
    ['omitted false and empty fields use protojson defaults', async () => {
        const fixture = createFixture({omitDefaults: true});
        fixture.client.configData.blockInbound = true;
        await fixture.controller.load();
        await fixture.controller.setValue('blockInbound', false);
        if (fixture.restored.length || fixture.errors.length)
            throw new Error('omitted boolean readback was rejected');
    }],
    ['masked pre-shared key is never written back', async () => {
        const fixture = createFixture();
        fixture.client.configData.preSharedKey = MASKED_PRESHARED_KEY;
        await fixture.controller.load();
        await fixture.controller.setValue('preSharedKey', MASKED_PRESHARED_KEY);
        assertCalls(fixture.client, []);
    }],
    ['MDM-managed settings are exposed as read-only', async () => {
        const fixture = createFixture();
        fixture.client.configData.mDMManagedFields = [
            'blockInbound',
            'disableAutoConnect',
            'unknownFuturePolicy',
        ];
        await fixture.controller.load();
        if (fixture.loaded.managedKeys.join(',') !==
            'blockInbound,connectOnStartup')
            throw new Error('managed fields were not mapped to settings rows');

        await fixture.controller.setValue('blockInbound', true);
        assertCalls(fixture.client, []);
    }],
    ['destroyed controller does not update the window', async () => {
        const fixture = createFixture();
        fixture.controller.destroy();
        await fixture.controller.load();
        if (fixture.busy.length || fixture.loaded || fixture.errors.length)
            throw new Error('destroyed controller invoked a window callback');
    }],
];

function createFixture({
    failedField = '', ignoredField = '', omitDefaults = false,
    stringifyNumbers = false,
} = {}) {
    const client = new FakeClient({
        failedField,
        ignoredField,
        omitDefaults,
        stringifyNumbers,
    });
    const fixture = {
        busy: [],
        client,
        errors: [],
        loaded: null,
        restored: [],
    };
    fixture.controller = new SettingsController({
        client,
        onBusyChanged: busy => fixture.busy.push(busy),
        onError: (title, error) => fixture.errors.push({error, title}),
        onLoaded: loaded => {
            fixture.loaded = loaded;
            client.calls.length = 0;
        },
        onValueRestored: (key, value) => fixture.restored.push({key, value}),
    });
    return fixture;
}

class FakeClient {
    constructor({failedField, ignoredField, omitDefaults, stringifyNumbers}) {
        this.calls = [];
        this.cancelled = false;
        this.failedField = failedField;
        this.ignoredField = ignoredField;
        this.omitDefaults = omitDefaults;
        this.stringifyNumbers = stringifyNumbers;
        this.configData = {
            blockInbound: false,
            disableAutoConnect: true,
            disableNotifications: true,
            interfaceName: 'wt0',
            lazyConnectionEnabled: false,
            preSharedKey: '',
            wireguardPort: '51820',
        };
    }

    destroy() {
        this.cancelled = true;
    }

    async profiles() {
        return {
            profiles: [{id: 'default', isActive: true, name: 'default'}],
        };
    }

    async config() {
        this.calls.push('config');
        const config = {...this.configData};
        if (this.omitDefaults) {
            for (const [key, value] of Object.entries(config)) {
                if (value === false || value === '')
                    delete config[key];
            }
        }
        return {config};
    }

    async features() {
        return {};
    }

    async updateConfig(changes) {
        const field = Object.keys(changes).find(key => key !== 'profileName');
        this.calls.push(`update:${field}`);
        if (field === this.failedField)
            throw new Error('daemon rejected the setting');
        if (field !== this.ignoredField) {
            const value = this.stringifyNumbers && typeof changes[field] === 'number'
                ? String(changes[field])
                : changes[field];
            const readField = field === 'optionalPreSharedKey' ? 'preSharedKey' : field;
            this.configData[readField] = value;
        }
        return {data: {}};
    }

    async status() {
        this.calls.push('status');
        return {snapshot: {connected: true}};
    }

    async disconnect() {
        this.calls.push('disconnect');
    }

    async connect(profile) {
        this.calls.push(`connect:${profile}`);
    }
}

function assertCalls(client, expected) {
    const actual = client.calls.join(',');
    const wanted = expected.join(',');
    if (actual !== wanted)
        throw new Error(`unexpected calls: ${actual}; expected ${wanted}`);
}

for (const [name, test] of tests) {
    try {
        await test();
        print(`ok ${name}`);
    } catch (error) {
        printerr(`not ok ${name}: ${error}`);
        throw error;
    }
}
