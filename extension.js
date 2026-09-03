// SPDX-License-Identifier: GPL-3.0-or-later

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {NetBirdIndicator} from './shell/indicator.js';
import {activateExistingPreferences} from './shell/windowActivation.js';

export default class NetBirdExtension extends Extension {
    enable() {
        this._indicator = new NetBirdIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }

    openPreferences() {
        const windows = global.get_window_actors()
            .map(actor => actor.meta_window)
            .filter(Boolean);
        if (activateExistingPreferences(windows, Main.activateWindow))
            return;

        super.openPreferences();
    }
}
