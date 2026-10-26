#!/usr/bin/env bash
# Renders the README pictures from the HTML files beside this script, with
# headless Chromium, into the folder above.
#
#   assets/src/render.sh [font-dir ...]
#
# Font folders, if given, are the only fonts used, which keeps the pictures the
# same on any machine. They need Inter and a colour emoji font, for example
# Noto Color Emoji. CHROMIUM names the browser when it isn't on PATH.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$(dirname "$here")"
chromium="${CHROMIUM:-${CHROMIUM_BIN:-chromium}}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if [ $# -gt 0 ]; then
  {
    echo '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>'
    for dir in "$@"; do echo "<dir>$dir</dir>"; done
    echo "<cachedir>$work/cache</cachedir></fontconfig>"
  } > "$work/fonts.conf"
  export FONTCONFIG_FILE="$work/fonts.conf"
fi

shot() {
  "$chromium" --headless --no-sandbox --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=2 --user-data-dir="$work/profile" \
    --window-size="$2" --screenshot="$out/$3" "file://$here/$1" >/dev/null 2>&1
}

shot panel.html 760,548 panel.png
shot palettes.html 920,215 palettes.png
shot tabs-md.html 900,1765 tabs-md.png
