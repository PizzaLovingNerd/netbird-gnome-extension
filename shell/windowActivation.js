// SPDX-License-Identifier: GPL-3.0-or-later

const PREFERENCES_TITLES = new Set([
    'NetBird',
    'NetBird for GNOME',
]);

export function activateExistingPreferences(windows, activateWindow) {
    const window = windows.find(candidate =>
        PREFERENCES_TITLES.has(candidate.get_title()));
    if (!window)
        return false;

    if (window.minimized)
        window.unminimize();
    activateWindow(window);
    return true;
}
