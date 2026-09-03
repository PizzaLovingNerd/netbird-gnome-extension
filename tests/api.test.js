// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    normalizeNetwork,
    normalizePeer,
    normalizeProfile,
    normalizeStatus,
} from '../netbird/normalize.js';

const TEST_TIMEOUT_MS = 1000;
const TEST_SOCKET_PATH = GLib.build_filenamev([
    GLib.get_tmp_dir(),
    `netbird-gnome-test-${GLib.uuid_string_random()}.sock`,
]);

GLib.setenv('NETBIRD_GNOME_TEST_SOCKET', TEST_SOCKET_PATH, true);

const {
    addProfile,
    connectNetBird,
    createDebugBundle,
    deselectNetworks,
    deregisterProfile,
    disconnectNetBird,
    getNetBirdFeatures,
    getNetBirdConfig,
    getNetBirdStatus,
    isNetBirdSocketAvailable,
    isNetBirdVersionSupported,
    listNetworks,
    listProfiles,
    loginNetBird,
    NETBIRD_MINIMUM_VERSION,
    NetBirdClient,
    NetBirdDaemonError,
    removeProfile,
    renameProfile,
    requestDaemonUpdate,
    selectNetworks,
    setNetBirdConfig,
    subscribeNetBirdStatus,
    switchProfile,
    waitForSsoLogin,
} = await import('../netbird/client.js');

