// SPDX-License-Identifier: GPL-3.0-or-later

const PREFERENCES_TITLES = new Set([
    'NetBird',
    'NetBird for GNOME',
]);
const PREFERENCES_APPLICATION_ID = 'org.gnome.Shell.Extensions';

export function activateExistingPreferences(windows, activateWindow) {
    const window = windows.find(candidate =>
        (candidate.get_gtk_application_id() ?? candidate.get_wm_class()) ===
            PREFERENCES_APPLICATION_ID &&
        PREFERENCES_TITLES.has(candidate.get_title()));
    if (!window)
        return false;

    if (window.minimized)
        window.unminimize();
    activateWindow(window);
    return true;
}
