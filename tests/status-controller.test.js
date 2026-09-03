// SPDX-License-Identifier: GPL-3.0-or-later

import {StatusController} from '../shell/statusController.js';

const tests = [
    ['profiles are available when policy allows them', async () => {
        const fixture = await createFixture(false);
        if (fixture.state.profileName !== 'Work' ||
            fixture.state.profiles.length !== 1)
            throw new Error('available profiles were not published');

        fixture.controller.destroy();
    }],
    ['profile policy removes Quick Settings profile actions', async () => {
        const fixture = await createFixture(true);
        if (fixture.state.profileName || fixture.state.profiles.length)
            throw new Error('disabled profiles were published');
        fixture.controller.destroy();
    }],
    ['unavailable state opens setup without trying to connect', async () => {
        const fixture = await createFixture(false);
        const handledInShell = await fixture.controller.toggleConnection();
        if (handledInShell)
            throw new Error('unavailable state was handled as a connection toggle');
        if (fixture.client.connectCalls !== 0)
            throw new Error('connection was attempted without a socket');
        fixture.controller.destroy();
    }],
];

async function createFixture(disableProfiles) {
    const client = new FakeClient(disableProfiles);
    let state = null;
    const controller = new StatusController({
        client,
        onActionError() {
        },
        onStateChanged(nextState) {
            state = nextState;
        },
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    return {client, controller, state};
}

class FakeClient {
    constructor(disableProfiles) {
        this.cancelled = false;
        this.connectCalls = 0;
        this._disableProfiles = disableProfiles;
    }

    connect() {
        this.connectCalls++;
        return Promise.resolve();
    }

    destroy() {
        this.cancelled = true;
    }

    features() {
        return Promise.resolve({disableProfiles: this._disableProfiles});
    }

    profiles() {
        return Promise.resolve({
            activeProfile: 'Work',
            profiles: [{id: 'work', isActive: true, name: 'Work'}],
        });
    }

    subscribeStatus() {
    }
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