const tests = [
    ['minimum supported release', () => {
        if (NETBIRD_MINIMUM_VERSION !== '0.76.0')
            throw new Error(`unexpected minimum version: ${NETBIRD_MINIMUM_VERSION}`);
    }],
    ['NetBird release comparison', () => {
        const cases = [
            ['0.75.1', false],
            ['0.76.0', true],
            ['v0.76.1', true],
            ['0.76.1-rc.1', true],
            ['0.77.0', true],
            ['1.0.0', true],
            ['development', false],
            ['', false],
        ];

        for (const [version, expected] of cases) {
            if (isNetBirdVersionSupported(version) !== expected)
                throw new Error(`unexpected support result for ${version}`);
        }
    }],
    ['Unix socket is available', () => {
        if (!isNetBirdSocketAvailable())
            throw new Error('test Unix socket was not detected');
    }],
    ['missing Unix socket is reported', async () => {
        await withoutTestSocket(() => {
            if (isNetBirdSocketAvailable())
                throw new Error('missing Unix socket was reported as available');
        });
    }],
    ['connectNetBird', () => connectNetBird({profileName: 'default', timeoutMs: TEST_TIMEOUT_MS})],
    ['connectNetBird with cancellable', () =>
        connectNetBird({...withCancellable(), profileName: 'default'})],
    ['connectNetBird omits an empty profile', () => withContract({
        method: 'Up',
        request: {async: true, username: GLib.get_user_name()},
    }, () => connectNetBird({timeoutMs: TEST_TIMEOUT_MS}))],
    ['connectNetBird preserves Unicode profile names', () => withContract({
        method: 'Up',
        request: {
            async: true,
            profileName: 'Équipe 🐦',
            username: GLib.get_user_name(),
        },
    }, () => connectNetBird({
        profileName: 'Équipe 🐦',
        timeoutMs: TEST_TIMEOUT_MS,
    }))],
    ['deregisterProfile', () => deregisterProfile('default', {timeoutMs: TEST_TIMEOUT_MS})],
    ['deregisterProfile with cancellable', () =>
        deregisterProfile('default', withCancellable())],
    ['deregisterProfile omits an empty profile', () => withContract({
        method: 'Logout',
        request: {username: GLib.get_user_name()},
    }, () => deregisterProfile('', {timeoutMs: TEST_TIMEOUT_MS}))],
    ['createDebugBundle', () => createDebugBundle({timeoutMs: TEST_TIMEOUT_MS})],
    ['createDebugBundle with cancellable', () =>
        createDebugBundle(withCancellable())],
    ['createDebugBundle serializes every exposed option', async () => {
        const result = await withContract({
            method: 'DebugBundle',
            request: {
                anonymize: true,
                systemInfo: false,
                uploadURL: '',
            },
            response: {path: '/tmp/netbird-debug.zip', uploadedKey: 'case-42'},
        }, () => createDebugBundle({
            anonymize: true,
            systemInfo: false,
            timeoutMs: TEST_TIMEOUT_MS,
        }));
        if (result.data.path !== '/tmp/netbird-debug.zip' ||
            result.data.uploadedKey !== 'case-42')
            throw new Error('expected DebugBundle response fields');
    }],
    ['requestDaemonUpdate', () => requestDaemonUpdate({timeoutMs: TEST_TIMEOUT_MS})],
    ['requestDaemonUpdate with cancellable', () =>
        requestDaemonUpdate(withCancellable())],
    ['requestDaemonUpdate reports daemon refusal', async () => {
        const result = await withContract({
            method: 'TriggerUpdate',
            request: {},
            response: {errorMsg: 'No enforced update is pending', success: false},
        }, () => requestDaemonUpdate({timeoutMs: TEST_TIMEOUT_MS}));
        if (result.success || result.errorMessage !== 'No enforced update is pending' ||
            result.message !== 'No enforced update is pending')
            throw new Error('expected normalized TriggerUpdate refusal');
    }],
    ['disconnectNetBird', () => disconnectNetBird({timeoutMs: TEST_TIMEOUT_MS})],
    ['disconnectNetBird with cancellable', () => disconnectNetBird(withCancellable())],
    ['disconnectNetBird returns an immediate disconnected state', async () => {
        const result = await disconnectNetBird({timeoutMs: TEST_TIMEOUT_MS});
        if (result.status !== 'Disconnected')
            throw new Error('expected immediate Down state');
    }],
    ['getNetBirdConfig', async () => {
        const result = await getNetBirdConfig('Work Profile', {
            timeoutMs: TEST_TIMEOUT_MS,
        });
        if (result.config.managementUrl !== 'https://api.netbird.io')
            throw new Error('expected GetConfig response');
    }],
    ['getNetBirdConfig preserves every settings field', async () => {
        const config = {
            blockInbound: true,
            blockLanAccess: true,
            disableAutoConnect: true,
            disableClientRoutes: true,
            disableDns: true,
            disableIpv6: true,
            disableNotifications: true,
            disableServerRoutes: true,
            disableSSHAuth: true,
            enableSSHLocalPortForwarding: true,
            enableSSHRemotePortForwarding: true,
            enableSSHRoot: true,
            enableSSHSFTP: true,
            interfaceName: 'wt0',
            lazyConnectionEnabled: true,
            managementUrl: 'https://management.example',
            mtu: '1280',
            networkMonitor: true,
            preSharedKey: '**********',
            rosenpassPermissive: true,
            serverSSHAllowed: true,
            sshJWTCacheTTL: 900,
            wireguardPort: '51820',
        };
        const result = await withContract({
            method: 'GetConfig',
            request: {
                profileName: 'profile-id',
                username: GLib.get_user_name(),
            },
            response: config,
        }, () => getNetBirdConfig('profile-id', {timeoutMs: TEST_TIMEOUT_MS}));
        assertObjectEqual(result.config, config, 'GetConfig response');
    }],
    ['listNetworks', async () => {
        const result = await listNetworks({timeoutMs: TEST_TIMEOUT_MS});
        if (result.networks[0]?.id !== 'office')
            throw new Error('expected normalized network');
        if (result.networks[0]?.resolvedIps?.join(', ') !== '10.0.0.1, 10.0.0.2')
            throw new Error('expected protobuf map values to be normalized');
        if (!result.networks[1]?.isExitNode)
            throw new Error('expected IPv6 default route to be an exit node');
    }],
    ['listNetworks normalizes domains, IPv4 exit nodes, and defaults', async () => {
        const result = await withContract({
            method: 'ListNetworks',
            request: {},
            response: {
                routes: [{
                    ID: 'exit-v4',
                    domains: ['example.internal', '', 4],
                    range: '10.0.0.0/8, 0.0.0.0/0',
                    resolvedIPs: {
                        empty: {},
                        host: {ips: ['10.1.2.3', null]},
                    },
                    selected: true,
                }, null],
            },
        }, () => listNetworks({timeoutMs: TEST_TIMEOUT_MS}));
        const network = result.networks[0];
        if (network.id !== 'exit-v4' || !network.isExitNode || !network.selected ||
            network.domains.join(',') !== 'example.internal' ||
            network.resolvedIps.join(',') !== '10.1.2.3')
            throw new Error('expected complete network normalization');

        assertObjectEqual(result.networks[1], {
            domains: [], id: '', isExitNode: false, range: '', resolvedIps: [], selected: false,
        }, 'empty network normalization');
    }],
    ['getNetBirdFeatures', async () => {
        const features = await getNetBirdFeatures({timeoutMs: TEST_TIMEOUT_MS});
        if (!features.disableProfiles || features.disableNetworks)
            throw new Error('expected normalized daemon feature policy');
    }],
    ['getNetBirdFeatures normalizes every policy flag', async () => {
        const features = await withContract({
            method: 'GetFeatures',
            request: {},
            response: {
                disableAdvancedView: 1,
                disableNetworks: 'yes',
                disableProfiles: 0,
                disableUpdateSettings: true,
            },
        }, () => getNetBirdFeatures({timeoutMs: TEST_TIMEOUT_MS}));
        assertObjectEqual(features, {
            disableAdvancedView: true,
            disableNetworks: true,
            disableProfiles: false,
            disableUpdateSettings: true,
        }, 'GetFeatures normalization');
    }],
    ['selectNetworks', () =>
        selectNetworks(['office'], {timeoutMs: TEST_TIMEOUT_MS})],
    ['selectNetworks supports replacement and all routes', () => withContract({
        method: 'SelectNetworks',
        request: {all: true, append: false, networkIDs: ['office', 'lab']},
    }, () => selectNetworks(['office', 'lab'], {
        all: true,
        append: false,
        timeoutMs: TEST_TIMEOUT_MS,
    }))],
    ['deselectNetworks', () =>
        deselectNetworks([], {all: true, timeoutMs: TEST_TIMEOUT_MS})],
    ['deselectNetworks serializes selected route IDs', () => withContract({
        method: 'DeselectNetworks',
        request: {all: false, networkIDs: ['office', 'lab']},
    }, () => deselectNetworks(['office', 'lab'], {timeoutMs: TEST_TIMEOUT_MS}))],
    ['getNetBirdStatus', () => getNetBirdStatus({timeoutMs: TEST_TIMEOUT_MS})],
    ['getNetBirdStatus with cancellable', () => getNetBirdStatus(withCancellable())],
    ['status model normalization', async () => {
        GLib.setenv('NETBIRD_FAKE_STATUS_JSON', JSON.stringify({
            daemonVersion: '0.76.3',
            fullStatus: {
                localPeerState: {
                    fqdn: 'desktop.example.net',
                    IP: '100.64.0.1',
                    ipv6: 'fd00::1',
                },
                networksRevision: 4,
                peers: [{
                    bytesRx: '1024',
                    bytesTx: 2048,
                    fqdn: 'peer.example.net',
                    IP: '100.64.0.2',
                    ipv6: 'fd00::2',
                    connStatus: 'Connected',
                    lastWireguardHandshake: '2026-08-16T12:34:56Z',
                    latency: '0.012s',
                    networks: ['office', '', null],
                    relayed: true,
                }],
            },
            sessionExpiresAt: '2026-08-16T13:34:56Z',
            status: 'Connected',
        }), true);
        try {
            const result = await getNetBirdStatus({timeoutMs: TEST_TIMEOUT_MS});
            if (result.snapshot.localPeer.fqdn !== 'desktop.example.net' ||
                result.snapshot.localPeer.ipv4 !== '100.64.0.1' ||
                result.snapshot.localPeer.ipv6 !== 'fd00::1' ||
                result.snapshot.peers[0]?.latencyMs !== 12 ||
                result.snapshot.peers[0]?.bytesRx !== 1024 ||
                result.snapshot.peers[0]?.bytesTx !== 2048 ||
                result.snapshot.peers[0]?.lastHandshake !== 1786883696 ||
                result.snapshot.peers[0]?.networks.join(',') !== 'office' ||
                !result.snapshot.peers[0]?.relayed ||
                result.snapshot.sessionExpiresAt !== 1786887296 ||
                result.snapshot.networksRevision !== 4)
                throw new Error('expected complete normalized status snapshot');
        } finally {
            GLib.unsetenv('NETBIRD_FAKE_STATUS_JSON');
        }
    }],
    ['status model uses safe defaults for malformed fields', () => {
        const status = normalizeStatus({
            fullStatus: {localPeerState: null, networksRevision: 'not-a-number', peers: {}},
            sessionExpiresAt: 'not-a-timestamp',
        });
        if (status.state !== 'Unknown' || status.connected ||
            status.sessionExpiresAt !== 0 || status.peers.length !== 0 ||
            status.networksRevision !== 0)
            throw new Error('expected status defaults without guessed legacy fields');
    }],
    ['peer model normalizes every field', () => {
        const peer = normalizePeer({
            IP: '100.64.0.8',
            bytesRx: '12',
            bytesTx: '34',
            connStatus: 'Connecting',
            fqdn: 'peer.example',
            ipv6: 'fd00::8',
            lastWireguardHandshake: '2026-01-02T03:04:05Z',
            latency: '0.0015s',
            networks: ['one', 2, ''],
            relayed: 1,
        });
        assertObjectEqual(peer, {
            bytesRx: 12,
            bytesTx: 34,
            fqdn: 'peer.example',
            ip: '100.64.0.8',
            ipv6: 'fd00::8',
            lastHandshake: 1767323045,
            latencyMs: 2,
            networks: ['one'],
            relayed: true,
            state: 'Connecting',
        }, 'peer normalization');
    }],
    ['profile model normalizes every field', () => {
        assertObjectEqual(normalizeProfile({id: 3, isActive: 1, name: null}), {
            id: '', isActive: true, name: '',
        }, 'profile normalization');
    }],
    ['network model only detects exact default routes', () => {
        const notExit = normalizeNetwork({ID: 'partial', range: '10.0.0.0/8, ::/1'});
        const exit = normalizeNetwork({ID: 'exit', range: ' ::/0 '});
        if (notExit.isExitNode || !exit.isExitNode)
            throw new Error('default route detection was not exact');
    }],
    ['subscribeNetBirdStatus', () => new Promise((resolve, reject) => {
        const cancellable = new Gio.Cancellable();
        const states = [];
        subscribeNetBirdStatus({
            cancellable,
            onError: reject,
            onStatus: status => {
                states.push(status.state);
                if (states.length === 2) {
                    cancellable.cancel();
                    if (states.join(',') !== 'Idle,Connected')
                        reject(new Error(`unexpected stream states: ${states}`));
                    else
                        resolve();
                }
            },
        });
    })],
    ['status subscription surfaces daemon stream errors', () =>
        assertSubscriptionError('stream-error', 'subscription rejected')],
    ['status subscription rejects non-chunked responses', () =>
        assertSubscriptionError('stream-not-chunked', 'not chunked')],
    ['status subscription rejects invalid JSON frames', () =>
        assertSubscriptionError('stream-invalid-json', 'invalid JSON')],
    ['status subscription rejects frames without results', () =>
        assertSubscriptionError('stream-invalid-frame', 'invalid frame')],
    ['status subscription reports unexpected stream completion', () =>
        assertSubscriptionError('stream-empty', 'stream ended')],
    ['getNetBirdStatus connected daemon state', () =>
        assertStatusConnected(
            '{"status":"Connected"}',
            true)],
    ['getNetBirdStatus disconnected daemon state', () =>
        assertStatusConnected(
            '{"status":"Idle"}',
            false)],
    ['getNetBirdStatus connecting daemon state', () =>
        assertStatusConnected(
            '{"status":"Connecting"}',
            false)],
    ['old status fields are not guessed', () =>
        assertStatusConnected(
            '{"daemonStatus":"Connected"}',
            false)],
    ['getNetBirdStatus profile name', () =>
        assertStatusProfileName(
            '{"status":"Connected"}',
            'Work Profile')],
    ['getNetBirdStatus daemon version', () =>
        assertStatusDaemonVersion(
            '{"status":"Connected","daemonVersion":"0.76.1"}',
            '0.76.1')],
    ['pre-0.76 daemon is rejected', () =>
        assertRejects(
            () => assertStatusDaemonVersion(
                '{"status":"Connected","daemonVersion":"0.75.1"}',
                '0.75.1'),
            'too old')],
    ['listProfiles', async () => {
        const result = await listProfiles({timeoutMs: TEST_TIMEOUT_MS});
        if (result.activeProfile !== 'default')
            throw new Error('expected protobuf isActive field to select default');
        if (result.profiles[0]?.id !== 'profile-default')
            throw new Error('expected profile ID to be preserved');
    }],
    ['listProfiles filters unusable entries and handles no active profile', async () => {
        const result = await withContract({
            method: 'ListProfiles',
            request: {username: GLib.get_user_name()},
            response: {
                profiles: [
                    {id: 'empty', isActive: true, name: ''},
                    {id: 'numeric', isActive: true, name: 5},
                    {id: 'valid', isActive: false, name: 'Personal'},
                ],
            },
        }, () => listProfiles({timeoutMs: TEST_TIMEOUT_MS}));
        if (result.activeProfile !== '' || result.profiles.length !== 1 ||
            result.profiles[0].name !== 'Personal' || result.profiles[0].selected)
            throw new Error('expected invalid profiles to be filtered');
    }],
    ['listProfiles with cancellable', () => listProfiles(withCancellable())],
    ['addProfile', () => addProfile('Test Profile', {timeoutMs: TEST_TIMEOUT_MS})],
    ['addProfile with cancellable', () =>
        addProfile('Test Profile', withCancellable())],
    ['removeProfile', () => removeProfile('Test Profile', {timeoutMs: TEST_TIMEOUT_MS})],
    ['removeProfile with cancellable', () =>
        removeProfile('Test Profile', withCancellable())],
    ['profile mutation responses preserve daemon data', async () => {
        const added = await withContract({
            method: 'AddProfile',
            request: {profileName: 'Personal', username: GLib.get_user_name()},
            response: {id: 'generated-profile-id'},
        }, () => addProfile('Personal', {timeoutMs: TEST_TIMEOUT_MS}));
        if (added.profile !== 'Personal' || added.data.id !== 'generated-profile-id')
            throw new Error('expected AddProfile result data');

        const removed = await withContract({
            method: 'RemoveProfile',
            request: {profileName: 'generated-profile-id', username: GLib.get_user_name()},
            response: {id: 'generated-profile-id'},
        }, () => removeProfile('generated-profile-id', {timeoutMs: TEST_TIMEOUT_MS}));
        if (removed.profile !== 'generated-profile-id' ||
            removed.data.id !== 'generated-profile-id')
            throw new Error('expected RemoveProfile result data');
    }],
    ['renameProfile', () => renameProfile(
        'profile-work', 'Renamed Profile', {timeoutMs: TEST_TIMEOUT_MS})],
    ['switchProfile', () => switchProfile('Work Profile', {timeoutMs: TEST_TIMEOUT_MS})],
    ['switchProfile with cancellable', () =>
        switchProfile('Work Profile', withCancellable())],
    ['switchProfile returns the requested active profile', async () => {
        const result = await withContract({
            method: 'SwitchProfile',
            request: {profileName: 'profile-id', username: GLib.get_user_name()},
            response: {id: 'profile-id'},
        }, () => switchProfile('profile-id', {timeoutMs: TEST_TIMEOUT_MS}));
        if (result.activeProfile !== 'profile-id' || result.data.id !== 'profile-id')
            throw new Error('expected SwitchProfile result data');
    }],
    ['setNetBirdConfig', () =>
        setNetBirdConfig({
            profileName: 'Work Profile',
            disableAutoConnect: true,
        }, {timeoutMs: TEST_TIMEOUT_MS})],
    ['setNetBirdConfig serializes every UI-supported setting', () => withContract({
        method: 'SetConfig',
        request: {
            blockInbound: true,
            blockLanAccess: true,
            disableAutoConnect: true,
            disableClientRoutes: true,
            disableDns: true,
            disableIpv6: true,
            disableNotifications: true,
            disableServerRoutes: true,
            disableSSHAuth: true,
            enableSSHLocalPortForwarding: true,
            enableSSHRemotePortForwarding: true,
            enableSSHRoot: true,
            enableSSHSFTP: true,
            interfaceName: 'wt0',
            lazyConnectionEnabled: true,
            managementUrl: 'https://management.example',
            mtu: 1280,
            networkMonitor: true,
            optionalPreSharedKey: '',
            profileName: 'profile-id',
            rosenpassPermissive: true,
            serverSSHAllowed: true,
            sshJWTCacheTTL: 900,
            username: GLib.get_user_name(),
            wireguardPort: 51820,
        },
    }, () => setNetBirdConfig({
        blockInbound: true,
        blockLanAccess: true,
        disableAutoConnect: true,
        disableClientRoutes: true,
        disableDns: true,
        disableIpv6: true,
        disableNotifications: true,
        disableServerRoutes: true,
        disableSSHAuth: true,
        enableSSHLocalPortForwarding: true,
        enableSSHRemotePortForwarding: true,
        enableSSHRoot: true,
        enableSSHSFTP: true,
        interfaceName: 'wt0',
        lazyConnectionEnabled: true,
        managementUrl: 'https://management.example',
        mtu: 1280,
        networkMonitor: true,
        optionalPreSharedKey: '',
        profileName: 'profile-id',
        rosenpassPermissive: true,
        serverSSHAllowed: true,
        sshJWTCacheTTL: 900,
        wireguardPort: 51820,
    }, {timeoutMs: TEST_TIMEOUT_MS}))],
    ['loginNetBird', async () => {
        const login = await loginNetBird({
            hostname: 'test-host',
            timeoutMs: TEST_TIMEOUT_MS,
        });
        if (!login.needsSsoLogin || login.userCode !== 'ABCD-EFGH' ||
            login.verificationUriComplete !== 'https://login.example/complete')
            throw new Error('expected normalized Login response');
    }],
    ['loginNetBird serializes self-hosted and setup-key fields', async () => {
        const result = await withContract({
            method: 'Login',
            request: {
                hostname: 'birdbox',
                isUnixDesktopClient: true,
                managementUrl: 'https://management.example',
                setupKey: 'TEST-SETUP-KEY',
            },
            response: {needsSSOLogin: false},
        }, () => loginNetBird({
            hostname: 'birdbox',
            managementUrl: 'https://management.example',
            setupKey: 'TEST-SETUP-KEY',
            timeoutMs: TEST_TIMEOUT_MS,
        }));
        assertObjectEqual(result, {
            needsSsoLogin: false,
            userCode: '',
            verificationUri: '',
            verificationUriComplete: '',
        }, 'setup-key Login response');
    }],
    ['waitForSsoLogin', async () => {
        const email = await waitForSsoLogin('ABCD-EFGH', {
            hostname: 'test-host',
            timeoutMs: TEST_TIMEOUT_MS,
        });
        if (email !== 'person@example.net')
            throw new Error('expected WaitSSOLogin email');
    }],
    ['waitForSsoLogin requires a user code', () =>
        assertRejects(() => waitForSsoLogin('', {timeoutMs: TEST_TIMEOUT_MS}), 'user code')],
    ['empty profile names are rejected', async () => {
        await assertRejects(() => addProfile(''), 'profile name');
        await assertRejects(() => removeProfile('  '), 'profile name');
        await assertRejects(() => renameProfile('', 'Renamed'), 'profile name');
        await assertRejects(() => renameProfile('profile-id', ''), 'profile name');
        await assertRejects(() => switchProfile(''), 'profile name');
    }],
    ['chunked response on keep-alive connection', () =>
        withResponseMode('keep-alive', () =>
            getNetBirdStatus({timeoutMs: TEST_TIMEOUT_MS}))],
    ['chunked framing takes precedence over content length', () =>
        withResponseMode('chunked-with-content-length', () =>
            getNetBirdStatus({timeoutMs: TEST_TIMEOUT_MS}))],
    ['connection-close response framing', () =>
        withResponseMode('unframed-close', () =>
            createDebugBundle({timeoutMs: TEST_TIMEOUT_MS}))],
    ['empty success response is treated as an empty JSON message', async () => {
        const result = await withResponseMode('empty-success', () =>
            createDebugBundle({timeoutMs: TEST_TIMEOUT_MS}));
        assertObjectEqual(result.data, {}, 'empty response');
    }],
    ['non-JSON success body is rejected', () =>
        assertRejectsResponseMode('non-json', 'invalid JSON')],
    ['truncated content-length response', () =>
        assertRejectsResponseMode('truncated', 'Truncated NetBird response')],
    ['malformed status line', () =>
        assertRejectsResponseMode('malformed-status', 'status line')],
    ['garbage response preamble', () =>
        assertRejectsResponseMode('garbage-preamble', 'status line')],
    ['oversized response', () =>
        assertRejectsResponseMode('oversized', 'response is too large', 5000)],
    ['unframed keep-alive response times out', () =>
        assertRejectsResponseMode('unframed-keep-alive', 'timed out', 100)],
    ['strict content-length parsing', () =>
        assertRejectsResponseMode('non-decimal-content-length', 'timed out', 100)],
    ['malformed chunk size', () =>
        assertRejectsResponseMode('malformed-chunk-size', 'chunk size')],
    ['HTTP error message', () =>
        assertPrivilegeRefusal()],
    ['ordinary HTTP JSON errors preserve method and status', async () => {
        try {
            await withResponseMode('server-error', () =>
                createDebugBundle({timeoutMs: TEST_TIMEOUT_MS}));
        } catch (error) {
            if (!(error instanceof NetBirdDaemonError) || error.method !== 'DebugBundle' ||
                error.statusCode !== 500 || error.message !== 'daemon exploded') {
                throw new Error(
                    `unexpected daemon error metadata: ${error}`, {cause: error});
            }

            return;
        }
        throw new Error('expected HTTP 500 to reject');
    }],
    ['external cancellation', async () => {
        const cancellable = new Gio.Cancellable();
        cancellable.cancel();
        await assertRejects(
            () => createDebugBundle({cancellable, timeoutMs: TEST_TIMEOUT_MS}),
            'cancelled');
    }],
    ['request timeout', async () => {
        try {
            await withResponseMode('timeout', () =>
                createDebugBundle({timeoutMs: 100}));
        } catch (error) {
            if (!error.timedOut || error.statusText !== 'Timeout') {
                throw new Error(`expected timeout metadata, got: ${error}`, {
                    cause: error,
                });
            }
            return;
        }
        throw new Error('expected request to time out');
    }],
    ['missing socket rejects without being mislabeled as a timeout', async () => {
        await withoutTestSocket(async () => {
            try {
                await createDebugBundle({timeoutMs: TEST_TIMEOUT_MS});
            } catch (error) {
                if (error instanceof NetBirdDaemonError && error.timedOut) {
                    throw new Error(
                        'socket connection failure was mislabeled as a timeout',
                        {cause: error});
                }
                return;
            }
            throw new Error('expected a missing socket to reject');
        });
    }],
    ['NetBirdClient destroy cancels all future operations', async () => {
        const client = new NetBirdClient({queryTimeoutMs: TEST_TIMEOUT_MS});
        client.destroy();
        if (!client.cancelled)
            throw new Error('destroyed client was not marked cancelled');
        await assertRejects(() => client.profiles(), 'cancelled');
    }],
];

