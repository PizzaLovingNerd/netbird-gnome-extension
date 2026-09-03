// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import {MASKED_PRESHARED_KEY, SettingsController} from './settingsController.js';

const GENERAL_RESTRICTED_KEYS = new Set([
    'allowSsh',
    'blockInbound',
    'connectOnStartup',
    'lazyConnections',
    'notifications',
    'quantumResistance',
]);

export function presentSettingsWindow(parent) {
    const window = new Adw.PreferencesWindow({
        default_height: 680,
        default_width: 720,
        modal: true,
        search_enabled: true,
        title: 'NetBird Settings',
        transient_for: parent,
    });
    const addedPages = new Set();
    const managedIcons = new Map();
    const rows = new Map();
    const pages = [];
    let controller = null;
    let profileIds = [];
    let suppress = false;

    const general = createPage('General', 'preferences-system-symbolic');
    general.add(group('General', [
        switchRow('allowSsh', 'Allow SSH',
            'Allow NetBird SSH access to this peer'),
        switchRow('connectOnStartup', 'Connect on Startup',
            'Start NetBird automatically when you sign in'),
        switchRow('quantumResistance', 'Enable Quantum Resistance',
            'Enable Rosenpass permissive mode'),
        switchRow('lazyConnections', 'Enable Lazy Connections',
            'Only establish peer connections when needed'),
        switchRow('blockInbound', 'Block Inbound Connections',
            'Block inbound peer connections'),
        switchRow('notifications', 'Notifications',
            'Show NetBird desktop notifications'),
    ]));
    const debugBundleRow = buttonRow('Create Debug Bundle',
        'Save a diagnostic archive using the NetBird daemon',
        'document-save-symbolic', async () => {
            try {
                const path = await controller.createDebugBundle();
                if (!controller.cancelled)
                    window.add_toast(new Adw.Toast({title: path}));
            } catch (error) {
                if (!controller.cancelled)
                    showError(window, 'Debug Bundle Could Not Be Created', error);
            }
        });
    const updateRow = buttonRow('Check for NetBird Update',
        'Ask the NetBird daemon to start its updater',
        'software-update-available-symbolic', async () => {
            try {
                const result = await controller.triggerUpdate();
                if (!controller.cancelled)
                    window.add_toast(new Adw.Toast({title: result.message}));
            } catch (error) {
                if (!controller.cancelled)
                    showError(window, 'Update Could Not Be Started', error);
            }
        });
    general.add(group('Diagnostics', [debugBundleRow, updateRow]));

    const profiles = createPage('Profiles', 'system-users-symbolic');
    const profileRow = new Adw.ComboRow({
        subtitle: 'Choose which profile to edit',
        title: 'Profile',
    });
    rows.set('profile', profileRow);
    profileRow.connect('notify::selected', () => {
        if (!suppress)
            void controller.load(profileIds[profileRow.selected] ?? '');
    });
    profiles.add(group('Current Profile', [profileRow]));
    profiles.add(group('Profile Actions', [
        buttonRow('Add Profile', 'Create a separate NetBird configuration',
            'list-add-symbolic', () => promptForName(
                window, 'Add Profile', 'Add', '',
                name => controller.addProfile(name))),
        buttonRow('Rename Profile', 'Change the current profile’s display name',
            'document-edit-symbolic', () => {
                const selected = profileRow.selected;
                promptForName(window, 'Rename Profile', 'Rename',
                    profileRow.model?.get_string(selected) ?? '',
                    name => controller.renameProfile(name));
            }),
        buttonRow('Sign Out', 'Remove this profile’s authenticated session',
            'system-log-out-symbolic', () => confirmAction(
                window, 'Sign Out of This Profile?',
                'You will need to sign in again before reconnecting.',
                'Sign Out', 'destructive-action',
                () => controller.logoutProfile())),
        buttonRow('Remove Profile', 'Delete this local profile configuration',
            'user-trash-symbolic', () => confirmAction(
                window, 'Remove This Profile?',
                'This removes the local NetBird profile and cannot be undone.',
                'Remove', 'destructive-action',
                () => controller.removeProfile()), true),
    ]));

    const connection = createPage(
        'Connection', 'network-transmit-receive-symbolic');
    connection.add(group('Management', [
        entryRow('managementUrl', 'Management URL'),
        passwordRow('preSharedKey', 'Pre-Shared Key', MASKED_PRESHARED_KEY),
    ]));
    connection.add(group('WireGuard', [
        entryRow('interfaceName', 'Interface Name'),
        spinRow('interfacePort', 'Listen Port', 0, 65535, 1),
        spinRow('mtu', 'MTU', 0, 65535, 1),
    ]));

    const network = createPage('Network', 'network-workgroup-symbolic');
    network.add(group('Routes and DNS', [
        switchRow('networkMonitor', 'Network Monitor',
            'React to system network changes'),
        switchRow('disableDns', 'Disable NetBird DNS',
            'Do not configure DNS from NetBird'),
        switchRow('disableClientRoutes', 'Disable Client Routes',
            'Do not install routes received from the network'),
        switchRow('disableServerRoutes', 'Disable Server Routes',
            'Do not publish configured routes from this peer'),
        switchRow('blockLanAccess', 'Block LAN Access',
            'Block local-network access while using an exit node'),
        switchRow('disableIpv6', 'Disable IPv6',
            'Do not use IPv6 for NetBird connectivity'),
    ]));

    const ssh = createPage('SSH', 'utilities-terminal-symbolic');
    ssh.add(group('SSH Server', [
        switchRow('disableSshAuthentication', 'Disable Authentication',
            'Permit SSH without NetBird identity authentication'),
        switchRow('sshRootLogin', 'Allow Root Login',
            'Permit direct root SSH sessions'),
        switchRow('sshSftp', 'Enable SFTP',
            'Allow secure file transfer over SSH'),
        switchRow('sshLocalPortForwarding', 'Local Port Forwarding',
            'Allow local SSH port forwarding'),
        switchRow('sshRemotePortForwarding', 'Remote Port Forwarding',
            'Allow remote SSH port forwarding'),
        spinRow('jwtCacheTtl', 'Identity Cache Lifetime', 0, 86400, 1,
            'Seconds to cache SSH identity tokens'),
    ]));

    controller = new SettingsController({
        onBusyChanged(busy) {
            for (const preferencePage of pages)
                preferencePage.sensitive = !busy;
        },
        onError(title, error) {
            showError(window, title, error);
        },
        onLoaded(state) {
            suppress = true;
            profileIds = state.profiles.map(profile => profile.id);
            profileRow.model = Gtk.StringList.new(
                state.profiles.map(profile => profile.name));
            profileRow.selected = Math.max(0,
                state.profiles.findIndex(profile =>
                    profile.id === state.profileId));

            const managedKeys = new Set(state.managedKeys);
            const updatesDisabled = state.features.disableUpdateSettings;
            const showManagedSsh = managedKeys.has('allowSsh') &&
                state.values.get('allowSsh');
            const enabledPages = pages.filter(preferencePage =>
                (preferencePage !== profiles || !state.features.disableProfiles) &&
                (preferencePage !== connection || !updatesDisabled) &&
                (preferencePage !== network ||
                    (!updatesDisabled && !state.features.disableNetworks)) &&
                (preferencePage !== ssh || !updatesDisabled || showManagedSsh));
            for (const preferencePage of addedPages)
                window.remove(preferencePage);
            addedPages.clear();
            for (const preferencePage of enabledPages) {
                window.add(preferencePage);
                addedPages.add(preferencePage);
            }
            for (const [key, value] of state.values) {
                const row = rows.get(key);
                if (!row)
                    continue;

                setRowValue(row, value);
                const managed = managedKeys.has(key);
                row.sensitive = !managed;
                managedIcons.get(key).visible = managed;
                if (GENERAL_RESTRICTED_KEYS.has(key)) {
                    row.visible = !updatesDisabled || key === 'notifications' ||
                        (key === 'allowSsh' && managed);
                }
            }
            suppress = false;
        },
        onValueRestored(key, value) {
            const row = rows.get(key);
            if (!row)
                return;

            suppress = true;
            setRowValue(row, value);
            suppress = false;
        },
    });

    for (const preferencePage of [general, profiles, connection, network, ssh]) {
        pages.push(preferencePage);
        window.add(preferencePage);
        addedPages.add(preferencePage);
    }

    window.connect('close-request', () => {
        controller.destroy();
        return false;
    });
    window.present();
    void controller.load();
    return window;

    function createPage(title, iconName) {
        return new Adw.PreferencesPage({icon_name: iconName, title});
    }

    function group(title, children) {
        const preferenceGroup = new Adw.PreferencesGroup({title});
        for (const child of children)
            preferenceGroup.add(child);
        return preferenceGroup;
    }

    function switchRow(key, title, subtitle) {
        const row = new Adw.SwitchRow({subtitle, title});
        registerSettingRow(key, row);
        row.connect('notify::active', () => {
            if (!suppress)
                void controller.setValue(key, row.active);
        });
        return row;
    }

    function entryRow(key, title) {
        const row = new Adw.EntryRow({show_apply_button: true, title});
        registerSettingRow(key, row);
        connectTextCommit(row, key);
        return row;
    }

    function passwordRow(key, title, placeholder) {
        const row = new Adw.PasswordEntryRow({
            show_apply_button: true,
            text: placeholder,
            title,
        });
        registerSettingRow(key, row);
        connectTextCommit(row, key);
        return row;
    }

    function connectTextCommit(row, key) {
        const commit = () => {
            if (!suppress)
                void controller.setValue(key, row.text.trim());
        };
        row.connect('apply', commit);
        const focus = new Gtk.EventControllerFocus();
        focus.connect('leave', commit);
        row.add_controller(focus);
    }

    function spinRow(key, title, lower, upper, step, subtitle = '') {
        const row = Adw.SpinRow.new_with_range(lower, upper, step);
        row.title = title;
        row.subtitle = subtitle;
        registerSettingRow(key, row);
        row.connect('notify::value', () => {
            if (!suppress)
                void controller.setValue(key, Math.round(row.value));
        });
        return row;
    }

    function registerSettingRow(key, row) {
        const managedIcon = new Gtk.Image({
            icon_name: 'changes-prevent-symbolic',
            tooltip_text: 'Managed by your organization',
            visible: false,
        });
        row.add_suffix(managedIcon);
        managedIcons.set(key, managedIcon);
        rows.set(key, row);
    }
}

