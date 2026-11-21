#!/bin/zsh -f
# Gives a city its own Alfred UI package for the detail view, and prints its
# path for the Alfred UI object to open: inside Alfred for ↩, in a window of
# its own for ⌘↩.
#
# The city comes from the result's variables (see detailVariables in
# lib/detail.js): $detail_slug names it, $detail_city is its record,
# $detail_mode is "now" or "meeting" and $detail_clock_change says whether the
# view has a line for a clock change. $detail_launch is "window" for ⌘↩, set
# by the ⌘ modifier, and unset for ↩. Not from $1, which on ↩ is the item's
# arg, the city's name for copying and Universal Actions. If the city has no
# picture yet, it starts a fetch for it alone, from $detail_picture_city, so
# the view gets it within seconds (see fetch-pictures.js).
#
# Each city has a package per mode and launch in the cache, named after them
# (e.g. panels/20-now-window.alfredui). It holds a link to detail.js (the
# pulse script), the city's record in city.json, and a link to the view's
# layout: the variant of lib/panel.js's layout for the mode, the launch, and
# whether there's a picture slot and a clock change line, built into
# panels/layouts/ the first time it's needed and again whenever lib/panel.js
# changes. Alfred keeps one window per package path, so each city gets its
# own window per mode, and opening one that's already open brings its window
# to the front, keeping the layout it opened with; so an open window's layout
# link is left alone, since its pulse sizes the window from it (windowResize
# in detail.js). frameautosave is keyed on the path too, so each window keeps
# its own position.

emulate -L zsh
setopt err_exit no_unset
zmodload -F zsh/stat b:zstat
zmodload -F zsh/datetime p:EPOCHSECONDS

slug=${detail_slug:-}
[[ $slug =~ '^[A-Za-z0-9_-]+$' ]] || { print -u2 "panel.zsh: bad city slug '$slug'"; exit 1 }
mode=${detail_mode:-now}
[[ $mode == (now|meeting) ]] || mode=now
launch=${detail_launch:-inline}
[[ $launch == (inline|window) ]] || launch=inline
clock_change=${detail_clock_change:-0}
[[ $clock_change == 1 ]] || clock_change=0

workflow=${0:A:h}
cache=${alfred_workflow_cache:-$HOME/Library/Caches/net.smithnz.carl.worldclockcities}
package=$cache/panels/$slug-$mode-$launch.alfredui
images=$cache/images

# Whether the view has a picture slot, as pictureState in lib/pictures.js
# decides it: yes if the picture is there, or might arrive soon (the slot
# shows "Loading…" meanwhile); no if the setting is off, there's no picture to
# find, or a fetch is waiting out a failure.
waiting() {
  local file
  for file; do
    [[ -e $file ]] && (( $(zstat +mtime -- $file) > EPOCHSECONDS )) && return 0
  done
  return 1
}
picture=1
if [[ ${download_thumbnails:-1} == 0 || -e $images/$slug.none ]]; then
  picture=0
elif [[ ! -e $images/$slug.jpg ]] && waiting $images/.backoff $images/$slug.failed; then
  picture=0
fi

# The layout, built by detail.js (which runs lib/panel.js) when it's missing
# or older than lib/panel.js, so editing the layout's constants takes effect
# the next time a view opens. Written to a temporary file then moved into
# place, so Alfred never reads half a file.
layout=$cache/panels/layouts/$mode-$launch-$picture-$clock_change.json
if [[ ! -e $layout || $layout -ot $workflow/lib/panel.js ]]; then
  mkdir -p ${layout:h}
  $workflow/detail.js ui $mode $launch $picture $clock_change > $layout.tmp.$$
  mv -f $layout.tmp.$$ $layout
fi

mkdir -p $package
# Relinked every time, so the links follow the workflow folder if it moves,
# and the view opens with the layout for the city as it is now. Except for a
# window that's open: its Alfred UI process (or its pulse) has the package's
# path in its arguments.
if [[ $launch != window ]] || ! pgrep -qf -- $package; then
  ln -sfh $layout $package/ui.json
fi
ln -sfh $workflow/detail.js $package/detail.js
# Rewritten every time, so the record follows changes in Clock and the typed
# time. Written to a temporary file then moved into place, so the pulse never
# reads half a file.
print -rn -- $detail_city > $package/city.json.tmp
mv -f $package/city.json.tmp $package/city.json

# The cheap checks here, so a view of a city that has its picture (or has
# none to find) doesn't start osascript; fetch-pictures.js checks the rest.
if [[ ${download_thumbnails:-1} != 0 && -n ${detail_picture_city:-} && ! -e $images/$slug.jpg && ! -e $images/$slug.none ]]; then
  # In the background and with no output, so Alfred opens the view without
  # waiting for it.
  $workflow/fetch-pictures.zsh --view $detail_picture_city < /dev/null &> /dev/null &!
fi

print -rn -- $package
