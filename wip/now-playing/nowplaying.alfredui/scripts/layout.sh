#!/bin/bash
# Switches the open panel between the portrait and landscape layouts. Run by
# the rotate button at the top right with "toggle"; also takes "portrait" or
# "landscape".
#
# It saves the choice, so window.sh builds the panel in that layout next time
# it opens, and prints JSON Actions that change the open panel to match:
#   - `replace` swaps the `content` view (artwork and track details) for the
#     new layout's (content_view in lib.sh), which re-lays out the whole UI
#   - `window` resizes the window to the layout's starting size
#   - poll.sh's `update` fills the new components in straight away; without
#     it they'd show their placeholder content until the next pulse
#   - an `update` of the rotate button gives it the new layout's icon and
#     tooltip (rotate_button in lib.sh)
# Both layouts use the same component ids, so poll.sh and control.sh work
# with either.
#
# Test it on its own:  ./scripts/layout.sh toggle | jq 'del(.replace)'

. "$(dirname "$0")/lib.sh"

case "$1" in
  portrait|landscape) layout="$1" ;;
  toggle) [ "$(current_layout)" = landscape ] && layout=portrait || layout=landscape ;;
  *) echo "usage: layout.sh toggle|portrait|landscape" >&2; exit 1 ;;
esac

mkdir -p "$DATA"
echo "$layout" > "$DATA/layout"

# Deep merge (*): poll.sh can also `replace` (the top row's app view), and
# the rotate button is added to its `update` ids rather than replacing them.
jq -nc --argjson content "$(content_view "$layout" "$(content_kind)")" --argjson size "$(layout_size "$layout")" \
   --argjson rotate "$(rotate_button "$layout")" --argjson poll "$("$(dirname "$0")/poll.sh")" '
  {replace: {ids: {content: $content}}, window: {resize: $size}}
  * $poll * {update: {ids: {rotate: $rotate}}}'
