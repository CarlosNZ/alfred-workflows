#!/bin/zsh
# Tests scripts/open.js and scripts/window.js, the note window's scripts, by
# running them as Alfred does (with the workflow's variables set) against a
# temporary notes folder and cache folder from mktemp, deleted afterwards. No
# windows are opened. Run from anywhere: dev/test-window.sh

setopt err_return pipe_fail no_unset
here=${0:A:h}
scripts=${here:h}/scripts
tmp=$(mktemp -d "${${TMPDIR:-/tmp}%/}/scratchnotes-test.XXXXXX")
trap '[[ $tmp == */scratchnotes-test.* ]] && rm -rf -- "$tmp"' EXIT
notes=$tmp/notes
cache=$tmp/cache
mkdir -p "$notes" "$cache"
failures=0
wj=$'⁠'

expect() {
  local label=$1 actual=$2 expected=$3
  # The expected text is a pattern (* matches anything), with | taken literally.
  if [[ $actual == ${~${expected//|/\\|}} ]]; then print -r -- "ok    $label"; else print -r -- "FAIL  $label"$'\n'"      got:      ${actual//$'\n'/$'\n'                }"$'\n'"      expected: $expected"; (( failures++ )) || true; fi
}

# Runs open.js with the workflow's variables (extra ones as NAME=value before
# the arguments) and prints its arg.
open_note() {
  local -a vars=()
  while [[ ${1:-} == *=* ]]; do vars+=$1; shift; done
  env notes_folder=$notes alfred_workflow_cache=$cache "${vars[@]}" "$scripts/open.js" "$@" | json - 'd.alfredworkflow.arg'
}

# Runs window.js as a window's action does (only the alfred_* variables).
window_js() { env alfred_workflow_cache=$cache "$scripts/window.js" "$@" }

# Evaluates a JavaScript expression with `d` the JSON in a file (- for stdin).
json() {
  osascript -l JavaScript -e '
    ObjC.import("Foundation");
    function run(argv) {
      const data = argv[0] === "-" ? $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile : $.NSData.dataWithContentsOfFile(argv[0]);
      const d = JSON.parse($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js);
      const value = new Function("d", `return (${argv[1]});`)(d);
      return typeof value === "string" ? value : JSON.stringify(value);
    }' "$@"
}

# The components of a ui.json, as "id:type" for those with an id.
ids='(function walk(c) { return [c.id ? c.id + ":" + (c.type || "") : null].concat((c.components || []).flatMap(walk)).filter(Boolean); })(d.window ? d.window.root : d).join(" ")'

print -rn -- $'# Team meeting\n- Ship it\n' > "$notes/meeting.md"
print -rn -- $'Vars: {var:x} and {const:y}\n' > "$notes/vars.md"

# An existing note, quick: View by default.
bundle=$(open_note quick meeting)
expect "quick: the bundle is the note's, in the cache's quick folder" "$bundle" "$cache/quick/meeting.alfredui"
ui=$bundle/ui.json
expect "quick: View mode, with the top row" "$(json $ui $ids)" "note:view toprow:view toggle:button pin:button content:view viewer:markdownarea doubleclick:view"
expect "quick: the viewer has the note's text" "$(json $ui 'd.window.root.components[1].components[0].text')" $'# Team meeting\n- Ship it'
expect "quick: the title is the note's" "$(json $ui 'd.window.title')" "Team meeting"
expect "quick: ⌘E, ⌘↩ and ⌘P, no ⎋" "$(json $ui 'd.window.root.shortcuts.map(s => s.shortcut).join(" ")')" "⌘E ⌘↩ ⌘P"
expect "quick: the quick size" "$(json $ui 'd.window.size.width + "x" + d.window.size.height')" "640x400"
expect "quick: no tint or appearance, so it takes Alfred's theme" "$(json $ui '"background" in d.window.root || "appearance" in d.window.root')" "false"
expect "actions run window.js by its absolute path" "$(json $ui 'd.window.root.events[0].action.src')" "$scripts/window.js"
expect "launched's args are strings" "$(json $ui 'd.window.root.events[0].action.args.join(" ")')" "launched meeting quick view"
expect "no template directives are left" "$(grep -c '"@' $ui || true)" "0"
expect "context: notes folder, font size, tint" "$(json $bundle/context.json 'd.folder + " " + d.fontSize + " " + d.tint')" "$notes 13 #FFF3B0"

# Pinned, with settings.
bundle=$(open_note font_size=17 open_mode=edit pin meeting)
expect "pinned: the bundle is in the cache's windows folder" "$bundle" "$cache/windows/meeting.alfredui"
ui=$bundle/ui.json
expect "pinned: open_mode edit gives Edit, without Pin" "$(json $ui $ids)" "note:view toprow:view toggle:button content:view editor:textarea"
expect "pinned: tinted, in the light appearance" "$(json $ui 'd.window.root.background + " " + d.window.root.appearance')" "#FFF3B0 light"
expect "pinned: ⌘E, ⌘↩ and ⎋, no ⌘P" "$(json $ui 'd.window.root.shortcuts.map(s => s.shortcut).join(" ")')" "⌘E ⌘↩ ⎋"
expect "pinned: the font size is a number" "$(json $ui 'typeof d.window.root.components[1].components[0].font.size + " " + d.window.root.components[1].components[0].font.size')" "number 17"
expect "font_size is kept within 11-20" "$(json "$(open_note font_size=40 pin meeting)/context.json" 'd.fontSize')" "20"

# Placeholders in a note's text are escaped.
ui=$(open_note open_mode=edit quick vars)/ui.json
expect "{var: and {const: are escaped with a word joiner" "$(json $ui 'd.window.root.components[1].components[0].text')" "Vars: {${wj}var:x} and {${wj}const:y}"

# New notes.
id1=$(basename "$(open_note new=1 quick 'Buy milk')" .alfredui)
expect "a new note's ID is the time" "$id1" "20[0-9][0-9][01][0-9][0-3][0-9]-[0-2][0-9][0-5][0-9][0-5][0-9]"
# A new note that's open but not saved may have only its pinned bundle: an ID
# with one is taken. Bundles for the next few seconds' IDs make the next new
# note -2.
for s in {0..9}; do mkdir -p "$cache/windows/$(date -v+${s}S +%Y%m%d-%H%M%S).alfredui"; done
id2=$(basename "$(open_note new=1 quick '')" .alfredui)
expect "an ID whose pinned bundle exists is taken" "$id2" "20[0-9][0-9][01][0-9][0-3][0-9]-[0-2][0-9][0-5][0-9][0-5][0-9]-2"
expect "a new note opens in Edit with its text" "$(json $cache/quick/$id1.alfredui/ui.json 'd.window.root.components[1].components[0].type + " " + d.window.root.components[1].components[0].text')" "textarea Buy milk"
expect "a new note isn't written until saved" "$(ls $notes | tr '\n' ' ')" "meeting.md vars.md "
expect "open.js sets open_window, clears new and pin_note" "$(env notes_folder=$notes alfred_workflow_cache=$cache new=1 $scripts/open.js quick x | json - 'JSON.stringify(d.alfredworkflow.variables)')" '{"open_window":"1","new":"","pin_note":""}'

# window.js: launched, save, toggle, edit, view, quit.
window_js launched "$id1" quick edit
expect "launched records form, process and mode" "$(json $cache/state/$id1.json 'd.form + " " + (d.pid === '$$' ? "this shell" : d.pid) + " " + d.mode')" "quick this shell edit"
window_js save "$id1" quick "Buy milk {${wj}var:x}"
expect "save writes the text, unescaped" "$(cat $notes/$id1.md)" "Buy milk {var:x}"
replace=$(window_js toggle "$id1" quick "Buy oat milk")
expect "toggle to View: saves first" "$(cat $notes/$id1.md)" "Buy oat milk"
expect "toggle to View: replaces the top row and content" "$(print -r -- $replace | json - 'Object.keys(d.replace.ids).join(" ")')" "toprow content"
expect "toggle to View: a viewer with the saved text" "$(print -r -- $replace | json - 'd.replace.ids.content.components[0].type + " " + d.replace.ids.content.components[0].text')" "markdownarea Buy oat milk"
expect "toggle to View: the button shows Edit" "$(print -r -- $replace | json - 'd.replace.ids.toprow.components[0].components[0].accessibility.label')" "Edit"
expect "toggle: the mode is in the state and the sidecar" "$(json $cache/state/$id1.json d.mode) $(json $notes/.scratchnotes/$id1.json d.mode)" "view view"
window_js save "$id1" quick ""
expect "save in View (typing stopped after the switch): nothing saved" "$(cat $notes/$id1.md)" "Buy oat milk"
window_js quit "$id1" quick ""
expect "quit in View: no save from the empty editor value" "$(cat $notes/$id1.md)" "Buy oat milk"
expect "quit removes the state" "$([[ -e $cache/state/$id1.json ]] && print there || print gone)" "gone"
expect "toggle with no state: nothing, and nothing saved" "$(window_js toggle "$id1" quick "") $(cat $notes/$id1.md)" " Buy oat milk"
window_js save "$id1" quick ""
expect "save with no state: blank text isn't saved" "$(cat $notes/$id1.md)" "Buy oat milk"
open_note pin "$id1" >/dev/null
replace=$(window_js launched "$id1" pinned view; window_js toggle "$id1" pinned "")
expect "toggle to Edit: an editor with the file's text" "$(print -r -- $replace | json - 'd.replace.ids.content.components[0].type + " " + d.replace.ids.content.components[0].text')" "textarea Buy oat milk"
expect "toggle in a pinned window: no Pin button" "$(print -r -- $replace | json - 'd.replace.ids.toprow.components[0].components.length')" "1"
expect "edit in Edit: nothing" "$(window_js edit "$id1" pinned "")" ""
replace=$(window_js view "$id1" pinned "Buy oat milk!")
expect "view in Edit: saves, then a viewer with the saved text" "$(cat $notes/$id1.md) $(print -r -- $replace | json - 'd.replace.ids.content.components[0].type + " " + d.replace.ids.content.components[0].text') $(json $cache/state/$id1.json d.mode)" "Buy oat milk! markdownarea Buy oat milk! view"
expect "view in View: nothing, and nothing saved" "$(window_js view "$id1" pinned "") $(cat $notes/$id1.md)" " Buy oat milk!"
replace=$(window_js edit "$id1" pinned "")
expect "edit in View: an editor with the file's text" "$(print -r -- $replace | json - 'd.replace.ids.content.components[0].type + " " + d.replace.ids.content.components[0].text') $(json $cache/state/$id1.json d.mode)" "textarea Buy oat milk! edit"
window_js quit "$id1" pinned "Buy oat milk and bread"
expect "quit in Edit: saves" "$(cat $notes/$id1.md)" "Buy oat milk and bread"
expect "the next open uses the remembered mode" "$(json "$(open_note quick $id1)/ui.json" 'd.window.root.components[1].components[0].type')" "textarea"

window_js launched "$id2" quick edit
window_js quit "$id2" quick "  "
expect "quit with a blank new note: nothing saved, bundle removed" "$(ls $notes | grep -c $id2 || true) $([[ -e $cache/quick/$id2.alfredui ]] && print there || print gone)" "0 gone"

# launched in a quick view: the note as it is now, if it changed after its
# bundle was written.
expect "launched with the note unchanged: no action" "$(window_js launched meeting quick view)" ""
print -rn -- $'# Team meeting\n- Ship it today\n' > "$notes/meeting.md"
replace=$(window_js launched meeting quick view)
expect "launched with the note changed: replaces the content with its text" "$(print -r -- $replace | json - 'd.replace.ids.content.components[0].type + " " + d.replace.ids.content.components[0].text')" $'markdownarea # Team meeting\n- Ship it today'

# quit with another form's state: a quick view that handed over to the note's
# pinned window leaves the note and the pinned window's state alone.
print -r -- '{"form":"pinned","pid":1,"mode":"edit"}' > $cache/state/meeting.json
window_js quit meeting quick "stale text"
expect "quit with the other form's state: no save, state kept" "$(head -1 $notes/meeting.md) $(json $cache/state/meeting.json d.form)" "# Team meeting pinned"
rm $cache/state/meeting.json

window_js launched meeting quick edit >/dev/null
window_js quit meeting quick ""
expect "quit with an existing note emptied: deleted with its sidecar" "$(ls -A $notes | grep -c meeting || true) $(ls -A $notes/.scratchnotes | grep -c meeting || true)" "0 0"

# Pinned windows.
mkdir -p $cache/state && print -r -- '{"form":"pinned","pid":'$$',"mode":"edit"}' > $cache/state/vars.json
expect "a pinned state whose process isn't Alfred UI doesn't count" "$(open_note quick vars)" "$cache/quick/vars.alfredui"
expect "pin_note: pins the note it names, ignoring new" "$(open_note new=1 pin_note="v{${wj}var:x}" pin 'ignored' 2>&1 | tail -1)" "$cache/windows/v{var:x}.alfredui"

print
if (( failures )); then print "FAILED: $failures"; exit 1; else print "All passed"; fi
