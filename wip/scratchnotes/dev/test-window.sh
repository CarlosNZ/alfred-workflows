#!/bin/zsh
# Tests scripts/open.js, scripts/window.js and scripts/changed.sh, the note
# window's scripts, and the page's task rule, by running them as Alfred does
# (with the workflow's variables set) against a temporary notes folder and
# cache folder from mktemp, deleted afterwards. No windows are opened. Run
# from anywhere: dev/test-window.sh

setopt err_return pipe_fail no_unset
here=${0:A:h}
workflow=${here:h}
scripts=$workflow/scripts
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

# As expect, but the expected text is taken literally, with no patterns.
expect_exact() {
  local label=$1 actual=$2 expected=$3
  if [[ $actual == "$expected" ]]; then print -r -- "ok    $label"; else print -r -- "FAIL  $label"$'\n'"      got:      ${actual//$'\n'/$'\n'                }"$'\n'"      expected: $expected"; (( failures++ )) || true; fi
}

# Runs open.js with the workflow's variables (extra ones as NAME=value before
# the arguments) and prints its arg.
open_note() {
  local -a vars=()
  while [[ ${1:-} == *=* ]]; do vars+=$1; shift; done
  env notes_folder=$notes alfred_workflow_cache=$cache "${vars[@]}" "$scripts/open.js" "$@" | json - 'd.alfredworkflow.arg'
}

# Runs window.js or changed.sh as a window's action does (only the alfred_*
# variables).
window_js() { env alfred_workflow_cache=$cache "$scripts/window.js" "$@" }
changed() { env alfred_workflow_cache=$cache "$scripts/changed.sh" "$@" }

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

# A bundle's note.js, as JSON: { "NOTE": …, "NOTE_TINT": … }.
page_note() {
  osascript -l JavaScript -e '
    ObjC.import("Foundation");
    function run(argv) {
      const page = {};
      new Function("window", $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js)(page);
      return JSON.stringify(page);
    }' "$1/note.js"
}
# The note's text in a bundle's note.js, or "null".
page_text() { page_note "$1" | json - 'd.NOTE === null ? "null" : d.NOTE' }

# The components of a ui.json, as "id:type" for those with an id.
ids='(function walk(c) { return [c.id ? c.id + ":" + (c.type || "") : null].concat((c.components || []).flatMap(walk)).filter(Boolean); })(d.window ? d.window.root : d).join(" ")'
# A component of a ui.json, or of a replace action's top row, by its id, as
# JavaScript.
byid() { print -r -- "(function find(c) { if (c.id === \"$1\") return c; for (const x of c.components || []) { const f = find(x); if (f) return f; } })(d.window ? d.window.root : d.replace ? d.replace.ids.toprow : d)" }
web=$(byid web)
editor=$(byid editor)
page=$(byid page)
toprow=$(byid toprow)

print -rn -- $'# Team meeting\n- Ship it\n' > "$notes/meeting.md"
print -rn -- $'Vars: {var:x} and {const:y}\n' > "$notes/vars.md"

