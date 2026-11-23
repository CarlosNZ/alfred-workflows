#!/bin/bash
# Builds the panel's window definition from the workflow's preferences.
#
# Why this script exists: Alfred passes workflow preferences to an Alfred UI
# only as strings, and the window's settings ignore a string where they expect
# a boolean or a number. A placeholder such as "borderless": "{var:...}" or
# "cornerradius": "{var:...}" in ui.json therefore has no effect, and the
# window can't be changed by an update action once it's open.
#
# A {file:...} placeholder, however, inserts a file's contents as JSON with
# their real types. So ui.json's whole `window` is a {file:...} placeholder
# pointing at the file this script writes:
#
#   "window": "{file:~/Library/Caches/com.runningwithcrayons.Alfred/Workflow Data/net.smithnz.carl.nowplaying/window.json}"
#
# This script merges the preferences into the window template (window.json in
# the bundle) and writes the result there. A Run Script object runs it just
# before every route into the Alfred UI object (the hotkey and both keyword
# results), so the panel always opens with the current preferences, and the
# file always exists when Alfred loads ui.json.
#
# The path in ui.json is spelled out because {file:...} doesn't resolve a
# placeholder such as {const:alfred_workflow_cache} inside its path. It must
# match $alfred_workflow_cache, so it changes with the workflow's bundle ID.
#
# Preferences (from the workflow's User Configuration, as environment
# variables):
#   window_buttons  "1" shows the window buttons in a transparent title bar,
#                   "0" makes the window borderless. It's also saved to
#                   $CACHE/window-buttons, as the landscape layout leaves
#                   room for the buttons only when they're there
#                   (landscape_inset in lib.sh), and layout.sh, which
#                   doesn't get the preferences, builds that layout too.
#   corner_radius   0-32, the corner radius of the borderless window (a window
#                   with buttons has the system's standard rounding)
#   transparency    0-100, how much the dark tint over the window's blur lets
#                   through; its alpha is (100 - transparency) / 100
#   default_app     the app shown when nothing is playing. It isn't part of
#                   the window: it's saved to $CACHE/default-app for the
#                   panel's scripts (default_app in lib.sh), which don't get
#                   the workflow's preferences.
#
# It also fills in the layout chosen with the panel's rotate button (saved by
# layout.sh): the template's { "id": "content" } placeholder becomes the
# content view for that layout (content_view in lib.sh), and the window takes
# that layout's size and maximum size (layout_size and layout_maxsize).
# frameautosave restores the last saved frame over that size, but the last
# frame belongs to the last layout used, which is the one being built.
#
# The content's text is the kind the last pulse drew (content_kind in
# lib.sh): the track details, or the "No media playing" view when nothing was
# playing, so a panel reopened while idle doesn't start with the wrong one;
# the pulse swaps it if the state has changed since (with_content in lib.sh).
#
# The { "id": "toprow" } placeholder becomes the top row (app icon and name,
# and the rotate button for the layout) with no app showing; poll.sh's first
# pulse replaces the app part with the playing app's (see with_toprow in
# lib.sh, which explains why). Removing $CACHE/toprow-app here makes sure
# that first pulse does.
#
# Test it on its own:
#   window_buttons=0 corner_radius=24 transparency=30 ./scripts/window.sh
#   jq '. | del(.root)' ~/Library/Caches/net.smithnz.carl.nowplaying/window.json

. "$(dirname "$0")/lib.sh"

# Print $1 if it's a whole number from 0 to $3, else the default $2.
number() {
  case "$1" in
    ''|*[!0-9]*) echo "$2" ;;
    *) [ "$1" -le "$3" ] && echo "$1" || echo "$2" ;;
  esac
}

buttons=$([ "${window_buttons:-1}" = 0 ] && echo false || echo true)
radius=$(number "${corner_radius:-}" 16 32)
transparency=$(number "${transparency:-}" 45 100)
layout=$(current_layout)
rm -f "$CACHE/toprow-app"
printf '%s' "${default_app:-}" > "$CACHE/default-app"
printf '%s' "$buttons" > "$CACHE/window-buttons"
kind=$(content_kind)

# Write to a temporary file and move it into place, so Alfred never reads a
# half-written window definition.
out="$CACHE/window.json"
jq --argjson buttons "$buttons" --argjson radius "$radius" --argjson t "$transparency" \
   --argjson toprow "$(toprow_view "" "$layout")" \
   --argjson content "$(content_view "$layout" "$kind")" --argjson size "$(layout_size "$layout")" \
   --argjson maxsize "$(layout_maxsize "$layout")" '
  (if $buttons then . else . + {borderless: true, cornerradius: $radius} end)
  | .size = $size
  | .maxsize = $maxsize
  | .root.background = "rgb(18, 18, 20, \((100 - $t) / 100))"
  | .root.components |= map(
      if .id == "toprow" then $toprow
      elif .id == "content" then $content
      else . end)
' "$ROOT/window.json" > "$out.tmp" && mv "$out.tmp" "$out"
