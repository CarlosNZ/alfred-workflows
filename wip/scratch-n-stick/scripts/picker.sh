#!/bin/zsh -f
# Opens and closes a note window's drop-downs, the icon picker and the colour
# picker: picker.sh <command> <id> <form> [<picker>]
#
#   toggle <picker>   the icon button or ⌘I ("icon"), or the colour button
#                     ("colour"): opens that picker, closing the other, or
#                     closes it if it's open
#   close             a click anywhere else in the window (the catcher view):
#                     closes the open picker
#   escape            Esc in a sticky window: closes the open picker, and
#                     otherwise the window
#
# Each picker is a box of buttons that drops down under the top row's left
# group, over the note, hidden until it's opened (see noteDropdown in lib.js).
# While one is open, the catcher (pickercatcher) covers the rest of the window,
# under the pickers and the top row, so a click anywhere else closes it.
# Choosing an icon or colour closes it too (window.js), and so does the
# Edit / View switch.
#
# The open picker's name is in <cache>/state/<id>.picker, beside the window's
# state (see "Window state" in lib.js). A window without a state of its form
# is left alone, though Esc still closes it.
#
# Alfred waits for a window's actions (in a quick view, inside its own
# process), so this is zsh with builtins only, as changed.sh is.

setopt extended_glob

# The ID arrives escaped as it is in the window (see escapeForAlfredUi in
# lib.js).
id=${2//(#b)\{$'⁠'(var|const|value|data):/\{$match[1]:}
form=$3
finish() { [[ $1 == escape ]] && print -r -- '{"finish":{}}'; exit 0 }

[[ $1 == toggle && $4 != (icon|colour) ]] && exit 1
[[ -n $id && $id != .* && $id != */* && -n ${alfred_workflow_cache:-} ]] || finish "$1"
state_path=$alfred_workflow_cache/state/$id
state=$(<$state_path.json) 2>/dev/null || finish "$1"
[[ $state == *'"form":"'$form'"'* ]] || finish "$1"

open=
[[ -e $state_path.picker ]] && open=$(<$state_path.picker)

if [[ $1 == toggle && $open != $4 ]]; then
  print -rn -- $4 > $state_path.picker
  if [[ $4 == icon ]]; then
    print -r -- '{"update":{"ids":{"iconpicker":{"hidden":false},"colourpicker":{"hidden":true},"pickercatcher":{"hidden":false}}}}'
  else
    print -r -- '{"update":{"ids":{"iconpicker":{"hidden":true},"colourpicker":{"hidden":false},"pickercatcher":{"hidden":false}}}}'
  fi
elif [[ -e $state_path.picker ]]; then
  rm -f -- $state_path.picker
  print -r -- '{"update":{"ids":{"iconpicker":{"hidden":true},"colourpicker":{"hidden":true},"pickercatcher":{"hidden":true}}}}'
else
  finish "$1"
fi
