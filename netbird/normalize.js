// SPDX-License-Identifier: GPL-3.0-or-later

function string(value) {
    return typeof value === 'string' ? value : '';
}

function array(value) {
    return Array.isArray(value) ? value : [];
}

function number(value) {
    const result = Number(value ?? 0);
    return Number.isFinite(result) ? result : 0;
}

function timestampSeconds(value) {
    const text = string(value);
    if (!text)
        return 0;

    const milliseconds = Date.parse(text);
    return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : 0;
}

function durationMilliseconds(value) {
    const text = string(value);
    const match = text.match(/^(\d+(?:\.\d+)?)s$/);
    return match ? number(Math.round(Number(match[1]) * 1000)) : 0;
}

export function normalizeStatus(data) {
    const fullStatus = data?.fullStatus ?? {};
    const local = fullStatus.localPeerState ?? {};
    const state = string(data?.status) || 'Unknown';

    return {
        connected: state === 'Connected',
        daemonVersion: string(data?.daemonVersion),
        localPeer: {
            fqdn: string(local.fqdn),
            ipv4: string(local.IP),
            ipv6: string(local.ipv6),
        },
        networksRevision: number(fullStatus.networksRevision),
        peers: array(fullStatus.peers).map(normalizePeer),
        sessionExpiresAt: timestampSeconds(data?.sessionExpiresAt),
        state,
    };
}

export function normalizePeer(peer) {
    return {
        bytesRx: number(peer?.bytesRx),
        bytesTx: number(peer?.bytesTx),
        fqdn: string(peer?.fqdn),
        ip: string(peer?.IP),
        ipv6: string(peer?.ipv6),
        lastHandshake: timestampSeconds(peer?.lastWireguardHandshake),
        latencyMs: durationMilliseconds(peer?.latency),
        networks: array(peer?.networks).map(string).filter(Boolean),
        relayed: Boolean(peer?.relayed),
        state: string(peer?.connStatus) || 'Unknown',
    };
}

export function normalizeProfile(profile) {
    return {
        id: string(profile?.id),
        isActive: Boolean(profile?.isActive),
        name: string(profile?.name),
    };
}

export function normalizeNetwork(network) {
    const domains = array(network?.domains).map(string).filter(Boolean);
    const resolvedIps = Object.values(network?.resolvedIPs ?? {})
        .flatMap(value => array(value?.ips))
        .map(string)
        .filter(Boolean);
    const range = string(network?.range);

    return {
        domains,
        id: string(network?.ID),
        isExitNode: range.split(',').some(part => {
            const prefix = part.trim();
            return prefix === '0.0.0.0/0' || prefix === '::/0';
        }),
        range,
        resolvedIps,
        selected: Boolean(network?.selected),
    };
}
