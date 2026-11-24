#!/bin/zsh
# Tests scripts/list.js, the results list's Script Filter, by running it as
# Alfred does (with notes_folder and alfred_workflow_cache set and the query as
# its argument) against sample notes in a temporary folder from mktemp,
# deleted afterwards. Run from anywhere: dev/test-list.sh

setopt err_return pipe_fail no_unset
here=${0:A:h}
list=${here:h}/scripts/list.js
tmp=$(mktemp -d "${${TMPDIR:-/tmp}%/}/scratchnotes-test.XXXXXX")
trap '[[ $tmp == */scratchnotes-test.* ]] && rm -rf -- "$tmp"' EXIT
notes=$tmp/notes
cache=$tmp/cache
quick=$cache/quick
mkdir -p "$notes"
failures=0

# A note with its text and how long ago it was edited (a `date -v` offset).
note() { print -rn -- "$2" > "$notes/$1.md"; touch -t "$(date -v"$3" +%Y%m%d%H%M.%S)" "$notes/$1.md" }
note shopping $'# Shopping\n- milk\n- eggs\n' -3H
note cafe $'Café ideas\nFlat white, **long black**\n' -10M
note old $'Old note\nfrom long ago\n' -400d
note recent $'Just written' -10S

# The list's items for a query, one line per item: title | subtitle | arg |
# the `new` variable, then for each of ⌘, ⌥ and ⌃ its arg, or "-" when the
# key does nothing (valid: false), and ⌘'s `new` variable.
items() {
  (cd "$tmp" && notes_folder=$1 alfred_workflow_cache=$cache "$list" "${@:2}") | osascript -l JavaScript -e '
    ObjC.import("Foundation");
    function run() {
      const input = $.NSString.alloc.initWithDataEncoding($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile, $.NSUTF8StringEncoding).js;
      return JSON.parse(input).items.map((i) =>
        [i.title, i.subtitle, i.arg, (i.variables || {}).new || ""]
          .concat(i.mods ? ["cmd", "alt", "ctrl"].map((m) => (i.mods[m].valid === false ? "-" : i.mods[m].arg)) : [])
          .concat(i.mods ? [(i.mods.cmd.variables || {}).new || ""] : [])
          .join(" | ")).join("\n");
    }'
}