# An existing note, quick: View by default.
bundle=$(open_note quick meeting)
expect "quick: the bundle is the note's, in the cache's quick folder" "$bundle" "$cache/quick/meeting.alfredui"
ui=$bundle/ui.json
expect "quick: a stack of the page's web view, the editor and the top row" "$(json $ui $ids)" "note:view content:view page:view web:webkitview editor:textarea toprow:view colour:button toggle:button pin:button"
expect "quick: the root and content are stacks filling the window" "$(json $ui 'd.window.root.layout + " " + d.window.root.components[0].layout + " " + d.window.root.components[0].constraints.stretch')" "stack stack both"
expect "quick: the top row is over the top-right corner" "$(json $ui '('$toprow').constraints.position + " " + JSON.stringify(('$toprow').constraints.insets)')" 'topright {"top":8,"right":10}'
expect "quick: the web view shows view.html, from opacity 0, links in the browser" "$(json $ui '['$web'.src, '$web'.opacity, '$web'.openlinksexternally].join(" ")')" "view.html 0 true"
expect "quick: the web view's changed runs changed.sh with its URL" "$(json $ui '['$web'.events[0].triggers, '$web'.events[0].action.src].concat('$web'.events[0].action.args).join(" ")')" "changed $scripts/changed.sh {value:web.src} meeting quick"
expect "quick: View's editor is hidden and empty, without focus" "$(json $ui '['$editor'.hidden, JSON.stringify('$editor'.text), Boolean('$editor'.focus)].join(" ")')" 'true "" false'
expect "quick: the editor's insets clear the top row" "$(json $ui 'JSON.stringify('$editor'.constraints.insets)')" '{"top":38,"left":14,"right":10,"bottom":10}'
expect "quick: the page fills the window" "$(json $ui 'JSON.stringify(('$page').constraints)')" '{"stretch":"both"}'
expect "quick: the page's view has ↩ (to Edit)" "$(json $ui '('$page').shortcuts.map(s => s.shortcut + " " + s.action.args[0]).join(" ")')" "↩ edit"
expect "quick: the page's note.js has the note" "$(page_text $bundle)" $'# Team meeting\n- Ship it'
expect "quick: the title is the note's" "$(json $ui 'd.window.title')" "Team meeting"
expect "quick: ⌘E, ⌘↩, ⌘P and ⌘1-⌘6, no ⎋" "$(json $ui 'd.window.root.shortcuts.map(s => s.shortcut).join(" ")')" "⌘E ⌘↩ ⌘P ⌘1 ⌘2 ⌘3 ⌘4 ⌘5 ⌘6"
expect "quick: the quick size" "$(json $ui 'd.window.size.width + "x" + d.window.size.height')" "640x400"
expect "quick: no tint or appearance, so it takes Alfred's theme" "$(json $ui '"background" in d.window.root || "appearance" in d.window.root')" "false"
expect "actions run window.js by its absolute path" "$(json $ui 'd.window.root.events[0].action.src')" "$scripts/window.js"
expect "launched's args are strings" "$(json $ui 'd.window.root.events[0].action.args.join(" ")')" "launched meeting quick view"
expect "no template directives are left" "$(grep -c '"@' $ui || true)" "0"
expect "context: notes folder, font size, colour" "$(json $bundle/context.json 'd.folder + " " + d.fontSize + " " + d.colour')" "$notes 13 yellow"

# The page.
html=$bundle/view.html
mdit=$(grep -o 'src="file://[^"]*markdown-it[^"]*"' $html | sed 's/^src="file:\/\///; s/"$//')
expect "page: markdown-it from the workflow folder, which has it" "$mdit $([[ -f $mdit ]] && print exists)" "$workflow/vendor/markdown-it/markdown-it.umd.min.js exists"
expect_exact "page: markdown-it's licence is with it" "$(head -1 $workflow/vendor/markdown-it/LICENSE)" "Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin."
expect "page: quick, at the font size" "$(grep -c '<html class="quick">' $html) $(grep -o 'font: [0-9]*px' $html)" "1 font: 13px"
expect "page: links the theme stylesheet" "$(grep -o 'const theme = .*;' $html)" "const theme = \"file://$cache/theme.css\";"
expect "page: note.js's version, for a load without ?v=" "$(grep -o '"?v=[0-9a-z]*"' $html)" '"?v=[0-9a-z]*"'
expect "page: view.js is inlined, and every token filled" "$(grep -c 'function startNotePage' $html) $(grep -c '@[A-Za-z]*@' $html || true)" "1 0"
expect "page: note.js has the tint" "$(page_note $bundle | json - d.NOTE_TINT)" "#FEF49C"

