// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';

export function createHomePage(actions) {
    const root = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
    });
    const banner = new Adw.Banner({
        button_label: 'Show Me How',
        revealed: false,
        title: 'Finish setting up NetBird',
    });
    banner.connect('button-clicked', actions.onSocketHelp);
    root.append(banner);

    const scrolled = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vexpand: true,
    });
    const content = new Gtk.Box({
        halign: Gtk.Align.CENTER,
        margin_bottom: 24,
        margin_end: 24,
        margin_start: 24,
        margin_top: 48,
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 14,
        valign: Gtk.Align.CENTER,
        width_request: 480,
    });

    const brand = new Gtk.Box({
        halign: Gtk.Align.CENTER,
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
    });
    brand.append(new Gtk.Image({
        halign: Gtk.Align.CENTER,
        icon_name: 'netbird',
        pixel_size: 56,
        valign: Gtk.Align.CENTER,
    }));
    brand.append(new Gtk.Label({
        css_classes: ['title-1'],
        halign: Gtk.Align.CENTER,
        label: 'NetBird',
        valign: Gtk.Align.CENTER,
    }));
    content.append(brand);

    const connectionSwitch = new Gtk.Switch({
        halign: Gtk.Align.CENTER,
        tooltip_text: 'Connect or disconnect NetBird',
        valign: Gtk.Align.CENTER,
    });
    connectionSwitch.update_property(
        [Gtk.AccessibleProperty.LABEL],
        ['NetBird connection']);
    content.append(connectionSwitch);

    const statusLabel = new Gtk.Label({
        css_classes: ['title-2'],
        halign: Gtk.Align.CENTER,
        label: 'Loading…',
    });
    content.append(statusLabel);

    const fqdnLabel = detailLabel();
    const ipLabel = detailLabel();
    content.append(fqdnLabel);
    content.append(ipLabel);

    const exitGroup = new Adw.PreferencesGroup({
        margin_top: 28,
    });
    const exitNode = new Adw.ComboRow({
        factory: createEllipsizedStringFactory(24, true),
        list_factory: createEllipsizedStringFactory(30),
        subtitle: 'Route traffic through another NetBird peer',
        title: 'Exit Node',
    });
    exitGroup.add(exitNode);
    content.append(exitGroup);

    scrolled.set_child(content);
    root.append(scrolled);

    let suppressConnection = false;
    let suppressExitNode = false;
    let exitNodeIds = [];
    let selectedExitNodeId = '';
    let selectionSourceId = 0;

    connectionSwitch.connect('notify::active', () => {
        if (!suppressConnection)
            actions.onToggleConnection();
    });
    exitNode.connect('notify::selected', () => {
        if (suppressExitNode)
            return;

        const id = exitNodeIds[exitNode.selected] ?? '';
        if (id === selectedExitNodeId)
            return;

        if (selectionSourceId)
            GLib.Source.remove(selectionSourceId);
        selectionSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            selectionSourceId = 0;
            actions.onSelectExitNode(id);
            return GLib.SOURCE_REMOVE;
        });
    });
    root.connect('destroy', () => {
        if (selectionSourceId) {
            GLib.Source.remove(selectionSourceId);
            selectionSourceId = 0;
        }
    });

    return {
        root,
        update({busy, features = {}, networks, snapshot}) {
            banner.revealed = snapshot.state === 'Unavailable';
            suppressConnection = true;
            connectionSwitch.active = snapshot.connected || snapshot.state === 'Connecting';
            suppressConnection = false;
            connectionSwitch.sensitive = !busy && snapshot.state !== 'Unavailable';

            statusLabel.label = statusText(snapshot.state);
            fqdnLabel.label = snapshot.connected ? snapshot.localPeer.fqdn : '';
            fqdnLabel.visible = Boolean(fqdnLabel.label);
            ipLabel.label = snapshot.connected
                ? [snapshot.localPeer.ipv4, snapshot.localPeer.ipv6].filter(Boolean).join('  •  ')
                : '';
            ipLabel.visible = Boolean(ipLabel.label);

            const exits = networks.filter(network => network.isExitNode);
            exitGroup.visible = !features.disableNetworks;
            const names = ['No exit node', ...exits.map(network => network.id)];
            const nextExitNodeIds = ['', ...exits.map(network => network.id)];
            selectedExitNodeId = exits.find(network => network.selected)?.id ?? '';
            suppressExitNode = true;
            if (!sameStrings(exitNodeIds, nextExitNodeIds)) {
                exitNodeIds = nextExitNodeIds;
                exitNode.model = Gtk.StringList.new(names);
            }
            const selected = exits.findIndex(network => network.selected);
            exitNode.selected = selected === -1 ? 0 : selected + 1;
            suppressExitNode = false;
            exitNode.sensitive = !busy && snapshot.connected && exits.length > 0;
        },
    };
}

function createEllipsizedStringFactory(widthChars, alignEnd = false) {
    const factory = new Gtk.SignalListItemFactory();
    factory.connect('setup', (_factory, listItem) => {
        listItem.child = new Gtk.Label({
            ellipsize: Pango.EllipsizeMode.END,
            halign: alignEnd ? Gtk.Align.END : Gtk.Align.FILL,
            max_width_chars: widthChars,
            width_chars: widthChars,
            xalign: alignEnd ? 1 : 0,
        });
    });
    factory.connect('bind', (_factory, listItem) => {
        const text = listItem.item?.string ?? '';
        listItem.child.label = text;
        listItem.child.tooltip_text = text;
    });
    return factory;
}

function sameStrings(left, right) {
    return left.length === right.length &&
        left.every((value, index) => value === right[index]);
}

function detailLabel() {
    return new Gtk.Label({
        css_classes: ['dim-label', 'monospace'],
        selectable: false,
        visible: false,
    });
}

function statusText(state) {
    const labels = {
        Connected: 'Connected',
        Connecting: 'Connecting…',
        Idle: 'Disconnected',
        LoginFailed: 'Sign-In Failed',
        NeedsLogin: 'Sign In Required',
        SessionExpired: 'Session Expired',
        Unavailable: 'NetBird Needs Setup',
    };
    return labels[state] ?? 'Unknown Status';
}