expect() {
  local label=$1 actual=$2 expected=$3
  # The expected text is a pattern (* matches anything), with | taken literally.
  if [[ $actual == ${~${expected//|/\\|}} ]]; then print -r -- "ok    $label"; else print -r -- "FAIL  $label"$'\n'"      got:      ${actual//$'\n'/$'\n'                }"$'\n'"      expected: $expected"; (( failures++ )) || true; fi
}

# As expect, but the expected text is taken literally, with no patterns.
expect_exact() {
  local label=$1 actual=$2 expected=$3
  if [[ $actual == "$expected" ]]; then print -r -- "ok    $label"; else print -r -- "FAIL  $label"$'\n'"      got:      ${actual//$'\n'/$'\n'                }"$'\n'"      expected: $expected"; (( failures++ )) || true; fi
}

all=$(items "$notes")
expect "no query: New note first, then notes last edited first" "$(print -r -- $all | cut -d'|' -f1 | sed 's/ $//')" $'New note\nJust written\nCafé ideas\nShopping\nOld note'
expect "New note: arg a quick bundle, ⌘ arg empty with new=1, ⌥ and ⌃ do nothing" "$(print -r -- $all | head -1)" "New note | Create a blank note | $quick/20*.alfredui |  |  | - | - | 1"
expect "subtitle: just now, no preview" "$(print -r -- $all | sed -n 2p | cut -d'|' -f2)" " Edited just now "
expect "subtitle: minutes and preview" "$(print -r -- $all | sed -n 3p | cut -d'|' -f2)" " Edited 10m ago · Flat white, long black "
expect "subtitle: hours, list items joined" "$(print -r -- $all | sed -n 4p | cut -d'|' -f2)" " Edited 3h ago · milk, eggs "
expect "subtitle: a date, with the year" "$(print -r -- $all | sed -n 5p | cut -d'|' -f2)" " Edited *20[0-9][0-9] · from long ago "
expect "arg is the quick bundle, no new; ⌘ and ⌥ args the ID, ⌃ arg the path" "$(print -r -- $all | sed -n 4p | cut -d'|' -f3-)" " $quick/shopping.alfredui |  | shopping | shopping | $notes/shopping.md | "

expect "query matches text, not just the title" "$(items "$notes" milk | cut -d'|' -f1)" "Shopping "
expect "query ignores case and accents" "$(items "$notes" CAFE | cut -d'|' -f1)" "Café ideas "
expect "every word must match" "$(items "$notes" "milk eggs" | cut -d'|' -f1)" "Shopping "
expect "words can match in any order and place" "$(items "$notes" "black flat" | cut -d'|' -f1)" "Café ideas "
expect "no uid on any result, so Alfred keeps the order" "$(notes_folder=$notes alfred_workflow_cache=$cache $list "" | grep -c '"uid"' || true)" "0"
expect "no match: New note with the query" "$(items "$notes" "buy  bread ")" "New note: buy  bread | Create a note with this text | $quick/20*.alfredui |  | buy  bread | - | - | 1"
expect "notes without sidecars were given one" "$(ls -A "$notes/.scratchnotes" | sort | tr '\n' ' ')" "cafe.json old.json recent.json shopping.json "
# Quick bundles.
# The quick bundle's ui.json of a note, and its modification time.
ui() { print -r -- "$quick/$1.alfredui/ui.json" }
mtime() { stat -f %Fm "$(ui $1)" }
# The note's text in its quick bundle's page (note.js).
text_of() {
  osascript -l JavaScript -e 'ObjC.import("Foundation"); function run(argv) { const page = {}; new Function("window", $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js)(page); return page.NOTE; }' "$quick/$1.alfredui/note.js"
}
items "$notes" >/dev/null
expect "every note has a quick bundle with its text" "$(ls $quick | grep -v '^20' | tr '\n' ' ')$(text_of cafe)" "cafe.alfredui old.alfredui recent.alfredui shopping.alfredui "$'Café ideas\nFlat white, **long black**'
expect "the fingerprints are in the index" "$(osascript -l JavaScript -e 'ObjC.import("Foundation"); function run(argv) { return Object.keys(JSON.parse($.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js)).sort().join(" "); }' $quick/.index.json)" "cafe old recent shopping"
before_cafe=$(mtime cafe) before_old=$(mtime old)
items "$notes" >/dev/null
expect "unchanged notes' bundles aren't rewritten" "$(mtime cafe) $(mtime old)" "$before_cafe $before_old"
print -rn -- $'Café ideas\nCortado\n' > "$notes/cafe.md"
items "$notes" >/dev/null
expect "an edited note's bundle is rewritten, and only that one" "$([[ $(mtime cafe) != $before_cafe ]] && print rewritten) $(mtime old)" "rewritten $before_old"
expect "the rewritten bundle has the new text" "$(text_of cafe)" $'Café ideas\nCortado'
before_cafe=$(mtime cafe)
print -r -- '{"mode":"edit"}' > "$notes/.scratchnotes/old.json"
items "$notes" >/dev/null
expect "a changed sidecar rewrites its note's bundle" "$([[ $(mtime old) != $before_old ]] && print rewritten) $(mtime cafe)" "rewritten $before_cafe"
before_old=$(mtime old)
(cd "$tmp" && font_size=16 notes_folder=$notes alfred_workflow_cache=$cache "$list" "") >/dev/null
expect "a changed setting rewrites every bundle" "$([[ $(mtime cafe) != $before_cafe ]] && print rewritten) $([[ $(mtime old) != $before_old ]] && print rewritten)" "rewritten rewritten"
items "$notes" milk >/dev/null
expect "with a query, only matching notes' bundles are rebuilt" "$(grep -c '"size": 16' $(ui cafe)) $(grep -c '"size": 16' $(ui shopping) || true)" "1 0"
mkdir -p "$quick/20200101-000000.alfredui" "$quick/gone.alfredui" "$quick/open.alfredui" "$cache/state"
print -r -- '{"form":"quick","pid":1,"mode":"edit"}' > "$cache/state/open.json"
mv "$notes/recent.md" "$tmp/"
items "$notes" >/dev/null
expect "gone notes' and old new notes' bundles are removed, open ones kept" "$(ls $quick | grep -v '^20' | tr '\n' ' ')$(ls $quick | grep -c '^2020' || true)" "cafe.alfredui old.alfredui open.alfredui shopping.alfredui 0"
expect "the index drops gone notes" "$(grep -c recent $quick/.index.json || true)" "0"
new1=$(items "$notes" | head -1 | cut -d'|' -f3 | xargs basename)
expect "a New note bundle has a new ID and opens in Edit" "$new1 $(grep -c '"textarea"' $quick/$new1/ui.json)" "20[0-9][0-9][01][0-9][0-3][0-9]-[0-2][0-9][0-5][0-9][0-5][0-9].alfredui 1"

# Colours: each note's icon, and its quick bundle.
# Each item's title and icon ("-" for none), one per line, with the workflow's
# variables given before the query as NAME=value.
icons() {
  local -a vars=()
  while [[ ${1:-} == *=* ]]; do vars+=$1; shift; done
  (cd "$tmp" && env notes_folder=$notes alfred_workflow_cache=$cache "${vars[@]}" "$list" "$@") | osascript -l JavaScript -e '
    ObjC.import("Foundation");
    function run() {
      const input = $.NSString.alloc.initWithDataEncoding($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile, $.NSUTF8StringEncoding).js;
      return JSON.parse(input).items.map((i) => `${i.title} ${i.icon ? i.icon.path : "-"}`).join("\n");
    }'
}
expect "the workflow has an icon for each palette colour" "$(ls ${here:h}/icons | tr '\n' ' ')" "blue.png green.png grey.png pink.png purple.png yellow.png "
expect "a note's icon is its colour's dot, yellow by default; New note has none" "$(icons '')" $'New note -\nCafé ideas icons/yellow.png\nShopping icons/yellow.png\nOld note icons/yellow.png'
expect "default_colour sets the icon of notes without a colour" "$(icons default_colour=purple milk)" "Shopping icons/purple.png"
print -r -- '{"colour":"pink"}' > "$notes/.scratchnotes/shopping.json"
before_shopping=$(mtime shopping)
expect "a note's own colour sets its icon" "$(icons default_colour=purple milk)" "Shopping icons/pink.png"
expect "a colour change rewrites the note's quick bundle with the new dot" "$([[ $(mtime shopping) != $before_shopping ]] && print rewritten) $(grep -c '#F87F7F' $(ui shopping))" "rewritten 1"
print -r -- '{"colour":"orange"}' > "$notes/.scratchnotes/shopping.json"
expect "an unknown colour gets the default's icon" "$(icons milk)" "Shopping icons/yellow.png"

# A pinned note's result (no arg, `pinned` set) needs a live Alfred UI helper,
# so it's checked in Alfred; a pinned state whose process isn't one is ignored.
print -r -- '{"form":"pinned","pid":'$$',"mode":"edit"}' > "$cache/state/shopping.json"
expect "a pinned state whose process isn't Alfred UI: a normal result" "$(items "$notes" milk | cut -d'|' -f2-3)" " Edited 3h ago · milk, eggs | $quick/shopping.alfredui "
rm "$cache/state/shopping.json"

# The theme stylesheet for quick views' pages, from Alfred's theme background.
# The stylesheet list.js writes with alfred_theme_background set to $1 (unset
# if it's empty).
theme() {
  (cd "$tmp" && env notes_folder=$notes alfred_workflow_cache=$cache ${1:+alfred_theme_background=$1} "$list" "") >/dev/null
  cat "$cache/theme.css"
}
expect_exact "theme: a solid theme's colour, at full opacity, with the system's text" "$(theme 'rgba(255,255,255,1.00)')" $':root { --panel: rgb(255, 255, 255); --opacity: 1; }\n@media (prefers-color-scheme: light) { :root { --panel: rgb(255, 255, 255); } }'
expect_exact "theme: a translucent theme over the base, at the lowest opacity, with stronger text" "$(theme 'rgba(40,161,250,0.05)')" $':root { --panel: rgb(31, 37, 41); --opacity: 0.8; }\n@media (prefers-color-scheme: light) { :root { --panel: rgb(244, 250, 255); } }\n@media (prefers-color-scheme: dark) { :root { --text: rgba(255, 255, 255, 1.00); --text-done: rgba(255, 255, 255, 0.60); --link: #4DA3FF; } }\n@media (prefers-color-scheme: light) { :root { --text: rgba(0, 0, 0, 1.00); --text-done: rgba(0, 0, 0, 0.60); --link: #0058D0; } }'
expect_exact "theme: above the lowest opacity, the theme's alpha" "$(theme 'rgba(20, 20, 20, 0.9)' | head -1) $(theme 'rgba(20, 20, 20, 0.9)' | sed -n 3p | grep -o -- '--text: [^;]*')" ':root { --panel: rgb(21, 21, 21); --opacity: 0.9; } --text: rgba(255, 255, 255, 0.94)'
before_theme=$(stat -f %Fm "$cache/theme.css")
theme 'rgba(20, 20, 20, 0.9)' >/dev/null
expect "theme: an unchanged stylesheet isn't rewritten" "$(stat -f %Fm "$cache/theme.css")" "$before_theme"
expect "theme: without a theme colour, the page's own colours" "$(theme '')" "/\* No theme colour*"

expect "unusable notes folder: an error result" "$(items "$tmp/missing/notes" | cut -d'|' -f1-2)" "Can't open the notes folder | Can't create *"

print
if (( failures )); then print "FAILED: $failures"; exit 1; else print "All passed"; fi
