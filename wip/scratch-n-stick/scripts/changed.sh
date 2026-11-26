#!/bin/zsh -f
# The web view's `changed` event, in a note's window: changed.sh <url> <id> <form>
#
# <url> is the page's URL ({value:web.src}). The page tells the window things
# by changing its fragment (see ui/view.js):
#
#   #ready-<opacity>[-<rrggbb>]-<n>
#                          the note has been drawn: prints an update that shows
#                          the web view at <opacity>, unless the window is in
#                          Edit, and in a quick view the strip along the
#                          window's top (titlestrip) at the same opacity, in
#                          the page's background colour <rrggbb>, so the strip
#                          and the page look like one panel
#   #t-<line>-<x|o>-<n>    a task box was clicked: window.js tick ticks the note
#
# Anything else, such as the page starting to load, is ignored.
#
# A page can finish loading after the window has switched to Edit (the Edit
# button clicked straight after opening a note in View, after a switch to View or after a
# tick), and showing it then would lay it over the editor, so #ready is
# checked against the window's state (see "Window state" in lib.js). With no
# state yet, the window has just opened in View (a window that opens in Edit
# has a page with no note, which sends no #ready).
#
# The event fires on every change of the URL, and Alfred waits for its action
# (in a quick view, inside Alfred's own process), so this is zsh with builtins
# only, and only a tick goes on to window.js: an osascript started on every
# change held the page back by about 80 ms.

setopt extended_glob

# Whether the window's state says it's in Edit. The ID arrives escaped as it
# is in the window (see escapeForAlfredUi in lib.js).
in_edit() {
  local id=${2//(#b)\{$'⁠'(var|const|value|data):/\{$match[1]:} state
  [[ -n $id && $id != .* && $id != */* && -n ${alfred_workflow_cache:-} ]] || return 1
  state=$(<$alfred_workflow_cache/state/$id.json) 2>/dev/null || return 1
  [[ $state == *'"form":"'$3'"'* && $state == *'"mode":"edit"'* ]]
}

fragment=${1#*\#}
[[ $fragment == $1 ]] && exit 0
if [[ $fragment =~ '^ready-(0|1|0?\.[0-9]+|1\.0+)(-([0-9a-f]{6}))?-[0-9]+$' ]]; then
  opacity=${match[1]/#./0.}
  panel=$match[3]
  in_edit "$@" && exit 0
  strip=
  [[ $3 == quick && -n $panel ]] && strip=",\"titlestrip\":{\"background\":\"#$panel\",\"opacity\":$opacity}"
  print -r -- "{\"update\":{\"ids\":{\"web\":{\"opacity\":$opacity}$strip}}}"
elif [[ $fragment =~ '^t-([0-9]+)-([xo])-[0-9]+$' ]]; then
  exec "${0:A:h}/window.js" tick "$2" "$3" "$match[1]" "$match[2]"
fi
