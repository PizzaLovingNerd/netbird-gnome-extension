// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

export function createResourcesPage(actions) {
    const overlay = new Gtk.Overlay({
        hexpand: true,
        vexpand: true,
    });
    const scrolled = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        margin_bottom: 18,
        margin_end: 18,
        margin_start: 18,
        margin_top: 18,
        vexpand: true,
    });
    const list = new Gtk.ListBox({
        css_classes: ['boxed-list'],
        selection_mode: Gtk.SelectionMode.NONE,
        valign: Gtk.Align.START,
    });
    scrolled.set_child(list);
    overlay.set_child(scrolled);

    const empty = new Adw.StatusPage({
        description: 'You don’t have access to any network resources',
        icon_name: 'network-workgroup-symbolic',
        title: 'No Resources Available',
    });
    overlay.add_overlay(empty);

    const entries = new Map();
    const entriesByRow = new WeakMap();
    list.set_sort_func((left, right) => resourceTitle(
        entriesByRow.get(left)?.network ?? {}).localeCompare(resourceTitle(
        entriesByRow.get(right)?.network ?? {})));

    return {
        root: overlay,
        update(state) {
            const resources = state.networks.filter(network => !network.isExitNode);
            const currentKeys = new Set();
            for (const [index, network] of resources.entries()) {
                const key = resourceKey(network, index);
                currentKeys.add(key);
                let entry = entries.get(key);
                if (!entry) {
                    entry = createResourceRow(actions.onResourceToggled);
                    entries.set(key, entry);
                    entriesByRow.set(entry.row, entry);
                    list.append(entry.row);
                }
                entry.network = network;
                updateResourceRow(entry, network, state);
            }

            for (const [key, entry] of entries) {
                if (!currentKeys.has(key)) {
                    list.remove(entry.row);
                    entries.delete(key);
                }
            }
            list.invalidate_sort();
            scrolled.visible = resources.length > 0;
            empty.visible = resources.length === 0;
        },
    };
}

function createResourceRow(onResourceToggled) {
    const entry = {
        network: {},
        row: new Adw.SwitchRow(),
        suppress: false,
    };
    entry.row.add_prefix(new Gtk.Image({
        icon_name: 'network-workgroup-symbolic',
    }));
    entry.row.connect('notify::active', () => {
        if (!entry.suppress && entry.row.sensitive &&
            entry.row.active !== entry.network.selected)
            onResourceToggled(entry.network.id, entry.row.active);
    });
    return entry;
}

function updateResourceRow(entry, network, state) {
    entry.network = network;
    entry.row.title = resourceTitle(network);
    entry.row.subtitle = resourceDescription(network);
    entry.row.sensitive = state.snapshot.connected && !state.busy;
    entry.suppress = true;
    entry.row.active = network.selected;
    entry.suppress = false;
}

function resourceKey(network, index) {
    return network.id || network.range || (network.domains ?? []).join(',') ||
        `unnamed-${index}`;
}

function resourceTitle(network) {
    return network.id || network.domains?.[0] || network.range ||
        'Unnamed Resource';
}

function resourceDescription(network) {
    const domains = network.domains ?? [];
    const visibleDomains = domains.slice(0, 2);
    if (domains.length > visibleDomains.length)
        visibleDomains.push(`+${domains.length - visibleDomains.length} more`);
    const details = [...visibleDomains, network.range].filter(Boolean);
    if (details.length === 0 && network.resolvedIps?.length > 0)
        details.push(...network.resolvedIps.slice(0, 2));
    return details.join('  •  ') || 'Routed network resource';
}
