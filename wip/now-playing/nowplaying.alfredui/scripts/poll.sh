#!/bin/bash
# Pulse script: reads now-playing state and prints Alfred UI JSON Actions
# that update the panel. Runs every second (see "pulse" in ui.json).
# Test it on its own:  ./scripts/poll.sh | jq

. "$(dirname "$0")/lib.sh"
CACHE="${alfred_workflow_cache:-$HOME/Library/Caches/nz.carl.nowplaying}"
mkdir -p "$CACHE"

if ! adapter_installed; then
  show_message "Adapter not installed" "Run vendor.sh in the .alfredui folder" "wrench.and.screwdriver"
  exit 0
fi

# Cheap call every pulse: metadata only, no base64 artwork.
errfile="$CACHE/last-error"
info="$(adapter get --no-artwork 2>"$errfile")"
rc=$?

# Non-zero exit is fatal (stderr lines with exit 0 are documented as harmless).
if [ $rc -ne 0 ]; then
  show_message "Adapter error ($rc)" "$(head -n1 "$errfile")" "exclamationmark.triangle"
  exit 0
fi

if [ -z "$info" ] || [ "$info" = "null" ]; then
  show_message "Nothing playing"
  exit 0
fi

# One artwork file per track, so the image view never shows a stale cached image.
key="$(jq -r '[.bundleIdentifier, .title, .artist // "", .album // ""] | join("|")' <<<"$info" | shasum | cut -c1-16)"

art=""
for f in "$CACHE"/art-"$key".*; do
  [ -s "$f" ] && art="$f"
done

# Only pay for the full (artwork-carrying) call when the track has changed.
# Artwork often arrives a beat after the title, so this retries until it shows up.
if [ -z "$art" ]; then
  full="$(adapter get 2>/dev/null)"
  data="$(jq -r '.artworkData // empty' <<<"$full" 2>/dev/null)"
  if [ -n "$data" ]; then
    mime="$(jq -r '.artworkMimeType // "image/jpeg"' <<<"$full")"
    ext="${mime#image/}"; [ "$ext" = "jpeg" ] && ext="jpg"
    rm -f "$CACHE"/art-*                       # drop the previous track's art
    art="$CACHE/art-$key.$ext"
    printf '%s' "$data" | base64 --decode > "$art" 2>/dev/null || art=""
  fi
fi

jq -nc --argjson i "$info" --arg art "$art" '
  {update: {ids: {
    art: {image: (if $art == "" then {type: "symbol", src: "music.note", size: {width: 96}}
                  else {type: "file", src: $art} end)},
    title:     {text: $i.title},
    artist:    {text: ($i.artist // "")},
    album:     {text: ($i.album // "")},
    playpause: {image: {type: "symbol", src: (if $i.playing then "pause.fill" else "play.fill" end)}}
  }}}'
