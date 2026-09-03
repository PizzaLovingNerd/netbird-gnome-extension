// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {StatusIcons} from '../shell/statusIcons.js';

const expectedFiles = {
    Connected: 'netbird-systemtray-connected-symbolic.svg',
    Connecting: 'netbird-systemtray-connecting-symbolic.svg',
    Idle: 'netbird-systemtray-disconnected-symbolic.svg',
    LoginFailed: 'netbird-systemtray-needs-login-symbolic.svg',
    NeedsLogin: 'netbird-systemtray-needs-login-symbolic.svg',
    SessionExpired: 'netbird-systemtray-needs-login-symbolic.svg',
    Unavailable: 'netbird-systemtray-error-symbolic.svg',
};

const projectDirectory = Gio.File.new_for_path(GLib.get_current_dir());
const statusIcons = new StatusIcons(projectDirectory);
for (const [state, expectedFile] of Object.entries(expectedFiles)) {
    const icon = statusIcons.forState(state);
    if (!(icon instanceof Gio.FileIcon))
        throw new Error(`${state} did not resolve to a bundled icon`);

    const file = icon.get_file();
    if (file.get_basename() !== expectedFile)
        throw new Error(`${state} resolved to ${file.get_basename()}`);
    if (!file.query_exists(null))
        throw new Error(`${expectedFile} is missing`);
    print(`ok ${state} uses ${expectedFile}`);
}
