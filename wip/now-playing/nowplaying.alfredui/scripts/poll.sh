#!/bin/bash
# Pulse script: reads now-playing state and prints Alfred UI JSON Actions
# that update the panel. Runs every PULSE_PLAYING or PULSE_IDLE seconds
# (see lib.sh and "pulse" in ui.json).
# Test it on its own:  ./scripts/poll.sh | jq

. "$(dirname "$0")/lib.sh"
CACHE="${alfred_workflow_cache:-$HOME/Library/Caches/nz.carl.nowplaying}"
mkdir -p "$CACHE"

if ! adapter_installed; then
  show_message "Adapter not installed" "Run vendor.sh in the .alfredui folder" "wrench.and.screwdriver" | with_pulse "$PULSE_IDLE"
  exit 0
fi

# Cheap call every pulse: metadata only, no base64 artwork. --now adds
# elapsedTimeNow, the current playback position.
errfile="$CACHE/last-error"
info="$(adapter get --no-artwork --now 2>"$errfile")"
rc=$?

# Non-zero exit is fatal (stderr lines with exit 0 are documented as harmless).
if [ $rc -ne 0 ]; then
  show_message "Adapter error ($rc)" "$(head -n1 "$errfile")" "exclamationmark.triangle" | with_pulse "$PULSE_IDLE"
  exit 0
fi

if [ -z "$info" ] || [ "$info" = "null" ]; then
  show_message "Nothing playing" | with_pulse "$PULSE_IDLE"
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

# The player's app path, cached per bundle ID (an empty file means no app was
# found), so the lookup only runs when the player changes.
app=""
bundle="$(jq -r '.bundleIdentifier // empty' <<<"$info")"
if [ -n "$bundle" ]; then
  appfile="$CACHE/app-$(printf '%s' "$bundle" | tr -c 'A-Za-z0-9.-' '_')"
  if [ ! -f "$appfile" ]; then
    osascript -l JavaScript "$(dirname "$0")/apppath.js" "$bundle" > "$appfile" 2>/dev/null || : > "$appfile"
  fi
  app="$(cat "$appfile")"
fi

playing="$(jq -r 'if .playing then "yes" else "no" end' <<<"$info")"
if [ "$playing" = "yes" ]; then interval="$PULSE_PLAYING"; else interval="$PULSE_IDLE"; fi

jq -nc --argjson i "$info" --arg art "$art" --arg app "$app" '
  def pad: tostring | if length < 2 then "0" + . else . end;
  def clock: floor as $s
    | if $s >= 3600 then "\($s / 3600 | floor):\($s % 3600 / 60 | floor | pad):\($s % 60 | pad)"
      else "\($s / 60 | floor):\($s % 60 | pad)" end;
  ($i.duration // 0) as $dur
  | ([$i.elapsedTimeNow // $i.elapsedTime // 0, $dur] | min | [., 0] | max) as $pos
  | ($dur <= 0) as $notime
  | {update: {ids: {
      art: {image: (if $art == "" then {type: "symbol", src: "music.note", size: {width: 96}}
                    else {type: "file", src: $art} end)},
      appicon:   (if $app == "" then {hidden: true}
                  else {hidden: false, image: {type: "fileicon", src: $app, size: {width: 16, height: 16}}} end),
      appname:   {text: ($app | split("/") | last // "" | rtrimstr(".app"))},
      title:     {text: $i.title},
      artist:    {text: ($i.artist // "")},
      album:     {text: ($i.album // "")},
      progress:  {progress: (if $notime then 0 else $pos / $dur end), hidden: $notime},
      elapsed:   {text: (if $notime then "" else $pos | clock end), hidden: $notime},
      duration:  {text: (if $notime then "" else $dur | clock end), hidden: $notime},
      playpause: {image: {type: "symbol", src: (if $i.playing then "pause.fill" else "play.fill" end)}}
    }}}' | with_pulse "$interval"
