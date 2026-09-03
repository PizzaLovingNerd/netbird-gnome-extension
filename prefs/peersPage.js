// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

const FILTER_ALL = 0;
const FILTER_CONNECTED = 1;
const FILTER_OFFLINE = 2;

export function createPeersPage() {
    const root = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
    });
    const controls = new Gtk.Box({
        margin_end: 18,
        margin_start: 18,
        margin_top: 18,
        spacing: 12,
    });
    const search = new Gtk.SearchEntry({
        hexpand: true,
        placeholder_text: 'Search by name or IP address',
    });
    const filter = new Gtk.DropDown({
        model: Gtk.StringList.new(['All', 'Connected', 'Offline']),
        selected: FILTER_ALL,
        tooltip_text: 'Filter peers by connection state',
    });
    filter.update_property(
        [Gtk.AccessibleProperty.LABEL],
        ['Peer connection filter']);
    controls.append(search);
    controls.append(filter);
    root.append(controls);

    const overlay = new Gtk.Overlay({
        hexpand: true,
        vexpand: true,
    });
    const scrolled = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        margin_bottom: 18,
        margin_end: 18,
        margin_start: 18,
        margin_top: 12,
        vexpand: true,
    });
    const peerGroup = new Adw.PreferencesGroup({
        valign: Gtk.Align.START,
    });
    scrolled.set_child(peerGroup);
    overlay.set_child(scrolled);

    const empty = new Adw.StatusPage({
        description: 'Connected peers will appear here',
        icon_name: 'network-offline-symbolic',
        title: 'No Peers',
    });
    overlay.add_overlay(empty);
    root.append(overlay);

    const entries = new Map();
    let currentPeers = [];
    let rowOrder = [];

    function matches(peer) {
        const selected = filter.selected;
        if (selected === FILTER_CONNECTED && peer.state !== 'Connected')
            return false;
        if (selected === FILTER_OFFLINE && peer.state === 'Connected')
            return false;

        const query = search.text.trim().toLocaleLowerCase();
        if (!query)
            return true;
        return [peer.fqdn, peer.ip, peer.ipv6, peer.state]
            .some(value => String(value ?? '').toLocaleLowerCase().includes(query));
    }

    function updateFilter() {
        let visible = 0;
        for (const entry of entries.values()) {
            entry.row.visible = matches(entry.peer);
            if (entry.row.visible)
                visible++;
        }
        scrolled.visible = visible > 0;
        empty.visible = visible === 0;
        empty.title = currentPeers.length === 0 ? 'No Peers' : 'No Matching Peers';
        empty.description = currentPeers.length === 0
            ? 'Connected peers will appear here'
            : 'Try changing the search or connection filter';
    }

    search.connect('search-changed', updateFilter);
    filter.connect('notify::selected', updateFilter);

    return {
        root,
        focusSearch() {
            search.grab_focus();
        },
        update({snapshot}) {
            currentPeers = snapshot.peers;
            const currentKeys = new Set();
            for (const [index, peer] of snapshot.peers.entries()) {
                const key = peerKey(peer, index);
                currentKeys.add(key);
                let entry = entries.get(key);
                if (!entry) {
                    entry = createPeerRow();
                    entries.set(key, entry);
                    peerGroup.add(entry.row);
                }
                entry.peer = peer;
                updatePeerRow(entry, peer);
            }

            for (const [key, entry] of entries) {
                if (!currentKeys.has(key)) {
                    peerGroup.remove(entry.row);
                    entries.delete(key);
                }
            }
            const nextOrder = [...entries.entries()]
                .sort(([, left], [, right]) => comparePeers(left.peer, right.peer))
                .map(([key]) => key);
            if (!sameOrder(rowOrder, nextOrder)) {
                for (const key of nextOrder)
                    peerGroup.remove(entries.get(key).row);
                for (const key of nextOrder)
                    peerGroup.add(entries.get(key).row);
                rowOrder = nextOrder;
            }
            updateFilter();
        },
    };
}

function sameOrder(left, right) {
    return left.length === right.length &&
        left.every((value, index) => value === right[index]);
}

function createPeerRow() {
    const row = new Adw.ActionRow({
        subtitle_lines: 1,
        title_lines: 1,
    });
    const icon = new Gtk.Image();
    const latency = new Gtk.Label({
        css_classes: ['dim-label'],
        valign: Gtk.Align.CENTER,
    });
    row.add_prefix(icon);
    row.add_suffix(latency);
    return {icon, latency, peer: {}, row};
}

function updatePeerRow(entry, peer) {
    entry.row.title = peerName(peer);
    entry.row.subtitle = [
        peer.ip,
        peer.ipv6,
        peer.relayed ? `${peer.state} · Relayed` : peer.state,
    ].filter(Boolean).join('  •  ');
    entry.icon.icon_name = peer.state === 'Connected'
        ? 'network-transmit-receive-symbolic'
        : 'network-offline-symbolic';
    entry.latency.label = peer.state === 'Connected' && peer.latencyMs > 0
        ? `${Math.round(peer.latencyMs)} ms`
        : '';
    entry.latency.visible = Boolean(entry.latency.label);
}

function peerKey(peer, index) {
    return peer.fqdn || peer.ip || peer.ipv6 || `unknown-${index}`;
}

function peerName(peer) {
    const fqdn = String(peer.fqdn ?? '');
    return fqdn.split('.')[0] || peer.ip || peer.ipv6 || 'Unknown Peer';
}

function comparePeers(left, right) {
    const stateDifference = peerStateOrder(left.state) - peerStateOrder(right.state);
    if (stateDifference !== 0)
        return stateDifference;
    return peerName(left).localeCompare(peerName(right));
}

function peerStateOrder(state) {
    if (state === 'Connected')
        return 0;
    if (state === 'Connecting')
        return 1;
    return 2;
}