# Pinned, with settings.
bundle=$(open_note font_size=17 open_mode=edit pin meeting)
expect "pinned: the bundle is in the cache's windows folder" "$bundle" "$cache/windows/meeting.alfredui"
ui=$bundle/ui.json
expect "pinned: the same layout, without Pin" "$(json $ui $ids)" "note:view content:view page:view web:webkitview editor:textarea toprow:view colour:button toggle:button"
expect "pinned: tinted, in the light appearance" "$(json $ui 'd.window.root.background + " " + d.window.root.appearance')" "#FEF49C light"
expect "pinned: ⌘E, ⌘↩, ⎋ and ⌘1-⌘6, no ⌘P" "$(json $ui 'd.window.root.shortcuts.map(s => s.shortcut).join(" ")')" "⌘E ⌘↩ ⎋ ⌘1 ⌘2 ⌘3 ⌘4 ⌘5 ⌘6"
expect "pinned: the font size is a number" "$(json $ui 'typeof '$editor'.font.size + " " + '$editor'.font.size')" "number 17"
expect "pinned: the editor's insets clear the top row" "$(json $ui ''$editor'.constraints.insets.top')" "34"
expect "pinned: the page starts below the top row, so the window drags by the strip above" "$(json $ui '('$page').constraints.insets.top')" "28"
expect "pinned: Edit (open_mode): the editor shown with the text and focus" "$(json $ui '[Boolean('$editor'.hidden), '$editor'.focus, '$editor'.text].join(" ")')" $'false true # Team meeting\n- Ship it'
expect "pinned: Edit: the page has no note, so it shows nothing" "$(page_text $bundle)" "null"
expect "pinned: the page is pinned, at the font size, without the theme" "$(grep -c '<html class="pinned">' $bundle/view.html) $(grep -o 'font: [0-9]*px' $bundle/view.html) $(grep -o 'const theme = .*;' $bundle/view.html)" "1 font: 17px const theme = null;"
expect "font_size is kept within 11-20" "$(json "$(open_note font_size=40 pin meeting)/context.json" 'd.fontSize')" "20"

# Placeholders in a note's text are escaped in the window, but not in the page.
ui=$(open_note open_mode=edit quick vars)/ui.json
expect "{var: and {const: are escaped with a word joiner" "$(json $ui ''$editor'.text')" "Vars: {${wj}var:x} and {${wj}const:y}"
expect "the page's text isn't escaped" "$(page_text "$(open_note quick vars)")" "Vars: {var:x} and {const:y}"
print -rn -- $'</script><b>"Quotes"</b>\n {value:x}\n' > "$notes/script.md"
expect "the page's text keeps </script>, quotes and U+2028" "$(page_text "$(open_note quick script)")" $'</script><b>"Quotes"</b>\n {value:x}'

# New notes.
id1=$(basename "$(open_note new=1 quick 'Buy milk')" .alfredui)
expect "a new note's ID is the time" "$id1" "20[0-9][0-9][01][0-9][0-3][0-9]-[0-2][0-9][0-5][0-9][0-5][0-9]"
# A new note that's open but not saved may have only its pinned bundle: an ID
# with one is taken. Bundles for the next few seconds' IDs make the next new
# note -2.
for s in {0..9}; do mkdir -p "$cache/windows/$(date -v+${s}S +%Y%m%d-%H%M%S).alfredui"; done
id2=$(basename "$(open_note new=1 quick '')" .alfredui)
expect "an ID whose pinned bundle exists is taken" "$id2" "20[0-9][0-9][01][0-9][0-3][0-9]-[0-2][0-9][0-5][0-9][0-5][0-9]-2"
expect "a new note opens in Edit with its text" "$(json $cache/quick/$id1.alfredui/ui.json '[Boolean('$editor'.hidden), '$editor'.text].join(" ")') $(page_text $cache/quick/$id1.alfredui)" "false Buy milk null"
expect "a new note isn't written until saved" "$(ls $notes | tr '\n' ' ')" "meeting.md script.md vars.md "
expect "open.js sets open_window, clears new and pin_note" "$(env notes_folder=$notes alfred_workflow_cache=$cache new=1 $scripts/open.js quick x | json - 'JSON.stringify(d.alfredworkflow.variables)')" '{"open_window":"1","new":"","pin_note":""}'

