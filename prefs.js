// SPDX-License-Identifier: GPL-3.0-or-later

import Gtk from 'gi://Gtk?version=4.0';

import {ExtensionPreferences} from
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {populateMainWindow} from './prefs/mainWindow.js';

export default class NetBirdPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const iconDirectory = this.dir.get_child('icons').get_path();
        const iconTheme = Gtk.IconTheme.get_for_display(window.get_display());
        iconTheme.add_search_path(iconDirectory);
        populateMainWindow(window);
    }
}
