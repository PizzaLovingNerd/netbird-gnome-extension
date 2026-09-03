// SPDX-License-Identifier: GPL-3.0-or-later

import GObject from 'gi://GObject';

import {SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {NetBirdToggle} from './quickToggle.js';
import {StatusIcons} from './statusIcons.js';

export const NetBirdIndicator = GObject.registerClass({
    GTypeName: 'NetBirdExtensionIndicator',
}, class NetBirdIndicatorImpl extends SystemIndicator {
    constructor(extension) {
        super();

        this._statusIcons = new StatusIcons(extension.dir);
        const gicon = this._statusIcons.forState('Unavailable');

        this._panelIcon = this._addIndicator();
        this._panelIcon.gicon = gicon;
        this._toggle = new NetBirdToggle(
            extension, this._statusIcons, this._panelIcon);
        this.quickSettingsItems.push(this._toggle);
    }

    destroy() {
        this._toggle.destroy();
        this._toggle = null;
        this._statusIcons = null;
        super.destroy();
    }
});