# window.js: launched, save, toggle, edit, view, quit.
bundle1=$cache/quick/$id1.alfredui
window_js launched "$id1" quick edit
expect "launched records form, process and mode" "$(json $cache/state/$id1.json 'd.form + " " + (d.pid === '$$' ? "this shell" : d.pid) + " " + d.mode')" "quick this shell edit"
window_js save "$id1" quick "Buy milk {${wj}var:x}"
expect "save writes the text, unescaped" "$(cat $notes/$id1.md)" "Buy milk {var:x}"
update=$(window_js toggle "$id1" quick "Buy oat milk")
expect "toggle to View: saves first" "$(cat $notes/$id1.md)" "Buy oat milk"
expect "toggle to View: updates the toggle button, the editor and the web view" "$(print -r -- $update | json - 'Object.keys(d.update.ids).sort().join(" ")')" "editor toggle web"
expect "toggle to View: hides the editor" "$(print -r -- $update | json - 'JSON.stringify(d.update.ids.editor)')" '{"hidden":true}'
expect "toggle to View: reloads the page by its absolute URL, with a version" "$(print -r -- $update | json - 'Object.keys(d.update.ids.web).join(" ") + " " + d.update.ids.web.src')" "src file://$bundle1/view.html?v=*.*"
expect "toggle to View: the page's note.js has the saved text" "$(page_text $bundle1)" "Buy oat milk"
expect_exact "toggle to View: the button shows Edit" "$(print -r -- $update | json - '[d.update.ids.toggle.image.src, d.update.ids.toggle.tooltip, d.update.ids.toggle.accessibility.label].join(" ")')" "pencil Edit (⌘E) Edit"
expect "toggle: the mode is in the state and the sidecar" "$(json $cache/state/$id1.json d.mode) $(json $notes/.scratchnotes/$id1.json d.mode)" "view view"
window_js save "$id1" quick "Buy oat"
expect "save in View (typing stopped after the switch): nothing saved" "$(cat $notes/$id1.md)" "Buy oat milk"
window_js quit "$id1" quick "Buy oat"
expect "quit in View: no save from the hidden editor's text" "$(cat $notes/$id1.md)" "Buy oat milk"
expect "quit removes the state" "$([[ -e $cache/state/$id1.json ]] && print there || print gone)" "gone"
expect "toggle with no state: nothing, and nothing saved" "$(window_js toggle "$id1" quick "") $(cat $notes/$id1.md)" " Buy oat milk"
window_js save "$id1" quick ""
expect "save with no state: blank text isn't saved" "$(cat $notes/$id1.md)" "Buy oat milk"
bundle1=$(open_note pin "$id1")
update=$(window_js launched "$id1" pinned view; window_js toggle "$id1" pinned "")
expect "toggle to Edit: fades out the web view" "$(print -r -- $update | json - 'JSON.stringify(d.update.ids.web)')" '{"opacity":0}'
expect "toggle to Edit: shows the editor with the file's text and focus" "$(print -r -- $update | json - '[d.update.ids.editor.hidden, d.update.ids.editor.focus, d.update.ids.editor.text].join(" ")')" "false true Buy oat milk"
expect_exact "toggle to Edit: the button shows View" "$(print -r -- $update | json - '[d.update.ids.toggle.image.src, d.update.ids.toggle.tooltip].join(" ")')" "eye View (⌘E)"
expect "edit in Edit: nothing" "$(window_js edit "$id1" pinned "")" ""
update=$(window_js view "$id1" pinned "Buy oat milk!")
src1=$(print -r -- $update | json - d.update.ids.web.src)
expect "view in Edit: saves, then reloads the page with the saved text" "$(cat $notes/$id1.md) $src1 $(page_text $bundle1) $(json $cache/state/$id1.json d.mode)" "Buy oat milk! file://$bundle1/view.html?v=* Buy oat milk! view"
expect "view in View: nothing, and nothing saved" "$(window_js view "$id1" pinned "") $(cat $notes/$id1.md)" " Buy oat milk!"
update=$(window_js edit "$id1" pinned "")
expect "edit in View: the editor with the file's text" "$(print -r -- $update | json - 'd.update.ids.editor.text') $(json $cache/state/$id1.json d.mode)" "Buy oat milk! edit"
src2=$(window_js view "$id1" pinned "Buy oat milk!" | json - d.update.ids.web.src)
expect "view again with the same text: a new URL, so the page reloads" "$([[ $src1 != $src2 ]] && print different)" "different"
window_js edit "$id1" pinned "" >/dev/null
window_js quit "$id1" pinned "Buy oat milk and bread"
expect "quit in Edit: saves" "$(cat $notes/$id1.md)" "Buy oat milk and bread"
expect "the next open uses the remembered mode" "$(json "$(open_note quick $id1)/ui.json" 'Boolean('$editor'.hidden)')" "false"

