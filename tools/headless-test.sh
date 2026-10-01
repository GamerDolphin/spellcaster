#!/usr/bin/env bash
# Runs Spellcaster inside a throwaway, invisible GNOME Shell, draws every
# rune with a virtual mouse, and saves screenshots + results.
#
#   tools/headless-test.sh [output-folder]
#
# Everything (settings, extensions, caches) lives in a temp folder, so your
# real desktop and settings are never touched. Suspend/lock are faked by
# the test driver.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$REPO/test-output}"
UUID="spellcaster@gamerdolphin.github.io"
WORK="$(mktemp -d -t spellcaster-test.XXXXXX)"
cleanup() {
    fusermount3 -u "$WORK/runtime/doc" 2>/dev/null || fusermount -u "$WORK/runtime/doc" 2>/dev/null || true
    rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$OUT" "$WORK"/{config,cache,state,runtime} "$WORK/data/gnome-shell/extensions" "$WORK/data/applications"
chmod 700 "$WORK/runtime"
rm -f "$OUT"/*.png "$OUT/results.json"

glib-compile-schemas "$REPO/$UUID/schemas"
ln -s "$REPO/$UUID" "$WORK/data/gnome-shell/extensions/$UUID"
ln -s "$REPO/tools/shelltest@spellcaster" "$WORK/data/gnome-shell/extensions/shelltest@spellcaster"

cat > "$WORK/data/applications/spellcaster-testwin.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Spellcaster Test Window
Exec=gjs -m "$REPO/tools/test-window.js" "Window Lightning"
DESKTOP

export XDG_CONFIG_HOME="$WORK/config" XDG_DATA_HOME="$WORK/data" XDG_CACHE_HOME="$WORK/cache" \
    XDG_STATE_HOME="$WORK/state" XDG_RUNTIME_DIR="$WORK/runtime" \
    SPELLTEST_OUT="$OUT" SPELLTEST_REPO="$REPO" GSETTINGS_BACKEND=dconf
unset WAYLAND_DISPLAY DISPLAY DBUS_SESSION_BUS_ADDRESS

dbus-run-session -- bash -c "
    gsettings set org.gnome.shell enabled-extensions \"['$UUID', 'shelltest@spellcaster']\"
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell welcome-dialog-last-shown-version '9999'
    timeout 300 gnome-shell --headless --wayland --no-x11 --force-animations \
        --virtual-monitor 1920x1080 --wayland-display spellcaster-test 2>&1
" > "$OUT/shell.log" || true

echo "--- Spellcaster messages ---"
grep -iE "SPELLTEST|spellcaster|JS ERROR|JS WARNING" "$OUT/shell.log" | grep -v "^$" | head -200 || true
echo "Screenshots and results are in: $OUT"