function setRowValue(row, value) {
    if (row instanceof Adw.SwitchRow)
        row.active = Boolean(value);
    else if (row instanceof Adw.SpinRow)
        row.value = Number(value ?? 0);
    else
        row.text = String(value ?? '');
}

function buttonRow(title, subtitle, iconName, callback, destructive = false) {
    const row = new Adw.ActionRow({subtitle, title});
    const button = new Gtk.Button({
        icon_name: iconName,
        tooltip_text: title,
        valign: Gtk.Align.CENTER,
    });
    if (destructive)
        button.add_css_class('destructive-action');
    button.connect('clicked', callback);
    row.add_suffix(button);
    row.activatable_widget = button;
    return row;
}

function promptForName(parent, heading, responseLabel, initialText, callback) {
    const entry = new Gtk.Entry({
        activates_default: true,
        hexpand: true,
        text: initialText,
    });
    const dialog = new Adw.AlertDialog({
        body: 'Profile names should be short and easy to recognize.',
        close_response: 'cancel',
        default_response: 'accept',
        extra_child: entry,
        heading,
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('accept', responseLabel);
    dialog.set_response_appearance('accept', Adw.ResponseAppearance.SUGGESTED);
    dialog.set_response_enabled('accept', initialText.trim().length > 0);
    entry.connect('changed', () => dialog.set_response_enabled(
        'accept', entry.text.trim().length > 0));
    dialog.connect('response', (_dialog, response) => {
        if (response === 'accept')
            void callback(entry.text.trim());
    });
    dialog.present(parent);
}

function confirmAction(parent, heading, body, responseLabel, appearance, callback) {
    const dialog = new Adw.AlertDialog({
        body,
        close_response: 'cancel',
        default_response: 'cancel',
        heading,
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('accept', responseLabel);
    dialog.set_response_appearance(
        'accept', appearance === 'destructive-action'
            ? Adw.ResponseAppearance.DESTRUCTIVE
            : Adw.ResponseAppearance.SUGGESTED);
    dialog.connect('response', (_dialog, response) => {
        if (response === 'accept')
            void callback();
    });
    dialog.present(parent);
}

function showError(parent, heading, error) {
    const dialog = new Adw.AlertDialog({
        body: String(error?.privilegeSummary || error?.message || error),
        close_response: 'close',
        heading,
    });
    if (error?.privilegeRequired && /^(sudo )?netbird /.test(error.privilegeCommand)) {
        dialog.extra_child = new Gtk.Label({
            css_classes: ['monospace'],
            label: error.privilegeCommand,
            selectable: true,
            wrap: true,
        });
    }
    dialog.add_response('close', 'Close');
    dialog.present(parent);
}