async function main() {
    const server = new FakeNetBirdJsonServer();
    server.startUnix(TEST_SOCKET_PATH);

    try {
        for (const [name, test] of tests)
            await assertDoesNotThrow(name, test);
    } finally {
        server.stop();
        GLib.unsetenv('NETBIRD_GNOME_TEST_SOCKET');
        GLib.unlink(TEST_SOCKET_PATH);
    }
}

async function assertDoesNotThrow(name, callback) {
    try {
        await callback();
        print(`ok ${name}`);
    } catch (error) {
        printerr(`not ok ${name}: ${error}`);
        throw error;
    }
}

async function assertStatusConnected(statusJson, expected) {
    GLib.setenv('NETBIRD_FAKE_STATUS_JSON', statusJson, true);
    try {
        const status = await getNetBirdStatus({timeoutMs: TEST_TIMEOUT_MS});
        if (status.connected !== expected)
            throw new Error(`expected connected=${expected}, got ${status.connected}`);
    } finally {
        GLib.unsetenv('NETBIRD_FAKE_STATUS_JSON');
    }
}

async function assertStatusProfileName(statusJson, expected) {
    GLib.setenv('NETBIRD_FAKE_STATUS_JSON', statusJson, true);
    GLib.setenv('NETBIRD_FAKE_ACTIVE_PROFILE', expected, true);
    try {
        const status = await getNetBirdStatus({timeoutMs: TEST_TIMEOUT_MS});
        if (status.profileName !== expected)
            throw new Error(`expected profileName=${expected}, got ${status.profileName}`);
    } finally {
        GLib.unsetenv('NETBIRD_FAKE_STATUS_JSON');
        GLib.unsetenv('NETBIRD_FAKE_ACTIVE_PROFILE');
    }
}