window_js launched "$id2" quick edit
window_js quit "$id2" quick "  "
expect "quit with a blank new note: nothing saved, bundle removed" "$(ls $notes | grep -c $id2 || true) $([[ -e $cache/quick/$id2.alfredui ]] && print there || print gone)" "0 gone"

# launched in a quick view: the note as it is now, if it changed after its
# bundle was written.
bundle=$(open_note quick meeting)
expect "launched with the note unchanged: no action" "$(window_js launched meeting quick view)" ""
print -rn -- $'# Team meeting\n- Ship it today\n' > "$notes/meeting.md"
update=$(window_js launched meeting quick view)
expect "launched in View with the note changed: reloads the page with its text" "$(print -r -- $update | json - 'd.update.ids.web.src') $(page_text $bundle)" $'file://'$bundle$'/view.html?v=* # Team meeting\n- Ship it today'
window_js quit meeting quick ""
bundle=$(open_note open_mode=edit quick meeting)
print -rn -- $'# Team meeting\n- Ship it now {var:x}\n' > "$notes/meeting.md"
update=$(window_js launched meeting quick edit)
expect "launched in Edit with the note changed: the editor gets its text, escaped" "$(print -r -- $update | json - 'Object.keys(d.update.ids).join(" ") + " " + d.update.ids.editor.text')" $'editor # Team meeting\n- Ship it now {'$wj'var:x}'
window_js quit meeting quick $'# Team meeting\n- Ship it now {'$wj'var:x}'
print -rn -- $'# Team meeting\n- Ship it today\n' > "$notes/meeting.md"

# quit with another form's state: a quick view that handed over to the note's
# pinned window leaves the note and the pinned window's state alone.
print -r -- '{"form":"pinned","pid":1,"mode":"edit"}' > $cache/state/meeting.json
window_js quit meeting quick "stale text"
expect "quit with the other form's state: no save, state kept" "$(head -1 $notes/meeting.md) $(json $cache/state/meeting.json d.form)" "# Team meeting pinned"
rm $cache/state/meeting.json

window_js launched meeting quick edit >/dev/null
window_js quit meeting quick ""
expect "quit with an existing note emptied: deleted with its sidecar" "$(ls -A $notes | grep -c meeting || true) $(ls -A $notes/.scratchnotes | grep -c meeting || true)" "0 0"

# Ticking task boxes in View.
tasks=$'# Tasks\n- [ ] one\n- [x] two\n1. [ ] three\n> * [X] quoted\n  - [ ] nested\nnot a task\n'
print -rn -- $tasks > "$notes/tasks.md"
bundle=$(open_note pin tasks)
window_js launched tasks pinned view
line() { sed -n "$(( $1 + 1 ))p" $notes/tasks.md }
expect_exact "tick: ticks the line, prints nothing" "$(window_js tick tasks pinned 1 x) $(line 1)" " - [x] one"
expect_exact "tick: the page's note.js follows, so a reload shows it" "$(page_text $bundle | sed -n 2p)" "- [x] one"
expect_exact "untick" "$(window_js tick tasks pinned 2 o) $(line 2)" " - [ ] two"
expect_exact "tick a numbered task" "$(window_js tick tasks pinned 3 x) $(line 3)" " 1. [x] three"
expect_exact "untick a quoted task with [X]" "$(window_js tick tasks pinned 4 o) $(line 4)" " > * [ ] quoted"
expect_exact "tick a nested task" "$(window_js tick tasks pinned 5 x) $(line 5)" "   - [x] nested"
before=$(cat $notes/tasks.md)
update=$(window_js tick tasks pinned 6 x)
expect "tick a line that isn't a task: reloads the page, note unchanged" "$(print -r -- $update | json - d.update.ids.web.src) $([[ $(cat $notes/tasks.md) == $before ]] && print unchanged)" "file://$bundle/view.html?v=* unchanged"
update=$(window_js tick tasks pinned 1 x)
expect "tick a task that's already ticked: reloads the page" "$(print -r -- $update | json - d.update.ids.web.src) $(line 1)" "file://$bundle/view.html?v=* - \\[x\\] one"
print -rn -- $'# Tasks\n- [ ] one, changed elsewhere\n- [ ] two\n' > "$notes/tasks.md"
update=$(window_js tick tasks pinned 2 x)
expect "tick with the note changed under the page: reloads it, note unchanged" "$(print -r -- $update | json - d.update.ids.web.src) $(line 2) $(page_text $bundle | sed -n 2p)" "file://$bundle/view.html?v=* - \\[ \\] two - \\[ \\] one, changed elsewhere"
expect_exact "tick after that reload: ticks" "$(window_js tick tasks pinned 2 x) $(line 2)" " - [x] two"
expect "tick out of range: reloads the page" "$(window_js tick tasks pinned 99 x | json - 'd.update.ids.web.src')" "file://$bundle/view.html?v=*"
window_js toggle tasks pinned "" >/dev/null
expect_exact "tick in Edit: nothing" "$(window_js tick tasks pinned 1 x) $(line 1)" " - [ ] one, changed elsewhere"
window_js quit tasks pinned "$(cat $notes/tasks.md)"
expect_exact "tick with no state: nothing" "$(window_js tick tasks pinned 1 x) $(line 1)" " - [ ] one, changed elsewhere"

