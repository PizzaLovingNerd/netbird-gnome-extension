// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

import {createHomePage} from './homePage.js';
import {MainController} from './mainController.js';
import {createPeersPage} from './peersPage.js';
import {createResourcesPage} from './resourcesPage.js';
import {presentSettingsWindow} from './settingsWindow.js';

const ENABLE_SOCKET_COMMAND =
    'sudo netbird service reconfigure --enable-json-socket';

export function populateMainWindow(window) {
    let controller = null;
    window.default_height = 620;
    window.default_width = 820;
    window.modal = false;
    window.search_enabled = false;
    window.title = 'NetBird';

    // The GNOME preferences host verifies that extensions register a page.
    // NetBird replaces the window content with its full application layout,
    // but the registered page must remain available to the host lifecycle.
    window.add(new Adw.PreferencesPage({title: 'NetBird'}));

    const toastOverlay = new Adw.ToastOverlay();
    const toolbar = new Adw.ToolbarView();
    const header = new Adw.HeaderBar();
    const profileDropDown = new Gtk.DropDown({
        model: Gtk.StringList.new([]),
        tooltip_text: 'Active NetBird profile',
    });
    profileDropDown.update_property(
        [Gtk.AccessibleProperty.LABEL],
        ['Active NetBird profile']);
    header.pack_start(profileDropDown);

    const stack = new Adw.ViewStack({vexpand: true});
    const viewSwitcher = new Adw.ViewSwitcher({
        policy: Adw.ViewSwitcherPolicy.WIDE,
        stack,
    });
    header.title_widget = viewSwitcher;

    const refreshButton = headerActionButton(
        'view-refresh-symbolic', 'Refresh', 'netbird.refresh');
    const settingsButton = headerActionButton(
        'emblem-system-symbolic', 'Settings', 'netbird.settings');
    const endControls = new Gtk.Box({spacing: 2});
    endControls.append(refreshButton);
    endControls.append(settingsButton);
    header.pack_end(endControls);
    toolbar.add_top_bar(header);

    const home = createHomePage({
        onSelectExitNode: id => void controller.selectExitNode(id),
        onSocketHelp: () => showSocketHelp(window),
        onToggleConnection: () => void controller.toggleConnection(),
    });
    const peers = createPeersPage();
    const resources = createResourcesPage({
        onResourceToggled: (id, selected) =>
            void controller.setNetworkSelected(id, selected),
    });
    const homeStackPage = stack.add_titled_with_icon(
        home.root, 'home', 'Home', 'go-home-symbolic');
    const peersStackPage = stack.add_titled_with_icon(
        peers.root, 'peers', 'Peers', 'computer-symbolic');
    const resourcesStackPage = stack.add_titled_with_icon(
        resources.root, 'resources', 'Resources', 'network-workgroup-symbolic');
    stack.visible_child_name = 'home';

    const viewSwitcherBar = new Adw.ViewSwitcherBar({stack});
    toolbar.add_bottom_bar(viewSwitcherBar);

    const compactBreakpoint = new Adw.Breakpoint({
        condition: Adw.BreakpointCondition.parse('max-width: 600sp'),
    });
    compactBreakpoint.add_setter(viewSwitcher, 'visible', false);
    compactBreakpoint.add_setter(viewSwitcherBar, 'reveal', true);
    window.add_breakpoint(compactBreakpoint);

    toolbar.content = stack;
    toastOverlay.child = toolbar;
    window.set_content(toastOverlay);

    let profileIds = [];
    let settingsWindow = null;
    let suppressProfile = false;
    const actionGroup = new Gio.SimpleActionGroup();
    window.insert_action_group('netbird', actionGroup);

    const refreshAction = new Gio.SimpleAction({name: 'refresh'});
    refreshAction.connect('activate', () => void controller.refresh());
    actionGroup.add_action(refreshAction);

    const settingsAction = new Gio.SimpleAction({name: 'settings'});
    settingsAction.connect('activate', () => {
        if (settingsWindow) {
            settingsWindow.present();
            return;
        }

        settingsWindow = presentSettingsWindow(window);
        settingsWindow.connect('close-request', () => {
            settingsWindow = null;
            return false;
        });
    });
    actionGroup.add_action(settingsAction);

    controller = new MainController({
        onError(title, error) {
            showError(window, title, error);
        },
        onStateChanged(state) {
            home.update(state);
            peers.update(state);
            resources.update(state);

            suppressProfile = true;
            profileIds = state.profiles.map(profile => profile.id);
            profileDropDown.model = Gtk.StringList.new(
                state.profiles.map(profile => profile.name));
            const selected = state.profiles.findIndex(profile => profile.isActive);
            profileDropDown.selected = Math.max(0, selected);
            suppressProfile = false;
            profileDropDown.visible = !state.features.disableProfiles &&
                state.profiles.length > 0;
            profileDropDown.sensitive = !state.busy;
            peersStackPage.visible = !state.features.disableAdvancedView;
            resourcesStackPage.visible = !state.features.disableAdvancedView &&
                !state.features.disableNetworks;
            if (!stack.visible_child?.visible)
                stack.visible_child_name = 'home';
            refreshAction.enabled = !state.busy;
        },
    });

    profileDropDown.connect('notify::selected', () => {
        if (!suppressProfile)
            void controller.selectProfile(profileIds[profileDropDown.selected] ?? '');
    });

    const shortcuts = new Gtk.ShortcutController();
    addNamedShortcut(shortcuts, '<Control>comma', 'netbird.settings');
    addNamedShortcut(shortcuts, '<Control>r', 'netbird.refresh');
    addCallbackShortcut(shortcuts, '<Control>f', () => {
        if (peersStackPage.visible) {
            stack.visible_child_name = 'peers';
            peers.focusSearch();
        }
    });
    addCallbackShortcut(shortcuts, '<Alt>1', () => {
        stack.visible_child_name = 'home';
    });
    addCallbackShortcut(shortcuts, '<Alt>2', () => {
        if (peersStackPage.visible)
            stack.visible_child_name = 'peers';
    });
    addCallbackShortcut(shortcuts, '<Alt>3', () => {
        if (resourcesStackPage.visible)
            stack.visible_child_name = 'resources';
    });
    addCallbackShortcut(shortcuts, '<Control>w', () => window.close());
    window.add_controller(shortcuts);

    window.connect('close-request', () => {
        controller.destroy();
        settingsWindow?.close();
        settingsWindow = null;
        return false;
    });

    return {
        home,
        homeStackPage,
        peers,
        peersStackPage,
        resources,
        resourcesStackPage,
        stack,
    };
}

