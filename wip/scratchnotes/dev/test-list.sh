#!/bin/zsh
# Tests scripts/list.js, the results list's Script Filter, by running it as
# Alfred does (with notes_folder set and the query as its argument) against
# sample notes in a temporary folder from mktemp, deleted afterwards. Run from
# anywhere: dev/test-list.sh

setopt err_return pipe_fail no_unset
here=${0:A:h}
list=${here:h}/scripts/list.js
tmp=$(mktemp -d "${${TMPDIR:-/tmp}%/}/scratchnotes-test.XXXXXX")
trap '[[ $tmp == */scratchnotes-test.* ]] && rm -rf -- "$tmp"' EXIT
notes=$tmp/notes
mkdir -p "$notes"
failures=0

# A note with its text and how long ago it was edited (a `date -v` offset).
note() { print -rn -- "$2" > "$notes/$1.md"; touch -t "$(date -v"$3" +%Y%m%d%H%M.%S)" "$notes/$1.md" }
note shopping $'# Shopping\n- milk\n- eggs\n' -3H
note cafe $'Café ideas\nFlat white, **long black**\n' -10M
note old $'Old note\nfrom long ago\n' -400d
note recent $'Just written' -10S

# The list's items for a query, one line per item: title | subtitle | arg,
# then the ⌥ and ⌃ args when there are mods.
items() {
  (cd "$tmp" && notes_folder=$1 "$list" "${@:2}") | osascript -l JavaScript -e '
    ObjC.import("Foundation");
    function run() {
      const input = $.NSString.alloc.initWithDataEncoding($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile, $.NSUTF8StringEncoding).js;
      return JSON.parse(input).items.map((i) =>
        [i.title, i.subtitle, i.arg].concat(i.mods ? [i.mods.alt.arg, i.mods.ctrl.arg] : []).join(" | ")).join("\n");
    }'
}

expect() {
  local label=$1 actual=$2 expected=$3
  # The expected text is a pattern (* matches anything), with | taken literally.
  if [[ $actual == ${~${expected//|/\\|}} ]]; then print -r -- "ok    $label"; else print -r -- "FAIL  $label"$'\n'"      got:      ${actual//$'\n'/$'\n'                }"$'\n'"      expected: $expected"; (( failures++ )) || true; fi
}

all=$(items "$notes")
expect "no query: New note first, then notes last edited first" "$(print -r -- $all | cut -d'|' -f1 | sed 's/ $//')" $'New note\nJust written\nCafé ideas\nShopping\nOld note'
expect "New note's arg is empty" "$(print -r -- $all | head -1)" "New note | Create a blank note | "
expect "subtitle: just now, no preview" "$(print -r -- $all | sed -n 2p | cut -d'|' -f2)" " Edited just now "
expect "subtitle: minutes and preview" "$(print -r -- $all | sed -n 3p | cut -d'|' -f2)" " Edited 10m ago · Flat white, long black "
expect "subtitle: hours, list items joined" "$(print -r -- $all | sed -n 4p | cut -d'|' -f2)" " Edited 3h ago · milk, eggs "
expect "subtitle: a date, with the year" "$(print -r -- $all | sed -n 5p | cut -d'|' -f2)" " Edited *20[0-9][0-9] · from long ago "
expect "arg is the ID, ⌥ arg the ID, ⌃ arg the path" "$(print -r -- $all | sed -n 4p | cut -d'|' -f3-)" " shopping | shopping | $notes/shopping.md"

expect "query matches text, not just the title" "$(items "$notes" milk | cut -d'|' -f1)" "Shopping "
expect "query ignores case and accents" "$(items "$notes" CAFE | cut -d'|' -f1)" "Café ideas "
expect "every word must match" "$(items "$notes" "milk eggs" | cut -d'|' -f1)" "Shopping "
expect "words can match in any order and place" "$(items "$notes" "black flat" | cut -d'|' -f1)" "Café ideas "
expect "no match: New note with the query" "$(items "$notes" "buy  bread ")" "New note: buy  bread | Create a note with this text | buy  bread"
expect "notes without sidecars were given one" "$(ls -A "$notes/.scratchnotes" | sort | tr '\n' ' ')" "cafe.json old.json recent.json shopping.json "
expect "unusable notes folder: an error result" "$(items "$tmp/missing/notes" | cut -d'|' -f1-2)" "Can't open the notes folder | Can't create *"

print
if (( failures )); then print "FAILED: $failures"; exit 1; else print "All passed"; fi
