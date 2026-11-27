#!/bin/zsh
# Tests scripts/list.js, the results list's Script Filter, and scripts/new.js,
# the new-note keyword's, by running them as Alfred does (with notes_folder,
# alfred_workflow_data and alfred_workflow_cache set, and the query as their
# argument) against sample notes in a temporary folder from mktemp, deleted
# afterwards. new.js reads a named pasteboard of its own instead of the
# clipboard, released afterwards.
# Run from anywhere: dev/test-list.sh

setopt err_return pipe_fail no_unset
here=${0:A:h}
list=${here:h}/scripts/list.js
new=${here:h}/scripts/new.js
script=$list
tmp=$(mktemp -d "${${TMPDIR:-/tmp}%/}/scratchnstick-test.XXXXXX")
pasteboard=scratchnstick-test-$$
trap '[[ $tmp == */scratchnstick-test.* ]] && rm -rf -- "$tmp"; osascript -l JavaScript -e "ObjC.import(\"AppKit\"); \$.NSPasteboard.pasteboardWithName(\"$pasteboard\").releaseGlobally" >/dev/null' EXIT
notes=$tmp/notes
cache=$tmp/cache
quick=$cache/quick
mkdir -p "$notes" "$notes.data"
# The example notes count as added, so only the notes below are listed.
print -r -- '{ "examplesInstalled": "2026-01-01T00:00:00+13:00" }' > "$notes.data/state.json"
failures=0

# A note with its text and how long ago it was edited (a `date -v` offset).
note() { print -rn -- "$2" > "$notes/$1.md"; touch -t "$(date -v"$3" +%Y%m%d%H%M.%S)" "$notes/$1.md" }
note shopping $'# Shopping\n- milk\n- eggs\n' -3H
note cafe $'Café ideas\nFlat white, **long black**\n' -10M
note old $'Old note\nfrom long ago\n' -400d
note recent $'Just written' -10S

