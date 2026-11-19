#!/bin/bash
# Switches the open panel between the portrait and landscape layouts. Run by
# the settings menu (the slider button at the top right) with "portrait" or
# "landscape".
#
# It saves the choice, so window.sh builds the panel in that layout next time
# it opens, and prints JSON Actions that change the open panel to match:
#   - `replace` swaps the `content` view (artwork and track details) for the
#     new layout's (content_view in lib.sh), which re-lays out the whole UI
#   - `window` resizes the window to the layout's starting size
#   - poll.sh's `update` fills the new components in straight away; without
#     it they'd show their placeholder content until the next pulse
# Both layouts use the same component ids, so poll.sh and control.sh work
# with either.
#
# Test it on its own:  ./scripts/layout.sh landscape | jq 'del(.replace)'

. "$(dirname "$0")/lib.sh"

case "$1" in
  portrait|landscape) ;;
  *) echo "usage: layout.sh portrait|landscape" >&2; exit 1 ;;
esac

mkdir -p "$DATA"
echo "$1" > "$DATA/layout"

jq -nc --argjson content "$(content_view "$1")" --argjson size "$(layout_size "$1")" \
   --argjson poll "$("$(dirname "$0")/poll.sh")" '
  {replace: {ids: {content: $content}}, window: {resize: $size}} + $poll'