async function assertStatusDaemonVersion(statusJson, expected) {
    GLib.setenv('NETBIRD_FAKE_STATUS_JSON', statusJson, true);
    try {
        const status = await getNetBirdStatus({timeoutMs: TEST_TIMEOUT_MS});
        if (status.daemonVersion !== expected)
            throw new Error(`expected daemonVersion=${expected}, got ${status.daemonVersion}`);
    } finally {
        GLib.unsetenv('NETBIRD_FAKE_STATUS_JSON');
    }
}

async function assertRejects(callback, expectedMessage) {
    try {
        await callback();
    } catch (error) {
        if (!String(error).toLowerCase().includes(expectedMessage.toLowerCase())) {
            throw new Error(`expected "${expectedMessage}" error, got: ${error}`, {
                cause: error,
            });
        }
        return;
    }

    throw new Error(`expected "${expectedMessage}" error`);
}

function withCancellable() {
    return {
        cancellable: new Gio.Cancellable(),
        timeoutMs: TEST_TIMEOUT_MS,
    };
}

async function withoutTestSocket(callback) {
    const savedPath = `${TEST_SOCKET_PATH}.saved`;
    GLib.rename(TEST_SOCKET_PATH, savedPath);
    try {
        return await callback();
    } finally {
        GLib.rename(savedPath, TEST_SOCKET_PATH);
    }
}

