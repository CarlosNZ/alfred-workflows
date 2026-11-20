#!/bin/bash
# Script Filter for the keywords (`nowplaying` and `np` by default): shows
# the current track as an Alfred result, with its artwork as the icon.
# Actioning it opens the panel.
# Test it on its own:  ./scripts/results.sh | jq

. "$(dirname "$0")/lib.sh"
load_track

# Every result has the same uid, whatever it shows. On a rerun Alfred keeps
# the selection on the item with the selected item's uid, so selecting this
# result among other matches for the keyword survives the refresh, a track
# change, and a switch between a track and a status message.
UID_RESULT="nowplaying"

# Show a single non-track result: title, subtitle.
message() {
  jq -nc --arg t "$1" --arg s "${2:-}" --arg uid "$UID_RESULT" \
    '{rerun: 3, items: [{uid: $uid, title: $t, subtitle: $s, arg: ""}]}'
}

case "$state" in
  missing) message "Adapter not installed" "Run vendor.sh in the .alfredui folder"; exit 0 ;;
  error)   message "Adapter error ($rc)" "$(head -n1 "$CACHE/last-error")"; exit 0 ;;
  idle)    message "Nothing playing" "Open the Now Playing panel"; exit 0 ;;
esac

# The icon is the artwork, else the player's app icon, else the workflow icon.
# rerun refreshes the result while it's showing: every second while playing,
# so the elapsed time ticks. The ↩ hint goes last, so it's what Alfred
# truncates when long track details fill the line.
jq -nc --argjson i "$info" --arg art "$art" --arg app "$app" --arg uid "$UID_RESULT" "$JQ_TIME"'
  ($i.duration // 0) as $dur
  | {
      rerun: (if $i.playing then 1 else 3 end),
      items: [{
        uid: $uid,
        title: ([$i.title, $i.artist] | map(select(. != null and . != "")) | join(" — ")),
        subtitle: (([
          (if $i.playing then empty else "Paused" end),
          $i.album,
          (if $dur > 0 then "\($i | position | clock) / \($dur | clock)" else empty end),
          ($app | split("/") | last // "" | rtrimstr(".app"))
        ] | map(select(. != null and . != "")) | join("  ·  ")) + "  (↩ to open mini player)"),
        arg: "",
        icon: (if $art != "" then {path: $art}
               elif $app != "" then {type: "fileicon", path: $app}
               else null end),
        quicklookurl: (if $art != "" then $art else null end)
      } | with_entries(select(.value != null))]
    }'