# changed.sh: the web view's changed event.
print -rn -- $'- [ ] a\n- [ ] b\n' > "$notes/tasks.md"
bundle=$(open_note pin tasks)
window_js launched tasks pinned view
url=$(fileurl() { osascript -l JavaScript -e 'ObjC.import("Foundation"); function run(argv) { return $.NSURL.fileURLWithPath(argv[0]).absoluteString.js; }' "$1" }; fileurl $bundle/view.html)
expect "changed: the page starting to load: nothing" "$(changed "$url" tasks pinned)" ""
expect "changed: a reload: nothing" "$(changed "$url?v=abc.def" tasks pinned)" ""
expect "changed: ready, quick: shows the web view at its opacity" "$(changed "$url?v=1#ready-0.8-1" tasks quick)" '{"update":{"ids":{"web":{"opacity":0.8}}}}'
expect "changed: ready, pinned: at full opacity" "$(changed "$url#ready-1-3" tasks pinned)" '{"update":{"ids":{"web":{"opacity":1}}}}'
expect "changed: ready with an opacity that isn't one: nothing" "$(changed "$url#ready-2-1" tasks pinned)$(changed "$url#ready-0.8" tasks pinned)$(changed "$url#ready-x-1" tasks pinned)" ""
window_js toggle tasks pinned "" >/dev/null
expect "changed: ready in Edit (a page that finished loading after ⌘E): nothing" "$(changed "$url?v=1#ready-1-1" tasks pinned)" ""
expect "changed: ready in Edit, but the state is another form's: shown" "$(changed "$url?v=1#ready-1-1" tasks quick)" '{"update":{"ids":{"web":{"opacity":1}}}}'
window_js toggle tasks pinned "$(cat $notes/tasks.md)" >/dev/null
expect "changed: ready with no state (a window opening in View): shown" "$(changed "$url#ready-0.8-1" palette quick)" '{"update":{"ids":{"web":{"opacity":0.8}}}}'
expect_exact "changed: a tick: ticks the note through window.js" "$(changed "$url?v=1#t-1-x-2" tasks pinned) $(line 1)" " - [x] b"
expect_exact "changed: a tick that doesn't parse: nothing" "$(changed "$url#t-0-q-2" tasks pinned)$(changed "$url#t--x-2" tasks pinned) $(line 0)" " - [ ] a"
expect "changed: another fragment: nothing" "$(changed "$url#t" tasks pinned)$(changed "$url#n-hello" tasks pinned)" ""
window_js quit tasks pinned ""