async function withContract({method, request, response = {}}, callback) {
    GLib.setenv('NETBIRD_FAKE_EXPECT_METHOD', method, true);
    GLib.setenv('NETBIRD_FAKE_EXPECT_REQUEST', JSON.stringify(request), true);
    GLib.setenv('NETBIRD_FAKE_CONTRACT_RESPONSE', JSON.stringify(response), true);
    try {
        return await callback();
    } finally {
        GLib.unsetenv('NETBIRD_FAKE_CONTRACT_RESPONSE');
        GLib.unsetenv('NETBIRD_FAKE_EXPECT_METHOD');
        GLib.unsetenv('NETBIRD_FAKE_EXPECT_REQUEST');
    }
}

function assertSubscriptionError(responseMode, expectedMessage) {
    return withResponseMode(responseMode, () => new Promise((resolve, reject) => {
        const cancellable = new Gio.Cancellable();
        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TEST_TIMEOUT_MS, () => {
            cancellable.cancel();
            reject(new Error(`subscription did not report ${responseMode}`));
            return GLib.SOURCE_REMOVE;
        });

        subscribeNetBirdStatus({
            cancellable,
            onError: error => {
                if (timeoutId)
                    GLib.Source.remove(timeoutId);
                cancellable.cancel();
                if (String(error).toLowerCase().includes(expectedMessage.toLowerCase()))
                    resolve();
                else
                    reject(new Error(`expected "${expectedMessage}" error, got: ${error}`));
            },
            onStatus: () => {
                if (timeoutId)
                    GLib.Source.remove(timeoutId);
                cancellable.cancel();
                reject(new Error(`unexpected status from ${responseMode}`));
            },
        });
    }));
}

