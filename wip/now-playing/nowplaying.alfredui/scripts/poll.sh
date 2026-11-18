#!/bin/bash
# Pulse script: reads now-playing state and prints Alfred UI JSON Actions
# that update the panel. Runs every PULSE_PLAYING or PULSE_IDLE seconds
# (see lib.sh and "pulse" in ui.json).
# Test it on its own:  ./scripts/poll.sh | jq

. "$(dirname "$0")/lib.sh"
load_track

case "$state" in
  missing)
    show_message "Adapter not installed" "Run vendor.sh in the .alfredui folder" "wrench.and.screwdriver" | with_pulse "$PULSE_IDLE"
    exit 0 ;;
  error)
    show_message "Adapter error ($rc)" "$(head -n1 "$CACHE/last-error")" "exclamationmark.triangle" | with_pulse "$PULSE_IDLE"
    exit 0 ;;
  idle)
    show_message "Nothing playing" | with_pulse "$PULSE_IDLE"
    exit 0 ;;
esac

if [ "$(jq -r '.playing' <<<"$info")" = "true" ]; then interval="$PULSE_PLAYING"; else interval="$PULSE_IDLE"; fi

jq -nc --argjson i "$info" --arg art "$art" --arg app "$app" "$JQ_TIME"'
  ($i.duration // 0) as $dur
  | ($i | position) as $pos
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