# The list's items for a query, one line per item: title | subtitle | arg |
# the `new` variable, then for each of ⌘, ⌥ and ⌃ its arg, or "-" when the
# key does nothing (valid: false), and ⌘'s `new` variable. An arg is followed
# by "@" and the variable `stick_note`, the note the stick route takes, if
# it's set. Runs $script: list.js, or new.js in new_items.
items() {
  (cd "$tmp" && notes_folder=$1 alfred_workflow_data=$1.data alfred_workflow_cache=$cache scratchnstick_pasteboard=$pasteboard "$script" "${@:2}") | osascript -l JavaScript -e '
    ObjC.import("Foundation");
    function run() {
      const input = $.NSString.alloc.initWithDataEncoding($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile, $.NSUTF8StringEncoding).js;
      const arg = (r) => {
        const v = r.variables || {};
        const routed = v.stick_note;
        return (r.arg === undefined ? "" : r.arg) + (routed ? `@${routed}` : "");
      };
      return JSON.parse(input).items.map((i) =>
        [i.title, i.subtitle, arg(i), (i.variables || {}).new || ""]
          .concat(i.mods ? ["cmd", "alt", "ctrl"].map((m) => (i.mods[m].valid === false ? "-" : arg(i.mods[m]))) : [])
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
expect "subtitle: minutes and preview" "$(print -r -- $all | sed -n 3p | cut -d'|' -f2)" " Edited 10m ago • Flat white, long black "
expect "subtitle: hours, list items joined" "$(print -r -- $all | sed -n 4p | cut -d'|' -f2)" " Edited 3h ago • milk, eggs "
expect "subtitle: a date, with the year" "$(print -r -- $all | sed -n 5p | cut -d'|' -f2)" " Edited *20[0-9][0-9] • from long ago "
expect "arg is the quick bundle, no new; ⌘ and ⌥ args the ID, ⌃ arg the path" "$(print -r -- $all | sed -n 4p | cut -d'|' -f3-)" " $quick/shopping.alfredui |  | shopping | shopping | $notes/shopping.md | "

expect "query matches text, not just the title" "$(items "$notes" milk | cut -d'|' -f1)" "Shopping "
expect "query ignores case and accents" "$(items "$notes" CAFE | cut -d'|' -f1)" "Café ideas "
expect "every word must match" "$(items "$notes" "milk eggs" | cut -d'|' -f1)" "Shopping "
expect "words can match in any order and place" "$(items "$notes" "black flat" | cut -d'|' -f1)" "Café ideas "
expect "no uid on any result, so Alfred keeps the order" "$(notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache $list "" | grep -c '"uid"' || true)" "0"
expect "no match: New note with the query, as a heading" "$(items "$notes" "buy  bread ")" "New note: buy  bread | Create a note with this heading | $quick/20*.alfredui |  | buy  bread | - | - | 1"
expect "show_new_note off: no New note with no query" "$(show_new_note=0 items "$notes" | cut -d'|' -f1 | sed 's/ $//')" $'Just written\nCafé ideas\nShopping\nOld note'
expect "show_new_note off: a query that matches nothing still offers New note" "$(show_new_note=0 items "$notes" "buy bread" | cut -d'|' -f1)" "New note: buy bread "
expect "show_new_note on (1): New note first" "$(show_new_note=1 items "$notes" | head -1 | cut -d'|' -f1)" "New note "
expect "notes without sidecars were given one" "$(ls -A "$notes/.scratchnstick" | sort | tr '\n' ' ')" "cafe.json old.json recent.json shopping.json "
# Quick bundles.
# The quick bundle's ui.json of a note, and its modification time.
ui() { print -r -- "$quick/$1.alfredui/ui.json" }
mtime() { stat -f %Fm "$(ui $1)" }
# The font size of the editor in a note's quick bundle.
editor_size() {
  osascript -l JavaScript -e '
    ObjC.import("Foundation");
    function run(argv) {
      const d = JSON.parse($.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js);
      return String((function find(c) { if (c.id === "editor") return c; for (const x of c.components || []) { const f = find(x); if (f) return f; } })(d.window.root).font.size);
    }' "$(ui $1)"
}
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
print -r -- '{"mode":"edit"}' > "$notes/.scratchnstick/old.json"
items "$notes" >/dev/null
expect "a changed sidecar rewrites its note's bundle" "$([[ $(mtime old) != $before_old ]] && print rewritten) $(mtime cafe)" "rewritten $before_cafe"
before_old=$(mtime old)
print -r -- '{"mode":"edit","fontSize":24}' > "$notes/.scratchnstick/old.json"
items "$notes" >/dev/null
expect "a note's own font size rewrites its bundle, at that size" "$([[ $(mtime old) != $before_old ]] && print rewritten) $(editor_size old)" "rewritten 24"
before_old=$(mtime old)
(cd "$tmp" && font_size=16 notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache "$list" "") >/dev/null
expect "a changed setting rewrites every bundle" "$([[ $(mtime cafe) != $before_cafe ]] && print rewritten) $([[ $(mtime old) != $before_old ]] && print rewritten)" "rewritten rewritten"
items "$notes" milk >/dev/null
expect "with a query, only matching notes' bundles are rebuilt" "$(editor_size cafe) $(editor_size shopping)" "16 14"
mkdir -p "$quick/20200101-000000.alfredui" "$quick/gone.alfredui" "$quick/open.alfredui" "$cache/state"
print -r -- '{"form":"quick","pid":1,"mode":"edit"}' > "$cache/state/open.json"
mv "$notes/recent.md" "$tmp/"
items "$notes" >/dev/null
expect "gone notes' and old new notes' bundles are removed, open ones kept" "$(ls $quick | grep -v '^20' | tr '\n' ' ')$(ls $quick | grep -c '^2020' || true)" "cafe.alfredui old.alfredui open.alfredui shopping.alfredui 0"
expect "the index drops gone notes" "$(grep -c recent $quick/.index.json || true)" "0"
new1=$(items "$notes" | head -1 | cut -d'|' -f3 | xargs basename)
expect "a New note bundle has a new ID and opens in Edit" "$new1 $(grep -c '"textarea"' $quick/$new1/ui.json)" "20[0-9][0-9][01][0-9][0-3][0-9]-[0-2][0-9][0-5][0-9][0-5][0-9].alfredui 1"

# Result icons: each note's badge or dot, made in the cache, and its quick
# bundle. Each item's title and icon ("-" for none), one per line, with the
# workflow's variables given before the query as NAME=value. A result icon in
# the cache is given by its name, with " MISSING" if the file isn't there.
icons() {
  local -a vars=()
  while [[ ${1:-} == *=* ]]; do vars+=$1; shift; done
  (cd "$tmp" && env notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache "${vars[@]}" "$list" "$@") | osascript -l JavaScript -e '
    ObjC.import("Foundation");
    function run(argv) {
      const input = $.NSString.alloc.initWithDataEncoding($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile, $.NSUTF8StringEncoding).js;
      const name = (path) => (path.startsWith(argv[0] + "/") ? path.slice(argv[0].length + 1) : path) + ($.NSFileManager.defaultManager.fileExistsAtPath(path) ? "" : " MISSING");
      return JSON.parse(input).items.map((i) => `${i.title} ${i.icon ? name(i.icon.path) : "-"}`).join("\n");
    }' "$cache/icons"
}
expect "the workflow ships no badges or dots: Lucide's button icons, the drop-downs' shadows and New note's icons" "$(ls ${here:h}/icons | tr '\n' ' ')" "lucide note.png shadow-colour-picker.png shadow-icon-picker.png slate.png "
expect "a note's result icon is its colour's dot (its tint, ringed in its control colour), made in the cache, yellow (slot 1) by default; New note's is the slate" "$(icons '')" $'New note icons/slate.png\nCafé ideas dot-FEF49C-DBC503-*.png\nShopping dot-FEF49C-DBC503-*.png\nOld note dot-FEF49C-DBC503-*.png'
expect "a dot is a 256-pixel PNG" "$(sips -g format -g pixelWidth -g pixelHeight $cache/icons/dot-FEF49C-DBC503-*.png | awk '/format|pixel/ {printf "%s ", $2}')" "png 256 256 "
expect "default_colour sets the icon of notes without a colour" "$(icons default_colour=5 milk)" "Shopping dot-B6CAFF-7D9BEB-*.png"
print -r -- '{"colour":4}' > "$notes/.scratchnstick/shopping.json"
before_shopping=$(mtime shopping)
expect "a note's own colour sets its icon" "$(icons default_colour=5 milk)" "Shopping dot-FFC7C7-F87F7F-*.png"
expect "a colour change rewrites the note's quick bundle with the new swatch (the colour button's, and the picker's)" "$([[ $(mtime shopping) != $before_shopping ]] && print rewritten) $(grep -c '#F87F7F' $(ui shopping))" "rewritten 2"
print -r -- '{"colour":"orange"}' > "$notes/.scratchnstick/shopping.json"
expect "an unknown colour gets the default's icon" "$(icons milk)" "Shopping dot-FEF49C-DBC503-*.png"
print -r -- '{"colour":"pink"}' > "$notes/.scratchnstick/shopping.json"
expect "a colour stored by name (not a slot) is unknown too" "$(icons default_colour=2 milk)" "Shopping dot-ADF4FF-24D0E9-*.png"
print -r -- '{"colour":"4"}' > "$notes/.scratchnstick/shopping.json"
expect "a slot stored as text is its slot" "$(icons milk)" "Shopping dot-FFC7C7-F87F7F-*.png"
print -r -- '{"colour":"orange"}' > "$notes/.scratchnstick/shopping.json"

# The palette from User Configuration: colour_1 to colour_6, each a name and
# one or two hex colours. A slot that can't be read shows what's wrong in
# place of the results.
expect "colour_N sets a slot's tint and control colour" "$(icons colour_1='Lemon #FFFF88 #CCCC00' milk)" "Shopping dot-FFFF88-CCCC00-*.png"
expect "a slot with one hex colour: its control colour is worked out from it" "$(icons colour_1='#FFFF88' milk)" "Shopping dot-FFFF88-*.png"
expect "a worked-out control colour has the tint's hue, stronger and darker" "$(ls $cache/icons | grep -c '^dot-FFFF88-BDBD0D-')" "1"
expect "an empty slot takes its default" "$(icons colour_1='' milk)" "Shopping dot-FEF49C-DBC503-*.png"
expect "hex in lower case, without #, and #RGB, in any order with the name" "$(icons colour_1='ffff88 Lemon #cc0' milk)" "Shopping dot-FFFF88-CCCC00-*.png"
expect_exact "a slot that can't be read: what's wrong, in place of the results" "$(icons colour_2='Blue' colour_5='Purple #12345' '')" $'Colour 2 isn\'t valid -\nColour 5 isn\'t valid -'
problems() {
  (cd "$tmp" && env notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache "$@") | osascript -l JavaScript -e '
    ObjC.import("Foundation");
    function run() {
      const input = $.NSString.alloc.initWithDataEncoding($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile, $.NSUTF8StringEncoding).js;
      return JSON.parse(input).items.map((i) => `${i.title} | ${i.subtitle} | ${i.valid}`).join("\n");
    }'
}
expect_exact "palette problems: each says what's wrong, and can't be actioned" "$(problems colour_2='Blue' colour_3='#B2FFA1 #51BB51 #000000' colour_5='Purple #12345' "$list" '')" $'Colour 2 isn\'t valid | It needs a hex colour, like #FEF49C. Fix it in the workflow\'s Configuration. | false\nColour 3 isn\'t valid | It has more than two hex colours: give the note\'s colour, then optionally a stronger one for its dot and ring. Fix it in the workflow\'s Configuration. | false\nColour 5 isn\'t valid | “#12345” isn\'t a hex colour, like #FEF49C. Fix it in the workflow\'s Configuration. | false'
expect_exact "palette problems: the new note keyword shows them too" "$(problems colour_2='Blue' ${here:h}/scripts/new.js 'some text')" "Colour 2 isn't valid | It needs a hex colour, like #FEF49C. Fix it in the workflow's Configuration. | false"
before_shopping=$(mtime shopping) before_cafe=$(mtime cafe)
icons colour_6='Grey #EEEEEE #999999' '' >/dev/null
expect "a palette change rewrites every quick bundle once" "$([[ $(mtime shopping) != $before_shopping && $(mtime cafe) != $before_cafe ]] && print rewritten) $(grep -c '#999999' $(ui shopping))" "rewritten 1"
icons '' >/dev/null
expect_exact "info.plist's colour fields default to lib.js's palette, and Default colour lists the slots" "$(osascript -l JavaScript -e '
  ObjC.import("Foundation");
  function run(argv) {
    eval($.NSString.stringWithContentsOfFileEncodingError(argv[0] + "/scripts/lib.js", $.NSUTF8StringEncoding, null).js);
    const plist = ObjC.deepUnwrap($.NSDictionary.dictionaryWithContentsOfFile(argv[0] + "/info.plist"));
    const config = (name) => plist.userconfigurationconfig.find((c) => c.variable === name).config;
    const fields = noteDefaultPalette().map((c) => config(`colour_${c.slot}`).default === `${c.label} ${c.tint} ${c.control}`);
    const pairs = config("default_colour").pairs.map(([label, value]) => `${label}=${value}`).join(", ");
    return `${fields.join(" ")} | ${pairs} | ${config("default_colour").default}`;
  }' ${here:h})" "true true true true true true | Colour 1 (Yellow)=1, Colour 2 (Blue)=2, Colour 3 (Green)=3, Colour 4 (Pink)=4, Colour 5 (Purple)=5, Colour 6 (Grey)=6 | 1"

# Note icons: a note with an icon shows its badge in its colour.
print -r -- '{"colour":4,"icon":"shopping-cart"}' > "$notes/.scratchnstick/shopping.json"
before_shopping=$(mtime shopping) before_cafe=$(mtime cafe)
expect "a note's icon shows as its badge in its colour, named for its colours, Lucide's release and its code" "$(icons milk)" "Shopping badge-shopping-cart-FFC7C7-F87F7F-1.80.0-*.svg"
badge=$(print $cache/icons/badge-shopping-cart-FFC7C7-F87F7F-*.svg)
expect "the badge: the icon from its button icon, in dark text colour, on the tint's square ringed in the control colour" "$(grep -c '<rect x="6" y="6" width="116" height="116" rx="26" fill="#FFC7C7" stroke="#F87F7F"' $badge) $(grep -c 'stroke="#1D1D1F"><path d="m2.05 2.05 ' $badge)" "1 1"
expect "an icon change rewrites the note's quick bundle with its button icon (button and picker)" "$([[ $(mtime shopping) != $before_shopping ]] && print rewritten) $(grep -c 'lucide/shopping-cart-light.svg' $(ui shopping))" "rewritten 2"
before_shopping=$(mtime shopping)
icons '' >/dev/null
expect "a list with nothing changed rewrites nothing" "$(mtime shopping) $(mtime cafe)" "$before_shopping $before_cafe"
expect "a dark theme rewrites every quick bundle once, with the dark button icons" "$(icons alfred_theme_background='rgba(16,16,16,1.00)' '' >/dev/null; [[ $(mtime shopping) != $before_shopping && $(mtime cafe) != $before_cafe ]] && print rewritten) $(grep -c 'lucide/shopping-cart-dark.svg' $(ui shopping))" "rewritten 2"
before_shopping=$(mtime shopping) before_cafe=$(mtime cafe)
icons alfred_theme_background='rgba(20,20,20,0.9)' '' >/dev/null
expect "another dark theme rewrites nothing" "$(mtime shopping) $(mtime cafe)" "$before_shopping $before_cafe"
# Every file a quick bundle names, as "<path> <exists>", one per line.
named_files() {
  osascript -l JavaScript -e '
    ObjC.import("Foundation");
    function run(argv) {
      const files = [];
      for (const path of argv) {
        const d = JSON.parse($.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null).js);
        if (d.iconpath) files.push(d.iconpath);
        (function walk(c) { if (c.image && c.image.type === "file") files.push(c.image.src); (c.components || []).forEach(walk); })(d.window.root);
      }
      return [...new Set(files)].map((f) => `${f} ${$.NSFileManager.defaultManager.fileExistsAtPath(f) ? "exists" : "MISSING"}`).join("\n");
    }' "$@"
}
named=$(named_files $quick/*.alfredui/ui.json)
expect "every file the quick bundles name exists, and none is in the cache (no app icon)" "$(print -r -- $named | grep -c MISSING || true) $(print -r -- $named | grep -c "^$cache" || true) $(grep -l iconpath $quick/*.alfredui/ui.json | wc -l | tr -d ' ')" "0 0 0"
print -r -- '{"colour":4,"icon":"rocket"}' > "$notes/.scratchnstick/shopping.json"
expect "an unknown icon: the colour's dot" "$(icons milk)" "Shopping dot-FFC7C7-F87F7F-*.png"
print -r -- '{"colour":"orange","icon":"heart"}' > "$notes/.scratchnstick/shopping.json"
expect "an icon with an unknown colour: the default colour's badge" "$(icons milk)" "Shopping badge-heart-FEF49C-DBC503-1.80.0-*.svg"

# The result icons' folder: emptied, its icons are made again, without
# rebuilding the quick bundles; a process that makes an icon sweeps out the
# ones whose names aren't current, and temporary files left a while ago.
icons '' >/dev/null
before_shopping=$(mtime shopping) before_cafe=$(mtime cafe)
rm -rf $cache/icons
expect "an emptied folder: the icons are made again" "$(icons '' | grep -c MISSING || true) $(ls $cache/icons | wc -l | tr -d ' ')" "0 2"
expect "an emptied folder: no quick bundle is rebuilt" "$(mtime shopping) $(mtime cafe)" "$before_shopping $before_cafe"
touch $cache/icons/badge-heart-FEF49C-DBC503-0.1.0-abcdef.svg $cache/icons/dot-FEF49C-DBC503-abcdef.png $cache/icons/notes.txt $cache/icons/.scratchnstick-save-new.tmp
touch -t 202001010000 $cache/icons/.scratchnstick-save-old.tmp
icons '' >/dev/null
expect "a list that makes no icon sweeps nothing" "$(ls -A $cache/icons | wc -l | tr -d ' ')" "7"
rm $cache/icons/dot-FEF49C-DBC503-[^a]*.png
expect "a list that makes an icon sweeps out the stale ones and old temporary files" "$(icons '' | grep -c MISSING || true) $(ls -A $cache/icons | sed 's/[0-9a-z]\{6\}\.\(svg\|png\)$/*/' | tr '\n' ' ')" "0 .scratchnstick-save-new.tmp badge-heart-FEF49C-DBC503-1.80.0-* dot-FEF49C-DBC503-* notes.txt "

# macOS 12 can't read the button icons and badges, so it gets no note icons:
# results show dots, and the quick bundles have no icon button or picker, and
# symbols for the actions. A Mac upgraded from 12 rebuilds them once.
before_shopping=$(mtime shopping) before_cafe=$(mtime cafe)
expect "macOS 12: a note with an icon shows its dot" "$(icons scratchnstick_macos_version=12 '' | grep Shopping)" "Shopping dot-FEF49C-DBC503-*.png"
expect "macOS 12: every quick bundle rebuilt once, without the icon button, the picker or any button icon" "$([[ $(mtime shopping) != $before_shopping && $(mtime cafe) != $before_cafe ]] && print rewritten) $(grep -c -E '"id": "(icon|iconpicker)"|icons/lucide/' $(ui shopping) || true) $(grep -c '"src": "eye"\|"src": "pencil"' $(ui shopping))" "rewritten 0 1"
before_shopping=$(mtime shopping)
icons scratchnstick_macos_version=12 '' >/dev/null
expect "macOS 12: a list with nothing changed rewrites nothing" "$(mtime shopping)" "$before_shopping"
icons scratchnstick_macos_version=13 '' >/dev/null
expect "macOS 13: rebuilt once, with the icon button" "$([[ $(mtime shopping) != $before_shopping ]] && print rewritten) $(grep -c '"id": "icon"' $(ui shopping))" "rewritten 1"
print -r -- '{"colour":"orange"}' > "$notes/.scratchnstick/shopping.json"

# The shipped button icons: each icon in each appearance, with Lucide's licence,
# drawn from the release lib.js names.
expect "every button icon exists, with Lucide's licence, from the release lib.js names" "$(osascript -l JavaScript -e '
  ObjC.import("Foundation");
  function run(argv) {
    (0, eval)($.NSString.stringWithContentsOfFileEncodingError(argv[0] + "/scripts/lib.js", $.NSUTF8StringEncoding, null).js);
    const files = noteButtonIconNames().flatMap((name) => ["light", "dark"].map((a) => noteButtonIconFile(name, a)));
    const missing = files.concat(["icons/lucide/LICENSE"]).filter((f) => !$.NSFileManager.defaultManager.fileExistsAtPath(argv[0] + "/" + f));
    return `${files.length} ${missing.join(" ") || "none missing"}`;
  }' ${here:h}) $(head -1 ${here}/lucide/VERSION | cut -d: -f1)" "104 none missing lucide-static $(grep -o 'LUCIDE_VERSION = "[^"]*"' ${here:h}/scripts/lib.js | cut -d'"' -f2)"

# A note is sticky only while its state's process is a live Alfred UI helper;
# a sticky state whose process isn't one is ignored.
print -r -- '{"form":"sticky","pid":'$$',"mode":"edit"}' > "$cache/state/shopping.json"
expect "a sticky state whose process isn't Alfred UI: a normal result" "$(items "$notes" milk | cut -d'|' -f2-3)" " Edited 3h ago • milk, eggs | $quick/shopping.alfredui "
rm "$cache/state/shopping.json"

# Reopen sticky notes (see reopenItem in list.js), from state files written
# here: a sticky window's state left by a session that ended (closed, and its
# forget timer no longer running) or by a window that died without closing
# (no `closed`, and its process gone).
scripts=${here:h}/scripts
true & dead=$!; wait $dead
state() { print -r -- "$2" > "$cache/state/$1.json" }
has_state() { [[ -e $cache/state/$1.json ]] && print there || print gone }
# Evaluates a JavaScript expression with `d` the JSON on stdin.
json() {
  osascript -l JavaScript -e '
    ObjC.import("Foundation");
    function run(argv) {
      const d = JSON.parse($.NSString.alloc.initWithDataEncoding($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile, $.NSUTF8StringEncoding).js);
      const value = new Function("d", `return (${argv[1]});`)(d);
      return typeof value === "string" ? value : JSON.stringify(value);
    }' "$@"
}
reopen_one="Reopen “Shopping” | Put the sticky note back on the desktop |  |  |  | - | - | "
state shopping '{"form":"sticky","pid":'$dead',"mode":"edit","collapsed":false,"closed":1}'
expect_exact "a closed sticky state whose forget timer has gone: Reopen, first, ↩ and ⌘ with no arg, ⌥ and ⌃ doing nothing" "$(items "$notes" "" | head -1)" "$reopen_one"
expect_exact "… and in the sticky notes list, with no sticky windows, only Reopen" "$(items "$notes" "" stickies)" "$reopen_one"
reopen_json() { notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache $list "" "$@" | json - 'JSON.stringify([d.items[0].variables, d.items[0].mods.cmd.subtitle, d.items[0].mods.cmd.variables])' }
expect_exact "Reopen: ↩ sets sticky_action reopen, and ⌘ forget" "$(reopen_json)" '[{"sticky_action":"reopen"},"Leave it closed",{"sticky_action":"forget"}]'
expect "a query: no Reopen" "$(items "$notes" milk | grep -c Reopen || true)" "0"
state cafe '{"form":"sticky","pid":'$dead',"mode":"view","collapsed":false}'
expect_exact "a sticky state with no close and its process gone (a crash): Reopen too, naming the notes, last edited first" "$(items "$notes" "" | head -1 | cut -d'|' -f1-2)" "Reopen sticky notes | Café ideas and Shopping "
expect_exact "Reopen, for several: ⌘ leaves them closed" "$(reopen_json | json - 'd[1]')" "Leave them closed"
note timed $'Timed note' -5d
$scripts/forget.sh "5 60 $cache/state/timed.json" & timer=$!
state timed '{"form":"sticky","pid":'$dead',"mode":"edit","collapsed":false,"closed":5}'
expect_exact "a closed state whose forget timer is running: not offered" "$(items "$notes" "" | head -1 | cut -d'|' -f2)" " Café ideas and Shopping "
$scripts/forget.sh "4 60 $cache/state/old.json" & timer2=$!
state old '{"form":"sticky","pid":'$dead',"mode":"edit","collapsed":false,"closed":1}'
expect_exact "a closed state with a timer running for another close of it: offered" "$(items "$notes" "" | head -1 | cut -d'|' -f2)" " Café ideas, Shopping and Old note "
kill $timer $timer2; wait $timer $timer2 2>/dev/null || true
expect_exact "… and once that timer has gone, four notes: two named and 2 more" "$(items "$notes" "" | head -1 | cut -d'|' -f2)" " Café ideas, Shopping and 2 more "
state gone '{"form":"sticky","pid":'$dead',"mode":"edit","collapsed":false,"closed":1}'
state quickleft '{"form":"quick","pid":'$dead',"mode":"edit"}'
state trashedleft '{"form":"sticky","pid":'$dead',"mode":"edit","trashed":true}'
cp "$notes/cafe.md" "$notes/quickleft.md"; cp "$notes/cafe.md" "$notes/trashedleft.md"
expect_exact "a note that no longer exists, a quick view's state and a trashed note's: not offered" "$(items "$notes" "" | head -1 | cut -d'|' -f2)" " Café ideas, Shopping and 2 more "
expect_exact "… and the state of the note that's gone is removed, the others left" "$(has_state gone) $(has_state quickleft) $(has_state trashedleft)" "gone there there"
rm -rf "$notes/quickleft.md" "$notes/trashedleft.md" "$cache/state/quickleft.json" "$cache/state/trashedleft.json" "$notes/timed.md" "$notes/.scratchnstick/timed.json" "$quick/timed.alfredui" "$cache/state/timed.json" "$cache/state/old.json"
expect_exact "the sticky notes list with sticky windows: Reopen first, then the notes, Show all and Close all" "$(scratchnstick_sticky_ids=cafe items "$notes" "" stickies | cut -d'|' -f1)" $'Reopen sticky notes \nCafé ideas \nShow all sticky notes \nClose all sticky notes '
expect_exact "open.js with sticky_action forget (⌘ in the notes list): opens nothing, and the notes aren't offered" "$(env notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache sticky_action=forget $scripts/open.js stick "" | json - 'd.alfredworkflow.arg + d.alfredworkflow.variables.open_window') $(items "$notes" "" | grep -c Reopen || true) $(has_state shopping) $(has_state cafe)" " 0 gone gone"
state shopping '{"form":"sticky","pid":'$dead',"mode":"edit","collapsed":false}'
# A note that's one long line, whose title needs text-rules.js.
note longline 'Hi Sam. Thanks for the notes from yesterday, I have added the action items to the tracker.' -2d
state longline '{"form":"sticky","pid":'$dead',"mode":"edit","collapsed":false}'
expect_exact "stickies.js reopen reads the notes to reopen, titles and all (outside Alfred it opens nothing)" "$(env notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache $scripts/stickies.js reopen 2>&1; print $?)" "0"
rm -rf "$notes/longline.md" "$notes/.scratchnstick/longline.json" "$quick/longline.alfredui" "$cache/state/longline.json"
env notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache $scripts/stickies.js forget
expect_exact "stickies.js forget (⌘ in the sticky notes list): the notes aren't offered" "$(items "$notes" "" | grep -c Reopen || true) $(has_state shopping)" "0 gone"

# stickies.js, run as the list's actions run it.
sj() { notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache ${here:h}/scripts/stickies.js "$@" }

# Sticky notes, given by scratchnstick_sticky_ids in place of live windows
# (see windowStates in list.js), and closed sticky notes, whose sidecars have
# `sticky`. In the notes list, a sticky note's result has no arg, takes ↩ down
# the stick route with `sticky` and `stick_note`, and is marked 📌, and 📌💤 if
# it's closed.
expect "notes list: a sticky note is marked 📌, with no arg; ⌘'s arg is its ID" "$(scratchnstick_sticky_ids=shopping items "$notes" milk)" "Shopping | 📌 Edited 3h ago • milk, eggs | @shopping |  | shopping | shopping | $notes/shopping.md | "
open_json() { scratchnstick_sticky_ids=shopping notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache $list milk | json - 'JSON.stringify([d.items[0].mods.cmd.subtitle, d.items[0].mods.cmd.variables])' }
expect_exact "notes list: a sticky note's ⌘ closes its window, through open.js" "$(open_json)" '["Close this sticky note",{"sticky_action":"close"}]'
expect_exact "open.js with sticky_action close and no window open: opens nothing" "$(env notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache sticky_action=close $scripts/open.js stick shopping | json - 'JSON.stringify([d.alfredworkflow.arg, d.alfredworkflow.variables.open_window])')" '["",""]'
expect_exact "open.js with sticky_action close: not a note ID" "$(env notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache sticky_action=close $scripts/open.js stick "" 2>&1 >/dev/null | grep -o 'Not a note ID.*')" 'Not a note ID: "" (-2700)'
# Sets `sticky` in a note's sidecar, as a sticky window does.
mark_sticky() { local f=$notes/.scratchnstick/$1.json; print -r -- "$(json - 'Object.assign(d, { sticky: true })' < $f)" > $f }
sidecar_sticky() { json - 'String(d.sticky)' < $notes/.scratchnstick/$1.json }
mark_sticky shopping
expect "notes list: a closed sticky note is marked 📌💤; ↩ sticks it, ⌘'s arg is its ID" "$(items "$notes" milk)" "Shopping | 📌💤 Edited 3h ago • milk, eggs | @shopping |  | shopping | shopping | $notes/shopping.md | "
closed_json() { notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache $list milk | json - 'JSON.stringify([d.items[0].variables, d.items[0].mods.cmd.subtitle, d.items[0].mods.cmd.variables])' }
expect_exact "notes list: a closed sticky note's ↩ sets sticky, and ⌘ unsticks it, through open.js" "$(closed_json)" '[{"sticky":"1","stick_note":"shopping"},"Unstick",{"sticky_action":"unstick"}]'
expect "notes list: a sticky note open and marked sticky is only 📌" "$(scratchnstick_sticky_ids=shopping items "$notes" milk | cut -d'|' -f2)" " 📌 Edited 3h ago • milk, eggs "
expect_exact "open.js with sticky_action unstick (⌘ on a closed sticky note): unsticks it, and opens nothing" "$(env notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache sticky_action=unstick $scripts/open.js stick shopping | json - 'JSON.stringify([d.alfredworkflow.arg, d.alfredworkflow.variables.open_window])') $(sidecar_sticky shopping)" '["",""] undefined'

# The sticky notes list (list.js's second argument, "stickies"): only the
# sticky notes, last edited first, each with its ID as the arg of ↩ and ⌘
# (Close), then Show all and Close all sticky notes, whose keys do nothing but
# ↩. No New note, and no "Sticky" in the subtitles.
stickies() { scratchnstick_sticky_ids=$1 items "$notes" "${2:-}" stickies }
# The list's raw JSON, for the variables.
stickies_json() { scratchnstick_sticky_ids=$1 notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache $list "" stickies }
all2="Show all sticky notes | Bring the 2 sticky notes on the desktop to the front |  |  | - | - | - | "$'\n'"Close all sticky notes | Close the 2 sticky notes on the desktop |  |  | - | - | - | "
expect_exact "stickies: the sticky notes, then Show all and Close all" "$(stickies $'shopping\ncafe')" "Café ideas | $(items "$notes" cafe | cut -d'|' -f2 | sed 's/^ //;s/ $//') | cafe |  | cafe | cafe | $notes/cafe.md | "$'\n'"Shopping | Edited 3h ago • milk, eggs | shopping |  | shopping | shopping | $notes/shopping.md | "$'\n'"$all2"
expect "stickies: ⌘ closes the note" "$(stickies_json cafe | grep -o '"cmd":{[^}]*}}' | head -1)" '"cmd":{"subtitle":"Close this sticky note","arg":"cafe","variables":{"sticky_action":"close"}}'
expect "stickies: Show all and Close all set sticky_action, for the Conditional; ↩ on a note sets nothing" "$(stickies_json cafe | grep -o '"variables":{[^}]*}' | tr '\n' ' ')" '"variables":{"sticky_action":"close"} "variables":{"sticky_action":"show"} "variables":{"sticky_action":"close"} '
expect_exact "stickies: a query narrows the notes, and Show all and Close all stay last" "$(stickies $'shopping\ncafe' MILK | cut -d'|' -f1)" $'Shopping \nShow all sticky notes \nClose all sticky notes '
expect_exact "stickies: a query that matches none says so, then Show all and Close all" "$(stickies $'shopping\ncafe' bread)" $'No sticky notes match “bread” | Search all your notes with “scratch” |  | \n'"$all2"
expect_exact "stickies: one sticky note" "$(stickies cafe | sed -n '2,3p' | cut -d'|' -f2)" $' Bring the sticky note on the desktop to the front \n Close the sticky note on the desktop '
expect_exact "stickies: a sticky note not saved yet has no result" "$(stickies $'cafe\nunsaved' | cut -d'|' -f1)" $'Café ideas \nShow all sticky notes \nClose all sticky notes '
expect_exact "stickies: … and Show all and Close all count it" "$(stickies $'cafe\nunsaved' | sed -n '2,3p' | cut -d'|' -f2)" $' Bring the 2 sticky notes on the desktop to the front \n Close the 2 sticky notes on the desktop '
expect_exact "stickies: none, with or without a query: only a result saying so" "$(stickies '' ; stickies '' milk)" $'No sticky notes | Stick a note to the desktop with ⌘↩ in “scratch” |  | \nNo sticky notes | Stick a note to the desktop with ⌘↩ in “scratch” |  | '
expect_exact "stickies: names the notes list's keyword" "$(keyword=notes stickies '' | cut -d'|' -f2)" " Stick a note to the desktop with ⌘↩ in “notes” "
before=$(ls "$quick" | sort)
stickies cafe >/dev/null
expect_exact "stickies: leaves the quick bundles alone" "$(ls "$quick" | sort)" "$before"

# The sticky notes list with closed sticky notes: open ones first, then the
# closed ones, marked 💤, whose ⌘ unsticks them; Show all and Close all only
# while windows are open.
mark_sticky cafe
mark_sticky shopping
expect_exact "stickies: open notes first, then closed ones marked 💤, then Show all and Close all for the open one" "$(stickies shopping | cut -d'|' -f1-3)" $'Shopping | Edited 3h ago • milk, eggs | shopping \nCafé ideas | 💤 '"$(items "$notes" cafe | cut -d'|' -f2 | sed 's/^ 📌💤 //;s/ $//')"$' | cafe \nShow all sticky notes | Bring the sticky note on the desktop to the front |  \nClose all sticky notes | Close the sticky note on the desktop |  '
expect "stickies: ⌘ on a closed note unsticks it" "$(stickies_json shopping | grep -o '"cmd":{[^}]*}}' | sed -n 2p)" '"cmd":{"subtitle":"Unstick","arg":"cafe","variables":{"sticky_action":"unstick"}}'
expect_exact "stickies: only closed notes: no Show all or Close all" "$(stickies '' | cut -d'|' -f1)" $'Café ideas \nShopping '
expect_exact "stickies: only closed notes and a query that matches none: only a result saying so" "$(stickies '' bread | cut -d'|' -f1)" "No sticky notes match “bread” "
state shopping '{"form":"sticky","pid":'$dead',"mode":"edit","collapsed":false,"closed":1}'
expect_exact "stickies: Reopen, then the closed notes" "$(stickies '' | cut -d'|' -f1)" $'Reopen “Shopping” \nCafé ideas \nShopping '
sj unstick shopping
expect_exact "stickies.js unstick: removes sticky from the sidecar and the note's state, so it isn't offered" "$(sidecar_sticky shopping) $(has_state shopping) $(stickies '' | cut -d'|' -f1)" "undefined gone Café ideas "
expect_exact "stickies.js unstick: a note that's gone" "$(sj unstick nosuchnote && print done)" "done"
expect_exact "stickies.js unstick needs an ID" "$(sj unstick '' 2>&1 >/dev/null | grep -o 'Unknown command.*')" 'Unknown command: ["unstick",""] (-2700)'
sj unstick cafe

# stickies.js with no sticky windows: nothing to close or show.
expect_exact "stickies.js: no sticky window to close or show" "$(sj close cafe && sj close '' && sj show '' && print done)" "done"
expect_exact "stickies.js: not a note ID" "$(sj close .hidden 2>&1 >/dev/null | grep -o 'Not a note ID.*')" 'Not a note ID: ".hidden" (-2700)'
expect_exact "stickies.js: an unknown command, or show with an ID" "$(sj open cafe 2>&1 >/dev/null | grep -o 'Unknown command.*'; sj show cafe 2>&1 >/dev/null | grep -o 'Unknown command.*')" $'Unknown command: ["open","cafe"] (-2700)\nUnknown command: ["show","cafe"] (-2700)'

# The theme stylesheet for quick views' pages, from Alfred's theme background.
# The stylesheet list.js writes with alfred_theme_background set to $1 (unset
# if it's empty).
theme() {
  (cd "$tmp" && env notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache ${1:+alfred_theme_background=$1} "$list" "") >/dev/null
  cat "$cache/theme.css"
}
expect_exact "theme: a solid theme's colour, at full opacity, with the system's text" "$(theme 'rgba(255,255,255,1.00)')" $':root { --panel: rgb(255, 255, 255); --opacity: 1; }\n@media (prefers-color-scheme: light) { :root { --panel: rgb(255, 255, 255); } }'
expect_exact "theme: a translucent theme over the base, at the lowest opacity, with stronger text" "$(theme 'rgba(40,161,250,0.05)')" $':root { --panel: rgb(31, 37, 41); --opacity: 0.8; }\n@media (prefers-color-scheme: light) { :root { --panel: rgb(244, 250, 255); } }\n@media (prefers-color-scheme: dark) { :root { --text: rgba(255, 255, 255, 1.00); --text-done: rgba(255, 255, 255, 0.60); --link: #4DA3FF; } }\n@media (prefers-color-scheme: light) { :root { --text: rgba(0, 0, 0, 1.00); --text-done: rgba(0, 0, 0, 0.60); --link: #0058D0; } }'
expect_exact "theme: above the lowest opacity, the theme's alpha" "$(theme 'rgba(20, 20, 20, 0.9)' | head -1) $(theme 'rgba(20, 20, 20, 0.9)' | sed -n 3p | grep -o -- '--text: [^;]*')" ':root { --panel: rgb(21, 21, 21); --opacity: 0.9; } --text: rgba(255, 255, 255, 0.94)'
before_theme=$(stat -f %Fm "$cache/theme.css")
theme 'rgba(20, 20, 20, 0.9)' >/dev/null
expect "theme: an unchanged stylesheet isn't rewritten" "$(stat -f %Fm "$cache/theme.css")" "$before_theme"
expect "theme: without a theme colour, the page's own colours" "$(theme '')" "/\* No theme colour*"

fresh=$tmp/fresh/notes
mkdir -p "$fresh"
note_ids() { ls "$1" | sed 's/\.md$//' | sort | tr '\n' ' ' }
shipped_ids=$(ls "${here:h}/examples" | grep -E '^example-[0-9]+-.*\.md$' | sed 's/\.md$//' | sort | tr '\n' ' ')
expect_exact "a first run adds the example notes" "$(items "$fresh" >/dev/null; note_ids "$fresh")" "$shipped_ids"
expect "…and lists them, the first example after New note" "$(items "$fresh" | sed -n 2p | cut -d'|' -f3)" " $quick/example-1-*.alfredui "
expect "…and records it" "$(cat "$fresh.data/state.json")" '*"examplesInstalled": "20*'
rm "$fresh"/example-1-*.md
expect_exact "a later run doesn't add them again" "$(items "$fresh" >/dev/null; note_ids "$fresh")" "${shipped_ids#* }"

expect "a missing notes folder: Missing notes folder, with its path" "$(items "$tmp/missing/notes" | cut -d'|' -f1-2)" "Missing notes folder | $tmp/missing/notes "

# new.js: the new-note keyword.
new_items() { local script=$new; items "$@" }
fresh=$tmp/fresh-new/notes
mkdir -p "$fresh"
expect_exact "new: a first run adds the example notes too" "$(new_items "$fresh" >/dev/null; note_ids "$fresh")" "$shipped_ids"
# Sets the test pasteboard's contents, as pairs of type and string.
clip() {
  osascript -l JavaScript -e '
    ObjC.import("AppKit");
    function run(argv) {
      const pasteboard = $.NSPasteboard.pasteboardWithName(argv[0]);
      pasteboard.clearContents;
      for (let i = 1; i < argv.length; i += 2) pasteboard.setStringForType($(argv[i + 1]), argv[i]);
    }' "$pasteboard" "$@" >/dev/null
}
text=public.utf8-plain-text
clip
expect "new: an empty clipboard: only New note, as in the list" "$(new_items "$notes")" "New note | Create a blank note | $quick/20*.alfredui |  |  | - | - | 1"
expect "new: with text, only New note: <text>, trimmed" "$(new_items "$notes" "  buy milk ")" "New note: buy milk | Create a note with this heading | $quick/20*.alfredui |  | buy milk | - | - | 1"
headingbundle=$(new_items "$notes" "buy milk" | cut -d'|' -f3 | tr -d ' ')
expect "new: text that reads as a heading starts the note as one, then an empty line" "$(grep -c '"text": "# buy milk\\n\\n"' $headingbundle/ui.json)" "1"
sentence=$(new_items "$notes" "Remember to call the bank.")
sentencebundle=$(print -r -- $sentence | cut -d'|' -f3 | tr -d ' ')
expect "new: a sentence stays as text" "$(print -r -- $sentence | cut -d'|' -f2) $(grep -c '"text": "Remember to call the bank."' $sentencebundle/ui.json)" " Create a note with this text  1"
expect "new: text that matches a note still makes a new one" "$(new_items "$notes" milk | cut -d'|' -f1)" "New note: milk "
clip $text $'# Plan

  - one  
'
# A JavaScript expression's value, with `d` new.js's output with no text,
# and with the further arguments (`sticky`) after the text.
new_json() {
  (cd "$tmp" && notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache scratchnstick_pasteboard=$pasteboard "$new" "" "${@:2}") | osascript -l JavaScript -e '
    ObjC.import("Foundation");
    function run(argv) {
      const d = JSON.parse($.NSString.alloc.initWithDataEncoding($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile, $.NSUTF8StringEncoding).js);
      return String(new Function("d", `return (${argv[0]});`)(d));
    }' "$1"
}
expect_exact "new: clipboard text: New note, then New note from clipboard" "$(new_json 'd.items.map((i) => i.title).join("\n")')" $'New note\nNew note from clipboard'
expect_exact "new: from clipboard: its text on one line as the subtitle, ⌘ arg the text as copied, with new=1" "$(new_json 'JSON.stringify([d.items[1].subtitle, d.items[1].mods.cmd.arg, d.items[1].mods.cmd.variables.new])')" '["# Plan - one","# Plan\n\n  - one  \n","1"]'
args=$(new_json 'd.items.map((i) => i.arg.split("/").pop()).join(" ")')
blank=${args% *} fromclip=${args#* }
expect "new: the two new notes have their own IDs and bundles, the second's with the clipboard's text" "${blank%.alfredui}-2.alfredui $(grep -c '"text": "# Plan' $quick/$fromclip/ui.json) $(grep -c '"text": "# Plan' $quick/$blank/ui.json || true)" "$fromclip 1 0"
expect_exact "new: the icon is the slate, and ⌘'s, which sticks the note, the sticky note" "$(new_json 'JSON.stringify(d.items.map((i) => [i.icon.path, i.mods.cmd.icon.path, i.mods.alt.icon]))')" '[["icons/slate.png","icons/note.png",null],["icons/slate.png","icons/note.png",null]]'
expect "new: text typed after the keyword leaves out the clipboard" "$(new_items "$notes" x | cut -d'|' -f1)" "New note: x "
# The new sticky note keyword (new.js's second argument, "sticky"): the same
# results, as sticky notes, with ↩ and ⌘ swapped: ↩'s arg is the text, with
# new=1, for the stick route, and ⌘'s the quick bundle, with `new` cleared.
expect "newsticky: New sticky note, then from clipboard; ↩ sticks, ⌘ the quick view" "$(new_items "$notes" "" sticky)" "New sticky note | Create a blank sticky note |  | 1 | $quick/20*.alfredui | - | - | "$'\n'"New sticky note from clipboard | # Plan - one | # Plan"$'\n\n'"  - one  "$'\n'" | 1 | $quick/20*-2.alfredui | - | - | "
expect "newsticky: with text" "$(new_items "$notes" "  buy milk " sticky)" "New sticky note: buy milk | Create a sticky note with this heading | buy milk | 1 | $quick/20*.alfredui | - | - | "
expect_exact "newsticky: ⌘'s subtitle" "$(cd "$tmp" && notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache scratchnstick_pasteboard=$pasteboard "$new" x sticky | grep -o '"cmd":{"subtitle":"[^"]*"')" '"cmd":{"subtitle":"Create it in Alfred instead"'
expect_exact "newsticky: the icon is the sticky note, and ⌘'s, which opens it in Alfred, the slate" "$(new_json 'JSON.stringify(d.items.map((i) => [i.icon.path, i.mods.cmd.icon.path]))' sticky)" '[["icons/note.png","icons/slate.png"],["icons/note.png","icons/slate.png"]]'
clip $text $' \n\t '
expect "new: a clipboard of whitespace: no result for it" "$(new_items "$notes" | wc -l | tr -d ' ')" "1"
clip public.file-url "file:///tmp/a.txt" $text "a.txt"
expect "new: files copied in Finder: no result for them" "$(new_items "$notes" | wc -l | tr -d ' ')" "1"
clip org.nspasteboard.ConcealedType "" $text "hunter2"
expect "new: concealed text (a password): no result for it" "$(new_items "$notes" | wc -l | tr -d ' ')" "1"
clip org.nspasteboard.TransientType "" $text "transient"
expect "new: transient text: no result for it" "$(new_items "$notes" | wc -l | tr -d ' ')" "1"
clip public.png "" 
expect "new: no text (an image): no result for it" "$(new_items "$notes" | wc -l | tr -d ' ')" "1"
expect "new: a missing notes folder: Missing notes folder" "$(new_items "$tmp/missing/notes" | cut -d'|' -f1)" "Missing notes folder "

# A note with only its creation time for a name: the list renames it for its
# title, and it keeps its ID.
named=$tmp/named
mkdir -p "$named" "$named.data"
print -r -- '{ "examplesInstalled": "2026-01-01T00:00:00+13:00" }' > "$named.data/state.json"
print -rn -- $'# Groceries\n- milk\n' > "$named/20261120-090000.md"
script=$list
expect "a note named by time is listed under its ID, renamed for its title (⌃'s arg)" "$(items "$named" | sed -n 2p | cut -d'|' -f1,3-)" "Groceries | $quick/20261120-090000.alfredui |  | 20261120-090000 | 20261120-090000 | $named/20261120-090000 Groceries.md | "
expect "…and the file is renamed" "$(ls "$named")" "20261120-090000 Groceries.md"

print
if (( failures )); then print "FAILED: $failures"; exit 1; else print "All passed"; fi