async function withResponseMode(mode, callback) {
    GLib.setenv('NETBIRD_FAKE_RESPONSE_MODE', mode, true);
    try {
        return await callback();
    } finally {
        GLib.unsetenv('NETBIRD_FAKE_RESPONSE_MODE');
    }
}

function assertObjectEqual(actual, expected, label) {
    const actualJson = JSON.stringify(canonicalize(actual));
    const expectedJson = JSON.stringify(canonicalize(expected));
    if (actualJson !== expectedJson)
        throw new Error(`unexpected ${label}: ${actualJson}; expected ${expectedJson}`);
}

function canonicalize(value) {
    if (Array.isArray(value))
        return value.map(canonicalize);
    if (!value || typeof value !== 'object')
        return value;

    const result = {};
    for (const key of Object.keys(value).sort())
        result[key] = canonicalize(value[key]);
    return result;
}

async function assertRejectsResponseMode(mode, expectedMessage, timeoutMs = TEST_TIMEOUT_MS) {
    try {
        await withResponseMode(mode, () =>
            createDebugBundle({timeoutMs}));
    } catch (error) {
        if (!String(error).includes(expectedMessage)) {
            throw new Error(`expected "${expectedMessage}" error, got: ${error}`, {
                cause: error,
            });
        }
        return;
    }

    throw new Error(`expected ${mode} response to reject`);
}

async function assertPrivilegeRefusal() {
    try {
        await withResponseMode('forbidden', () =>
            setNetBirdConfig({
                profileName: 'Work Profile',
                disableAutoConnect: true,
            }, {timeoutMs: TEST_TIMEOUT_MS}));
    } catch (error) {
        if (!(error instanceof NetBirdDaemonError)) {
            throw new Error(`expected NetBirdDaemonError, got: ${error}`, {
                cause: error,
            });
        }
        if (!error.privilegeRequired)
            throw new Error('expected a structured privilege refusal', {cause: error});
        if (error.privilegeSummary !== 'Enabling the NetBird SSH server requires root.') {
            throw new Error(
                `unexpected privilege summary: ${error.privilegeSummary}`,
                {cause: error});
        }
        if (error.privilegeCommand !== 'sudo netbird down; sudo netbird up --allow-server-ssh') {
            throw new Error(
                `unexpected privilege command: ${error.privilegeCommand}`,
                {cause: error});
        }
        if (!error.message.includes(error.privilegeCommand)) {
            throw new Error(
                'copyable command was not included in the error message',
                {cause: error});
        }
        return;
    }

    throw new Error('expected NetBird 0.76 privilege refusal');
}

