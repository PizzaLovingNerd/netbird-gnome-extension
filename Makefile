UUID := gnome@netbird.io
ZIP := build/$(UUID).shell-extension.zip
JS_FILES := extension.js prefs.js $(shell find netbird prefs shell tests \
	-type f -name '*.js' -print)
SYMBOLIC_STATUS_ICONS := $(wildcard \
	icons/hicolor/scalable/status/netbird-systemtray-*-symbolic.svg)

.PHONY: all check clean lint live-api-test package syntax test ui-smoke

all: check package

check: lint syntax test
	@node -e "JSON.parse(require('fs').readFileSync('metadata.json'))"
	@if rg -n "gi://(Adw|Gdk|Gtk)" extension.js shell; then \
		echo "GTK/Adwaita import found in the GNOME Shell process" >&2; exit 1; \
	fi
	@if rg -n "resource:///org/gnome/shell|gi://(Clutter|Meta|Shell|St)" \
		prefs.js prefs; then \
		echo "GNOME Shell import found in the preferences process" >&2; exit 1; \
	fi
	@if rg -n "Gio\\.Subprocess|spawn_command_line|GLib\\.spawn|\\beval\\(" \
		--glob '*.js' extension.js netbird prefs shell; then \
		echo "Forbidden process or eval API found" >&2; exit 1; \
	fi
	@test $(words $(SYMBOLIC_STATUS_ICONS)) -eq 5 || { \
		echo "Expected five bundled NetBird status icons" >&2; exit 1; \
	}
	@if rg -n "stroke=" $(SYMBOLIC_STATUS_ICONS); then \
		echo "Symbolic status icons must use recolorable filled paths" >&2; exit 1; \
	fi

lint:
	@npm run lint

syntax:
	@for file in $(JS_FILES); do node --check "$$file"; done

test:
	@gjs -m tests/api.test.js
	@gjs -m tests/settings-controller.test.js
	@gjs -m tests/status-controller.test.js
	@gjs -m tests/status-icons.test.js
	@gjs -m tests/window-activation.test.js

live-api-test:
	@test -S /var/run/netbird-http.sock || { \
		echo "NetBird JSON socket is unavailable" >&2; exit 1; \
	}
	@gjs -m tests/live-api.test.js

ui-smoke: check
	@gjs -m tests/prefs-smoke.js

package: check
	@mkdir -p build
	@gnome-extensions pack --force --out-dir=build \
		--extra-source=LICENSE \
		--extra-source=LICENSES \
		--extra-source=icons \
		--extra-source=netbird \
		--extra-source=prefs \
		--extra-source=shell \
		.
	@test -f "$(ZIP)"
	@echo "Built $(ZIP)"

clean:
	@rm -f "$(ZIP)"
