#!/bin/zsh -f
# Gives a city its own Alfred UI package for the detail view, and prints its
# path for the Alfred UI object to open: inside Alfred for ↩, in a window of
# its own for ⌘↩.
#
# $1 is the city's detail_slug, and $detail_city its record (see
# detailVariables in lib/detail.js). Each city's package is in the cache, named
# after it, and holds links to panel.alfredui/ui.json and detail.js (the pulse
# script) and the city's record in city.json. Alfred keeps one window per
# package path, so each city gets its own window, and opening a city that's
# already open brings its window to the front. frameautosave is keyed on the
# path too, so each city's window keeps its own position.

emulate -L zsh
setopt err_exit no_unset

slug=$1
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
print -rn -- $package