class FakeNetBirdJsonServer {
    constructor() {
        this._openConnections = [];
        this._service = new Gio.SocketService();
        this._service.connect('incoming', (_service, connection) => {
            void this._handleConnection(connection).catch(error => {
                if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.BROKEN_PIPE))
                    printerr(`fake server connection failed: ${error}`);
            });
            return true;
        });
        this.port = 0;
    }

    startUnix(path) {
        this._service.add_address(
            Gio.UnixSocketAddress.new(path),
            Gio.SocketType.STREAM,
            Gio.SocketProtocol.DEFAULT,
            null);
        this._service.start();
    }

    stop() {
        for (const connection of this._openConnections)
            connection.close(null);
        this._openConnections.length = 0;
        this._service.stop();
        this._service.close();
    }

    async _handleConnection(connection) {
        let keepAlive = false;
        try {
            const request = await readHttpRequest(connection.get_input_stream());
            const response = this._dispatch(request);
            keepAlive = Boolean(response.keepAlive);
            if (response.streamFrames) {
                await writeStreamResponse(
                    connection.get_output_stream(),
                    response.streamFrames,
                    response.rawStreamFrames);
            } else if (!response.noResponse) {
                await writeHttpResponse(connection.get_output_stream(), response);
            }
        } finally {
            if (keepAlive)
                this._openConnections.push(connection);
            else
                connection.close(null);
        }
    }

    _dispatch(request) {
        const method = request.path.split('/').pop();
        const responseMode = GLib.getenv('NETBIRD_FAKE_RESPONSE_MODE');

        if (request.path !== `/daemon.DaemonService/${method}`)
            throw new Error(`unexpected RPC path: ${request.path}`);
        if (request.method !== 'POST')
            throw new Error(`unexpected HTTP method: ${request.method}`);
        if (request.headers.get('content-type') !== 'application/json' ||
            request.headers.get('accept') !== 'application/json' ||
            request.headers.get('connection') !== 'close')
            throw new Error('missing required NetBird JSON request headers');

        const expectedMethod = GLib.getenv('NETBIRD_FAKE_EXPECT_METHOD');
        if (expectedMethod) {
            if (method !== expectedMethod)
                throw new Error(`unexpected RPC method: ${method}; expected ${expectedMethod}`);
            assertRequestBody(
                request.body,
                JSON.parse(GLib.getenv('NETBIRD_FAKE_EXPECT_REQUEST')));
            return {
                body: JSON.parse(GLib.getenv('NETBIRD_FAKE_CONTRACT_RESPONSE')),
                statusCode: 200,
            };
        }

        this._assertRequest(method, request.body);

        if (responseMode === 'timeout')
            return {keepAlive: true, noResponse: true};
        if (responseMode === 'non-json')
            return {body: 'not JSON', rawBody: true, statusCode: 200};
        if (responseMode === 'empty-success')
            return {body: '', contentLength: 0, rawBody: true, statusCode: 200};
        if (responseMode === 'server-error') {
            return {
                body: {message: 'daemon exploded'},
                statusCode: 500,
            };
        }
        if (responseMode === 'unframed-close')
            return {body: {}, omitFraming: true, statusCode: 200};
        if (responseMode === 'forbidden') {
            return {
                body: {
                    code: 7,
                    details: [{
                        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                        domain: 'daemon.netbird.io',
                        metadata: {
                            command: 'sudo netbird down; sudo netbird up --allow-server-ssh',
                            summary: 'Enabling the NetBird SSH server requires root.',
                        },
                        reason: 'PRIVILEGE_REQUIRED',
                    }],
                    message: 'Enabling the NetBird SSH server requires root.',
                },
                statusCode: 403,
            };
        }
        if (responseMode === 'truncated') {
            return {
                body: '{}',
                contentLength: 3,
                rawBody: true,
                statusCode: 200,
            };
        }
        if (responseMode === 'malformed-status')
            return {body: '{}', rawBody: true, statusLine: 'HTTP/1.1 NOPE'};
        if (responseMode === 'garbage-preamble')
            return {body: '{}', rawBody: true, statusLine: 'garbage'};
        if (responseMode === 'oversized') {
            return {
                body: 'x'.repeat((8 * 1024 * 1024) + 1),
                rawBody: true,
                statusCode: 200,
            };
        }
        if (responseMode === 'unframed-keep-alive') {
            return {
                body: '{}',
                keepAlive: true,
                omitFraming: true,
                rawBody: true,
                statusCode: 200,
            };
        }
        if (responseMode === 'non-decimal-content-length') {
            return {
                body: '{}',
                contentLength: '0x10',
                keepAlive: true,
                rawBody: true,
                statusCode: 200,
            };
        }
        if (responseMode === 'malformed-chunk-size') {
            return {
                body: '{}',
                chunked: true,
                rawBody: true,
                rawWireBody: '-5\r\n{}\r\n0\r\n\r\n',
                statusCode: 200,
            };
        }

        if (method === 'SubscribeStatus') {
            if (responseMode === 'stream-error') {
                return {
                    streamFrames: [{error: {message: 'subscription rejected'}}],
                };
            }
            if (responseMode === 'stream-not-chunked')
                return {body: {}, statusCode: 200};
            if (responseMode === 'stream-invalid-json') {
                return {
                    rawStreamFrames: true,
                    streamFrames: ['not-json'],
                };
            }
            if (responseMode === 'stream-invalid-frame')
                return {streamFrames: [{}]};
            if (responseMode === 'stream-empty')
                return {streamFrames: []};
        }

        if (method === 'Status') {
            const statusData = GLib.getenv('NETBIRD_FAKE_STATUS_JSON');
            if (statusData) {
                return {
                    body: JSON.parse(statusData),
                    chunked: true,
                    statusCode: 200,
                };
            }

            const response = {
                body: {
                    daemonVersion: '0.76.1',
                    status: 'Connected',
                    fullStatus: {
                        localPeerState: {
                            IP: '100.64.0.1/32',
                        },
                    },
                },
                chunked: true,
                statusCode: 200,
            };
            if (responseMode === 'keep-alive')
                response.keepAlive = true;
            if (responseMode === 'chunked-with-content-length') {
                response.contentLength = 1;
                response.keepAlive = true;
            }
            return response;
        }

        if (method === 'SubscribeStatus') {
            return {
                streamFrames: [
                    {result: {daemonVersion: '0.76.3', status: 'Idle'}},
                    {
                        result: {
                            daemonVersion: '0.76.3',
                            fullStatus: {localPeerState: {IP: '100.64.0.1/32'}},
                            status: 'Connected',
                        },
                    },
                ],
            };
        }

        if (method === 'GetActiveProfile') {
            return {
                statusCode: 200,
                body: {
                    profileName: GLib.getenv('NETBIRD_FAKE_ACTIVE_PROFILE') || 'default',
                    username: GLib.get_user_name(),
                },
            };
        }

        if (method === 'GetConfig') {
            if (request.body.profileName !== 'Work Profile')
                throw new Error(`unexpected profileName: ${request.body.profileName}`);
            if (!request.body.username)
                throw new Error('expected username');

            return {
                statusCode: 200,
                body: {
                    disableAutoConnect: false,
                    managementUrl: 'https://api.netbird.io',
                },
            };
        }

        if (method === 'ListNetworks') {
            return {
                statusCode: 200,
                body: {
                    routes: [{
                        ID: 'office',
                        range: '10.0.0.0/24',
                        resolvedIPs: {
                            office: {ips: ['10.0.0.1', '10.0.0.2']},
                        },
                        selected: true,
                    }, {
                        ID: 'exit-v6',
                        domains: [],
                        range: '0.0.0.0/0, ::/0',
                        resolvedIPs: {},
                        selected: false,
                    }],
                },
            };
        }

        if (method === 'ListProfiles') {
            return {
                statusCode: 200,
                body: {
                    profiles: [
                        {id: 'profile-default', name: 'default', isActive: true},
                        {id: 'profile-work', name: 'Work Profile', isActive: false},
                    ],
                },
            };
        }

        if (method === 'GetFeatures') {
            return {
                statusCode: 200,
                body: {
                    disableAdvancedView: false,
                    disableNetworks: false,
                    disableProfiles: true,
                    disableUpdateSettings: false,
                },
            };
        }

        if (method === 'Login') {
            return {
                statusCode: 200,
                body: {
                    needsSSOLogin: true,
                    userCode: 'ABCD-EFGH',
                    verificationURI: 'https://login.example',
                    verificationURIComplete: 'https://login.example/complete',
                },
            };
        }

        if (method === 'WaitSSOLogin') {
            return {
                statusCode: 200,
                body: {email: 'person@example.net'},
            };
        }

        if ([
            'AddProfile',
            'DebugBundle',
            'Down',
            'Logout',
            'RemoveProfile',
            'RenameProfile',
            'SelectNetworks',
            'SetConfig',
            'SwitchProfile',
            'TriggerUpdate',
            'Up',
            'DeselectNetworks',
        ].includes(method)) {
            if (method === 'SetConfig') {
                if (request.body.profileName !== 'Work Profile')
                    throw new Error(`unexpected profileName: ${request.body.profileName}`);
                if (request.body.disableAutoConnect !== true)
                    throw new Error('expected disableAutoConnect=true');
                if (!request.body.username)
                    throw new Error('expected username');
            }

            return {
                statusCode: 200,
                body: method === 'TriggerUpdate'
                    ? {success: true}
                    : {},
            };
        }

        return {
            statusCode: 404,
            body: {
                message: `unknown method: ${method}`,
            },
        };
    }

    _assertRequest(method, body) {
        switch (method) {
        case 'Status':
        case 'SubscribeStatus':
            assertRequestBody(body, {
                getFullPeerStatus: true,
                shouldRunProbes: false,
            });
            break;
        case 'GetActiveProfile':
        case 'GetFeatures':
        case 'ListNetworks':
        case 'Down':
        case 'TriggerUpdate':
            assertRequestBody(body, {});
            break;
        case 'Up':
            assertRequestBody(body, {
                async: true,
                profileName: 'default',
                username: GLib.get_user_name(),
            });
            break;
        case 'Logout':
            assertRequestBody(body, {
                profileName: 'default',
                username: GLib.get_user_name(),
            });
            break;
        case 'GetConfig':
            assertRequestBody(body, {
                profileName: 'Work Profile',
                username: GLib.get_user_name(),
            });
            break;
        case 'ListProfiles':
            assertRequestBody(body, {username: GLib.get_user_name()});
            break;
        case 'AddProfile':
        case 'RemoveProfile':
            assertRequestBody(body, {
                profileName: 'Test Profile',
                username: GLib.get_user_name(),
            });
            break;
        case 'SwitchProfile':
            assertRequestBody(body, {
                profileName: 'Work Profile',
                username: GLib.get_user_name(),
            });
            break;
        case 'RenameProfile':
            assertRequestBody(body, {
                handle: 'profile-work',
                newProfileName: 'Renamed Profile',
                username: GLib.get_user_name(),
            });
            break;
        case 'Login':
            assertRequestBody(body, {
                hostname: 'test-host',
                isUnixDesktopClient: true,
            });
            break;
        case 'WaitSSOLogin':
            assertRequestBody(body, {
                hostname: 'test-host',
                userCode: 'ABCD-EFGH',
            });
            break;
        case 'SelectNetworks':
            assertRequestBody(body, {
                all: false,
                append: true,
                networkIDs: ['office'],
            });
            break;
        case 'DeselectNetworks':
            assertRequestBody(body, {
                all: true,
                networkIDs: [],
            });
            break;
        case 'SetConfig':
            assertRequestBody(body, {
                disableAutoConnect: true,
                profileName: 'Work Profile',
                username: GLib.get_user_name(),
            });
            break;
        case 'DebugBundle':
            assertRequestBody(body, {
                anonymize: false,
                systemInfo: true,
                uploadURL: '',
            });
            break;
        default:
            throw new Error(`unexpected RPC method: ${method}`);
        }
    }
}

