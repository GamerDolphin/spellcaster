UUID := spellcaster@gamerdolphin.github.io
EXT_DIR := $(HOME)/.local/share/gnome-shell/extensions
SRC := $(CURDIR)/$(UUID)

.PHONY: install dev-install uninstall pack test test-shell check

## install: build a zip and install it (copies files)
install: pack
	gnome-extensions install --force dist/$(UUID).shell-extension.zip
	@echo "Installed. Log out and back in, then run: gnome-extensions enable $(UUID)"

## dev-install: link this folder into GNOME, so edits apply after re-login
dev-install:
	glib-compile-schemas "$(SRC)/schemas"
	mkdir -p "$(EXT_DIR)"
	rm -rf "$(EXT_DIR)/$(UUID)"
	ln -s "$(SRC)" "$(EXT_DIR)/$(UUID)"
	@echo "Linked. Log out and back in, then run: gnome-extensions enable $(UUID)"

uninstall:
	-gnome-extensions disable $(UUID)
	rm -rf "$(EXT_DIR)/$(UUID)"

## pack: make dist/<uuid>.shell-extension.zip (for extensions.gnome.org)
pack:
	mkdir -p dist
	gnome-extensions pack "$(SRC)" --force --out-dir=dist \
		--extra-source=lib --extra-source=spells

## check: syntax check + rune recognizer tests (fast)
check:
	gjs -m tools/check-syntax.js
	gjs -m tests/recognizer.test.js

## test-shell: full test in an invisible GNOME Shell, with screenshots
test-shell:
	tools/headless-test.sh test-output

test: check test-shell
