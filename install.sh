#!/usr/bin/env bash

set -euo pipefail

extension_uuid='gnome@netbird.io'
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
build_dir="$project_dir/build"
archive_path="$build_dir/$extension_uuid.shell-extension.zip"

if ! command -v gnome-extensions >/dev/null 2>&1; then
    printf 'Error: gnome-extensions is required to install this extension.\n' >&2
    exit 1
fi

mkdir -p "$build_dir"

cd "$project_dir"
gnome-extensions pack --force --out-dir="$build_dir" \
    --extra-source=LICENSE \
    --extra-source=LICENSES \
    --extra-source=icons \
    --extra-source=netbird \
    --extra-source=prefs \
    --extra-source=shell \
    .

gnome-extensions install --force "$archive_path"

printf 'Installed NetBird for GNOME (%s).\n' "$extension_uuid"
printf 'Log out and back in, then enable it with:\n'
printf '  gnome-extensions enable %s\n' "$extension_uuid"