function assertRequestBody(actual, expected) {
    assertObjectEqual(actual, expected, 'request body');
}

function readHttpRequest(stream) {
    const decoder = new TextDecoder();
    let text = '';
    let headerEnd = -1;
    let contentLength = null;

    return new Promise((resolve, reject) => {
        function readNext() {
            stream.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, null, (source, result) => {
                try {
                    const bytes = source.read_bytes_finish(result);
                    if (bytes.get_size() === 0) {
                        resolve(parseHttpRequest(text));
                        return;
                    }

                    text += decoder.decode(bytes.toArray());
                    if (headerEnd === -1) {
                        headerEnd = text.indexOf('\r\n\r\n');
                        if (headerEnd !== -1)
                            contentLength = parseContentLength(text.slice(0, headerEnd));
                    }

                    if (headerEnd !== -1) {
                        const body = text.slice(headerEnd + 4);
                        if (contentLength === null ||
                            new TextEncoder().encode(body).length >= contentLength) {
                            resolve(parseHttpRequest(text));
                            return;
                        }
                    }

                    readNext();
                } catch (error) {
                    reject(error);
                }
            });
        }

        readNext();
    });
}

function parseHttpRequest(text) {
    const headerEnd = text.indexOf('\r\n\r\n');
    const headerText = text.slice(0, headerEnd);
    const [requestLine, ...headerLines] = headerText.split('\r\n');
    const [method, path] = requestLine.split(' ');
    const body = text.slice(headerEnd + 4).trim();
    const headers = new Map();
    for (const line of headerLines) {
        const separator = line.indexOf(':');
        if (separator !== -1) {
            headers.set(
                line.slice(0, separator).trim().toLowerCase(),
                line.slice(separator + 1).trim());
        }
    }

    return {
        body: body ? JSON.parse(body) : {},
        headers,
        method,
        path,
    };
}

function parseContentLength(headerText) {
    const line = headerText
        .split('\r\n')
        .find(value => value.toLowerCase().startsWith('content-length:'));
    if (!line)
        return null;

    const value = Number(line.slice(line.indexOf(':') + 1).trim());
    return Number.isFinite(value) ? value : null;
}

function writeHttpResponse(stream, {
    body,
    chunked = false,
    contentLength = null,
    omitFraming = false,
    rawBody = false,
    rawWireBody = null,
    statusCode = 200,
    statusLine = null,
}) {
    const responseBody = rawBody ? body : JSON.stringify(body);
    const responseBodyBytes = new TextEncoder().encode(responseBody);
    const reason = statusCode === 200 ? 'OK' : 'Error';
    const headers = [
        statusLine ?? `HTTP/1.1 ${statusCode} ${reason}`,
        'Content-Type: application/json',
    ];
    let wireBody = responseBody;

    if (chunked) {
        headers.push('Transfer-Encoding: chunked');
        wireBody = `${responseBodyBytes.length.toString(16)}\r\n${responseBody}\r\n0\r\n\r\n`;
    } else if (!omitFraming) {
        headers.push(`Content-Length: ${contentLength ?? responseBodyBytes.length}`);
    }

    if (chunked && contentLength !== null)
        headers.push(`Content-Length: ${contentLength}`);
    if (rawWireBody !== null)
        wireBody = rawWireBody;

    const response = `${headers.join('\r\n')}\r\n\r\n${wireBody}`;

    const encoded = new TextEncoder().encode(response);
    let offset = 0;

    return new Promise((resolve, reject) => {
        function writeNext() {
            if (offset >= encoded.length) {
                resolve();
                return;
            }

            const chunk = encoded.slice(offset, offset + 65536);
            stream.write_all_async(
                chunk,
                GLib.PRIORITY_DEFAULT,
                null,
                (source, result) => {
                    try {
                        source.write_all_finish(result);
                        offset += chunk.length;
                        writeNext();
                    } catch (error) {
                        reject(error);
                    }
                });
        }

        writeNext();
    });
}

function writeStreamResponse(stream, frames, rawFrames = false) {
    const chunks = frames.flatMap(frame => {
        const json = rawFrames ? String(frame) : JSON.stringify(frame);
        return [json, '\n'];
    });
    const wireBody = `${chunks
        .map(chunk => {
            const length = new TextEncoder().encode(chunk).length.toString(16);
            return `${length}\r\n${chunk}\r\n`;
        })
        .join('')}0\r\n\r\n`;
    const response = [
        'HTTP/1.1 200 OK',
        'Content-Type: application/json',
        'Transfer-Encoding: chunked',
        '',
        wireBody,
    ].join('\r\n');

    return new Promise((resolve, reject) => {
        stream.write_all_async(
            new TextEncoder().encode(response),
            GLib.PRIORITY_DEFAULT,
            null,
            (source, result) => {
                try {
                    source.write_all_finish(result);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
    });
}

await main();
