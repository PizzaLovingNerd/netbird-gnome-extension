#!/usr/bin/env bash

set -euo pipefail

uuid='gnome@netbird.io'
start_epoch=$(date +%s)
sleep 1

for iteration in $(seq 1 25); do
    gnome-extensions disable "$uuid"
    sleep 0.10
    gnome-extensions enable "$uuid"
    sleep 0.20

    state=$(gnome-extensions info "$uuid" | sed -n 's/^  State: //p')
    if [[ "$state" != 'ACTIVE' ]]; then
        printf 'FAIL: cycle %s ended in state %s\n' "$iteration" "$state"
        exit 1
    fi
done

journal_hits=$(journalctl --user --since "@$start_epoch" --no-pager -o cat |
    grep -Ei 'gnome@netbird.io|JS ERROR|gjs-CRITICAL' || true)

if printf '%s' "$journal_hits" |
    grep -Eiq 'JS ERROR|CRITICAL|TypeError|ReferenceError'; then
    printf 'FAIL: lifecycle window contains extension errors\n%s\n' "$journal_hits"
    exit 1
fi

gnome-extensions disable "$uuid"
final_state=$(gnome-extensions info "$uuid" | sed -n 's/^  State: //p')
[[ "$final_state" == 'INACTIVE' ]]

gsettings set org.gnome.desktop.interface color-scheme default

gnome-shell --version
printf 'PASS: 25 disable/enable cycles\n'
printf 'PASS: final state INACTIVE\n'
printf 'PASS: lifecycle journal CLEAN\n'