# The page's task rule, with the vendored markdown-it in JXA, and window.js's
# task line agreeing with it.
render() {
  osascript -l JavaScript -e '
    ObjC.import("Foundation");
    const read = (path) => $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null).js;
    function run(argv) {
      (0, eval)(read(argv[0]));
      (0, eval)(read(argv[1]));
      (0, eval)(read(argv[2]));
      const html = noteMarkdown(markdownit).render(argv[3]);
      if (argv[4] === "html") return html;
      // Each box: its line, x or o, and ! if window.js would refuse its tick.
      return [...html.matchAll(/<input type="checkbox" data-line="(\d+)"( checked)?>/g)]
        .map(([, line, checked]) => `${line}${checked ? "x" : "o"}${toggleNoteTask(argv[3], Number(line), !checked) === null ? "!" : ""}`)
        .join(" ");
    }' "$workflow/vendor/markdown-it/markdown-it.umd.min.js" "$workflow/ui/view.js" "$scripts/lib.js" "$@"
}
sample=$'---\ntitle: x\n---\n# Tasks\n\n- [ ] one\n- [x] two\n  - [X] nested\n\n1. [ ] numbered\n2) [x] **bold** start\n\n> - [ ] quoted\n>   - [x] quoted nested\n\n- [ ]\n- [x]no space\n- not [ ] a task\n\n[ ] not in a list\n\n* [ ] lazy\ncontinued\n'
expect "task rule: a box per task, on its source line; window.js agrees" "$(render $sample)" "5o 6x 7x 9o 10x 12o 13x 21o"
expect_exact "task rule: the box replaces the brackets" "$(render $'- [ ] one\n- [x] two' html | tr -d '\n')" '<ul><li class="task"><input type="checkbox" data-line="0">one</li><li class="task done"><input type="checkbox" data-line="1" checked>two</li></ul>'
expect_exact "task rule: raw HTML is escaped" "$(render $'<b>bold</b> <script>x()</script>' html | tr -d '\n')" '<p>&lt;b&gt;bold&lt;/b&gt; &lt;script&gt;x()&lt;/script&gt;</p>'

# Colour.
print -rn -- $'Palette\n' > "$notes/palette.md"
colourbtn=$(byid colour)
togglebtn=$(byid toggle)
# The colour menu of a ui.json or replace action, one item per line: its text,
# state and action (the update's background, then the script's arguments).
menu='('$colourbtn').events[0].action.src.popupmenu.menu.map(i => [i.text, i.state].concat([].concat(i.action).map(a => a.type === "json" ? a.src.update.ids.note.background : a.args.join(" "))).join(" | ")).join("\n")'
ui=$(open_note quick palette)/ui.json
expect "quick: the colour button's dot is the colour's control colour" "$(json $ui '('$colourbtn').contenttintcolour + " " + ('$colourbtn').image.src')" "#DBC503 circle.fill"
expect "quick: the menu pops up at the colour button" "$(json $ui '('$colourbtn').events[0].action.src.popupmenu.src')" "colour"
expect "quick: the menu's items, ✓ on the note's colour, each running window.js colour" "$(json $ui $menu)" $'💛 Yellow | on | colour palette quick yellow\n🩵 Blue | off | colour palette quick blue\n💚 Green | off | colour palette quick green\n🩷 Pink | off | colour palette quick pink\n💜 Purple | off | colour palette quick purple\n🩶 Grey | off | colour palette quick grey'
expect "quick: ⌘2 runs window.js colour blue" "$(json $ui 'd.window.root.shortcuts.find(s => s.shortcut === "⌘2").action.args.join(" ")')" "colour palette quick blue"
ui=$(open_note pin palette)/ui.json
expect "pinned: a menu item updates the tint, then runs window.js" "$(json $ui $menu | sed -n 4p)" "🩷 Pink | off | #FFC7C7 | colour palette pinned pink"
expect "pinned: ⌘6 updates the tint, then runs window.js" "$(json $ui 'd.window.root.shortcuts.find(s => s.shortcut === "⌘6").action.map(a => a.type === "json" ? a.src.update.ids.note.background : a.args.join(" ")).join(" | ")')" "#EEEEEE | colour palette pinned grey"
expect "default_colour sets a note's colour when it has none" "$(json "$(open_note default_colour=purple pin palette)/ui.json" 'd.window.root.background') $(json $cache/windows/palette.alfredui/context.json d.colour) $(page_note $cache/windows/palette.alfredui | json - d.NOTE_TINT)" "#B6CAFF purple #B6CAFF"
expect "an unknown default_colour is yellow" "$(json "$(open_note default_colour=orange pin palette)/ui.json" 'd.window.root.background')" "#FEF49C"
print -r -- '{"colour":"green"}' > $notes/.scratchnotes/palette.json
expect "a note's own colour wins over default_colour" "$(json "$(open_note default_colour=purple pin palette)/ui.json" 'd.window.root.background')" "#B2FFA1"
print -r -- '{"colour":"orange"}' > $notes/.scratchnotes/palette.json
expect "a note's unknown colour gets default_colour" "$(json "$(open_note default_colour=pink pin palette)/ui.json" 'd.window.root.background')" "#FFC7C7"
rm $notes/.scratchnotes/palette.json

