#!/bin/zsh -f
# Gives a city its own Alfred UI package for the detail view, and prints its
# path for the Alfred UI object to open: inside Alfred for ↩, in a window of
# its own for ⌘↩.
#
# The city comes from the result's variables (see detailVariables in
# lib/detail.js): $detail_slug names it and $detail_city is its record. Not
# from $1, which on ↩ is the item's arg, the city's name for copying and
# Universal Actions. If the city has no picture yet, it starts a fetch for it
# alone, from $detail_picture_city, so the view gets it within seconds (see
# fetch-pictures.js). Each city's package is in the cache, named
# after it, and holds links to panel.alfredui/ui.json and detail.js (the pulse
# script) and the city's record in city.json. Alfred keeps one window per
# package path, so each city gets its own window, and opening a city that's
# already open brings its window to the front. frameautosave is keyed on the
# path too, so each city's window keeps its own position.

emulate -L zsh
setopt err_exit no_unset

slug=${detail_slug:-}
[[ $slug =~ '^[A-Za-z0-9_-]+$' ]] || { print -u2 "panel.zsh: bad city slug '$slug'"; exit 1 }

workflow=${0:A:h}
cache=${alfred_workflow_cache:-$HOME/Library/Caches/net.smithnz.carl.worldclockcities}
package=$cache/panels/$slug.alfredui

mkdir -p $package
# Relinked every time, so the links follow the workflow folder if it moves.
ln -sfh $workflow/panel.alfredui/ui.json $package/ui.json
ln -sfh $workflow/detail.js $package/detail.js
# Rewritten every time, so the record follows changes in Clock. Written to a
# temporary file then moved into place, so the pulse never reads half a file.
print -rn -- $detail_city > $package/city.json.tmp
mv -f $package/city.json.tmp $package/city.json

# The cheap checks here, so a view of a city that has its picture (or has
# none to find) doesn't start osascript; fetch-pictures.js checks the rest.
images=$cache/images
if [[ ${download_thumbnails:-1} != 0 && -n ${detail_picture_city:-} && ! -e $images/$slug.jpg && ! -e $images/$slug.none ]]; then
  # In the background and with no output, so Alfred opens the view without
  # waiting for it.
  $workflow/fetch-pictures.zsh --view $detail_picture_city < /dev/null &> /dev/null &!
fi

print -rn -- $package