function headerActionButton(iconName, label, actionName) {
    const button = new Gtk.Button({
        action_name: actionName,
        css_classes: ['flat'],
        icon_name: iconName,
        tooltip_text: label,
        valign: Gtk.Align.CENTER,
    });
    button.update_property([Gtk.AccessibleProperty.LABEL], [label]);
    return button;
}

function addNamedShortcut(controller, trigger, action) {
    controller.add_shortcut(new Gtk.Shortcut({
        action: Gtk.NamedAction.new(action),
        trigger: Gtk.ShortcutTrigger.parse_string(trigger),
    }));
}

function addCallbackShortcut(controller, trigger, callback) {
    controller.add_shortcut(new Gtk.Shortcut({
        action: Gtk.CallbackAction.new(() => {
            callback();
            return true;
        }),
        trigger: Gtk.ShortcutTrigger.parse_string(trigger),
    }));
}

function showSocketHelp(parent) {
    const label = new Gtk.Label({
        css_classes: ['monospace'],
        label: ENABLE_SOCKET_COMMAND,
        selectable: true,
        wrap: true,
    });
    const dialog = new Adw.AlertDialog({
        body: 'NetBird needs one local setting before this extension can connect. ' +
            'Run the command below in Terminal, then reopen NetBird. Your connection ' +
            'may pause briefly while the service restarts.',
        close_response: 'close',
        extra_child: label,
        heading: '<b>Finish Setting Up NetBird</b>',
        heading_use_markup: true,
    });
    dialog.add_response('close', 'Close');
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