bundle=$(open_note pin palette)
expect "colour with no state: nothing, and nothing recorded" "$(window_js colour palette pinned blue) $([[ -e $notes/.scratchnotes/palette.json ]] && json $notes/.scratchnotes/palette.json 'd.colour || "none"' || print none)" " none"
window_js launched palette pinned view
action=$(window_js colour palette pinned blue)
expect "colour: recorded in the sidecar and the window's context" "$(json $notes/.scratchnotes/palette.json d.colour) $(json $bundle/context.json d.colour)" "blue blue"
expect "colour: replaces the top row" "$(print -r -- $action | json - 'Object.keys(d.replace.ids).join(" ")')" "toprow"
expect "colour: the dot and ✓ show the new colour" "$(print -r -- $action | json - '('$colourbtn').contenttintcolour') $(print -r -- $action | json - $menu | grep -c '| on |') $(print -r -- $action | json - $menu | grep '| on |' | cut -d'|' -f1)" "#24D0E9 1 🩵 Blue "
expect "colour: the top row keeps the window's mode" "$(print -r -- $action | json - '('$togglebtn').accessibility.label')" "Edit"
expect "colour, pinned in View: reloads the page with the new tint" "$(print -r -- $action | json - 'd.update.ids.web.src') $(page_note $bundle | json - d.NOTE_TINT)" "file://$bundle/view.html?v=* #ADF4FF"
window_js toggle palette pinned "" >/dev/null
expect "colour, pinned in Edit: no reload" "$(window_js colour palette pinned green | json - 'String(d.update)')" "undefined"
window_js toggle palette pinned "Palette" >/dev/null
expect "the switch to View gives the page the new tint" "$(page_note $bundle | json - d.NOTE_TINT)" "#B2FFA1"
expect "the note's next window has its colour" "$(json "$(open_note quick palette)/ui.json" '('$colourbtn').contenttintcolour')" "#51BB51"
expect "colour: an unknown colour is an error" "$(window_js colour palette pinned orange 2>&1 >/dev/null | grep -c 'Unknown colour')" "1"
window_js quit palette pinned ""
window_js launched palette quick view
expect "colour, quick in View: no reload (the page has no tint)" "$(window_js colour palette quick blue | json - 'String(d.update)')" "undefined"
window_js quit palette quick ""
new=$(basename "$(open_note new=1 quick '')" .alfredui)
window_js launched "$new" quick edit
window_js colour "$new" quick pink >/dev/null
expect "colour on a new note before it's saved: recorded" "$(json $notes/.scratchnotes/$new.json d.colour)" "pink"
window_js quit "$new" quick ""
expect "a new note closed blank: its sidecar goes too" "$(ls -A $notes/.scratchnotes | grep -c $new || true)" "0"

# Pinned windows.
mkdir -p $cache/state && print -r -- '{"form":"pinned","pid":'$$',"mode":"edit"}' > $cache/state/vars.json
expect "a pinned state whose process isn't Alfred UI doesn't count" "$(open_note quick vars)" "$cache/quick/vars.alfredui"
expect "pin_note: pins the note it names, ignoring new" "$(open_note new=1 pin_note="v{${wj}var:x}" pin 'ignored' 2>&1 | tail -1)" "$cache/windows/v{var:x}.alfredui"

print
if (( failures )); then print "FAILED: $failures"; exit 1; else print "All passed"; fi
