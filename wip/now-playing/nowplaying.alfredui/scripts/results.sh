#!/bin/bash
# Script Filter for the `nowplaying` keyword: shows the current track as an
# Alfred result, with its artwork as the icon. Actioning it opens the panel.
# Test it on its own:  ./scripts/results.sh | jq

. "$(dirname "$0")/lib.sh"
load_track

# Show a single non-track result: title, subtitle.
message() {
  jq -nc --arg t "$1" --arg s "${2:-}" '{rerun: 3, items: [{title: $t, subtitle: $s, arg: ""}]}'
}

case "$state" in
  missing) message "Adapter not installed" "Run vendor.sh in the .alfredui folder"; exit 0 ;;
  error)   message "Adapter error ($rc)" "$(head -n1 "$CACHE/last-error")"; exit 0 ;;
  idle)    message "Nothing playing" "Open the Now Playing panel"; exit 0 ;;
esac

# The icon is the artwork, else the player's app icon, else the workflow icon.
# rerun refreshes the result while it's showing: every second while playing,
# so the elapsed time ticks.
jq -nc --argjson i "$info" --arg art "$art" --arg app "$app" "$JQ_TIME"'
  ($i.duration // 0) as $dur
  | {
      rerun: (if $i.playing then 1 else 3 end),
      items: [{
        title: $i.title,
        subtitle: ([
          (if $i.playing then empty else "Paused" end),
          $i.artist, $i.album,
          (if $dur > 0 then "\($i | position | clock) / \($dur | clock)" else empty end),
          ($app | split("/") | last // "" | rtrimstr(".app"))
        ] | map(select(. != null and . != "")) | join("  ·  ")),
        arg: "",
        icon: (if $art != "" then {path: $art}
               elif $app != "" then {type: "fileicon", path: $app}
               else null end),
        quicklookurl: (if $art != "" then $art else null end)
      } | with_entries(select(.value != null))]
    }'
