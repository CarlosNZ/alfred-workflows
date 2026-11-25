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
tmp=$(mktemp -d "${${TMPDIR:-/tmp}%/}/scratchnstick-test.XXXXXX")
trap '[[ $tmp == */scratchnstick-test.* ]] && rm -rf -- "$tmp"' EXIT
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
  env notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache "${vars[@]}" "$scripts/open.js" "$@" | json - 'd.alfredworkflow.arg'
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
# Sets the mode in a note's sidecar, as its window records it.
note_mode() {
  local sidecar=$notes/.scratchnstick/$1.json
  if [[ -e $sidecar ]]; then plutil -replace mode -string "$2" "$sidecar"; else mkdir -p "${sidecar:h}"; print -rn -- "{\"mode\":\"$2\"}" > "$sidecar"; fi
}

# The files a ui.json, or an action printed by a script (- for stdin), names
# that don't exist: its app icon and every file image, one per line.
missing_files() {
  json "$1" '(function walk(v) { if (!v || typeof v !== "object") return []; const own = v.type === "file" && typeof v.src === "string" ? [v.src] : []; return own.concat(typeof v.iconpath === "string" ? [v.iconpath] : [], Object.values(v).flatMap(walk)); })(d).filter((f) => !$.NSFileManager.defaultManager.fileExistsAtPath(f)).join("\n")'
}

# The note's text in a bundle's note.js, or "null".
page_text() { page_note "$1" | json - 'd.NOTE === null ? "null" : d.NOTE' }

# The components of a ui.json, as "id:type" for those with an id.
ids='(function walk(c) { return [c.id ? c.id + ":" + (c.type || "") : null].concat((c.components || []).flatMap(walk)).filter(Boolean); })(d.window ? d.window.root : d).join(" ")'
# A component of a ui.json, or of a replace action's top row, by its id, as
# JavaScript.
byid() { print -r -- "(function find(c) { if (c.id === \"$1\") return c; for (const x of c.components || []) { const f = find(x); if (f) return f; } })(d.window ? d.window.root : d.replace ? d.replace.ids.customise : d)" }
web=$(byid web)
editor=$(byid editor)
page=$(byid page)
customise=$(byid customise)
actions=$(byid actions)
closegroup=$(byid closegroup)
closebtn=$(byid close)
# An icon button's image, as "<src> <size>" for a file (its path from icons/)
# or "<symbol>" for a symbol.
image='(b => b.image.type === "file" ? b.image.src.replace(/^.*\/icons\//, "icons/") + " " + b.image.size.width + "x" + b.image.size.height : b.image.type + " " + b.image.src)'

print -rn -- $'# Team meeting\n- Ship it\n' > "$notes/meeting.md"
print -rn -- $'Vars: {var:x} and {const:y}\n' > "$notes/vars.md"

# An existing note, quick: View by default.
bundle=$(open_note quick meeting)
expect "quick: the bundle is the note's, in the cache's quick folder" "$bundle" "$cache/quick/meeting.alfredui"
ui=$bundle/ui.json
expect "quick: a stack of the page's web view, the editor, the icon picker and the top row's two groups" "$(json $ui $ids)" "note:view content:view page:view web:webkitview editor:textarea pickercatcher:view iconpicker:view iconpickershadow:imageview iconpickerbox:view icon-none:button icon-sticky-note:button * icon-flag:button colourpicker:view colourpickershadow:imageview colourpickerbox:view colourmark-yellow:view colour-yellow:button * colourmark-grey:view colour-grey:button customise:view colourbox:view colour:button icon:button fontsize:button actions:view toggle:button stick:button"
expect "quick: the root and content are stacks filling the window" "$(json $ui 'd.window.root.layout + " " + d.window.root.components[0].layout + " " + d.window.root.components[0].constraints.stretch')" "stack stack both"
expect "quick: the colour and icon at the top left, the actions at the top right" "$(json $ui '['$customise', '$actions'].map(g => g.constraints.position + " " + JSON.stringify(g.constraints.insets)).join(" ")')" 'topleft {"top":5,"left":12} topright {"top":5,"right":10}'
expect "quick: the web view shows view.html, from opacity 0, links in the browser" "$(json $ui '['$web'.src, '$web'.opacity, '$web'.openlinksexternally].join(" ")')" "view.html 0 true"
expect "quick: the web view's changed runs changed.sh with its URL" "$(json $ui '['$web'.events[0].triggers, '$web'.events[0].action.src].concat('$web'.events[0].action.args).join(" ")')" "changed $scripts/changed.sh {value:web.src} meeting quick"
expect "quick: View's editor is hidden and empty, without focus" "$(json $ui '['$editor'.hidden, JSON.stringify('$editor'.text), Boolean('$editor'.focus)].join(" ")')" 'true "" false'
expect "quick: the editor's insets clear the top row" "$(json $ui 'JSON.stringify('$editor'.constraints.insets)')" '{"top":38,"left":14,"right":10,"bottom":10}'
expect "quick: the page fills the window" "$(json $ui 'JSON.stringify(('$page').constraints)')" '{"stretch":"both"}'
expect "quick: the page's view has ↩ (to Edit)" "$(json $ui '('$page').shortcuts.map(s => s.shortcut + " " + s.action.args[0]).join(" ")')" "↩ edit"
expect "quick: the page's note.js has the note" "$(page_text $bundle)" $'# Team meeting\n- Ship it'
expect "quick: the title is the note's" "$(json $ui 'd.window.title')" "Team meeting"
expect "quick: ⌘E, ⌘↩, ⌘P, ⌘I, ⌘1-⌘6 and the font size's, no ⎋" "$(json $ui 'd.window.root.shortcuts.map(s => s.shortcut).join(" ")')" "⌘E ⌘↩ ⌘P ⌘I ⌘1 ⌘2 ⌘3 ⌘4 ⌘5 ⌘6 ⌘= ⇧⌘= ⌘+ ⌘- ⌘0"
expect "quick: the quick size" "$(json $ui 'd.window.size.width + "x" + d.window.size.height')" "640x400"
expect "quick: not borderless" "$(json $ui '"borderless" in d.window || "cornerradius" in d.window')" "false"
expect "quick: no tint or appearance, so it takes Alfred's theme" "$(json $ui '"background" in d.window.root || "appearance" in d.window.root')" "false"
expect "actions run window.js by its absolute path" "$(json $ui 'd.window.root.events[0].action.src')" "$scripts/window.js"
expect "launched's args are strings" "$(json $ui 'd.window.root.events[0].action.args.join(" ")')" "launched meeting quick view"
expect "no template directives are left" "$(grep -c '"@' $ui || true)" "0"
expect "quick: no app icon, and every file it names exists" "$(json $ui '"iconpath" in d') $(missing_files $ui)" "false "
expect "context: notes folder, own and default font sizes, colour, icon, the button icons' appearance, note icons" "$(json $bundle/context.json '[d.folder, d.ownFontSize, d.defaultFontSize, d.colour, d.icon, d.appearance, d.icons].join(" ")')" "$notes  13 yellow  light true"

# The page.
html=$bundle/view.html
mdit=$(grep -o 'src="file://[^"]*markdown-it[^"]*"' $html | sed 's/^src="file:\/\///; s/"$//')
expect "page: markdown-it from the workflow folder, which has it" "$mdit $([[ -f $mdit ]] && print exists)" "$workflow/vendor/markdown-it/markdown-it.umd.min.js exists"
expect_exact "page: markdown-it's licence is with it" "$(head -1 $workflow/vendor/markdown-it/LICENSE)" "Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin."
expect_exact "page: quick, its font size from note.js" "$(grep -c '<html class="quick">' $html) $(grep -o 'font: var(--font-size, 13px)' $html) $(page_note $bundle | json - d.NOTE_FONT_SIZE)" "1 font: var(--font-size, 13px) 13"
expect "page: links the theme stylesheet" "$(grep -o 'const theme = .*;' $html)" "const theme = \"file://$cache/theme.css\";"
expect "page: note.js's version, for a load without ?v=" "$(grep -o '"?v=[0-9a-z]*"' $html)" '"?v=[0-9a-z]*"'
expect "page: view.js is inlined, and every token filled" "$(grep -c 'function startNotePage' $html) $(grep -c '@[A-Za-z]*@' $html || true)" "1 0"
expect "page: note.js has the tint" "$(page_note $bundle | json - d.NOTE_TINT)" "#FEF49C"

# Sticky, with settings.
note_mode meeting edit
bundle=$(open_note font_size=17 stick meeting)
expect "sticky: the bundle is in the cache's windows folder" "$bundle" "$cache/windows/meeting.alfredui"
ui=$bundle/ui.json
expect "sticky: the same layout, without Stick" "$(json $ui $ids)" "note:view content:view page:view web:webkitview editor:textarea pickercatcher:view iconpicker:view iconpickershadow:imageview iconpickerbox:view icon-none:button * icon-flag:button colourpicker:view colourpickershadow:imageview colourpickerbox:view colourmark-yellow:view colour-yellow:button * colourmark-grey:view colour-grey:button customise:view colourbox:view colour:button icon:button fontsize:button actions:view toggle:button closegroup:view close:button"
expect "sticky: borderless, with rounded corners" "$(json $ui '[d.window.borderless, d.window.cornerradius].join(" ")')" "true 10"
expect "sticky: the close button at the top left, then the colour and icon, level with the actions" "$(json $ui '['$closegroup', '$customise', '$actions'].map(g => g.constraints.position + " " + JSON.stringify(g.constraints.insets)).join(" ")')" 'topleft {"top":5,"left":9} topleft {"top":5,"left":44} topright {"top":5,"right":10}'
expect_exact "sticky: the close button shows the close icon and closes the window" "$(json $ui '['$image'('$closebtn'), '$closebtn'.tooltip, '$closebtn'.accessibility.label, JSON.stringify('$closebtn'.events)].join(" | ")')" "icons/lucide/close-light.svg 15x15 | Close (⌘W) | Close | "'[{"triggers":"actioned","action":{"type":"json","src":{"finish":{}}}}]'
expect "sticky: tinted, in the light appearance" "$(json $ui 'd.window.root.background + " " + d.window.root.appearance')" "#FEF49C light"
expect "sticky: ⌘E, ⌘↩, ⌘I, ⎋, ⌘W, ⌘1-⌘6 and the font size's, no ⌘P" "$(json $ui 'd.window.root.shortcuts.map(s => s.shortcut).join(" ")')" "⌘E ⌘↩ ⌘I ⎋ ⌘W ⌘1 ⌘2 ⌘3 ⌘4 ⌘5 ⌘6 ⌘= ⇧⌘= ⌘+ ⌘- ⌘0"
expect_exact "sticky: ⌘W closes the window" "$(json $ui 'JSON.stringify(d.window.root.shortcuts.find(s => s.shortcut === "⌘W").action)')" '{"type":"json","src":{"finish":{}}}'
expect "sticky: the font size is a number" "$(json $ui 'typeof '$editor'.font.size + " " + '$editor'.font.size')" "number 17"
expect "sticky: the editor's insets clear the top row" "$(json $ui ''$editor'.constraints.insets.top')" "34"
expect "sticky: the page starts below the top row, so the window drags by the strip above" "$(json $ui '('$page').constraints.insets.top')" "28"
expect "sticky: Edit (the sidecar's mode): the editor shown with the text and focus" "$(json $ui '[Boolean('$editor'.hidden), '$editor'.focus, '$editor'.text].join(" ")')" $'false true # Team meeting\n- Ship it'
expect "sticky: Edit: the page has no note, so it shows nothing" "$(page_text $bundle)" "null"
expect "sticky: the page is sticky, without the theme, and note.js has the font size" "$(grep -c '<html class="sticky">' $bundle/view.html) $(grep -o 'const theme = .*;' $bundle/view.html) $(page_note $bundle | json - d.NOTE_FONT_SIZE)" "1 const theme = null; 17"
expect "font_size is kept within 11-20" "$(json "$(open_note font_size=40 stick meeting)/context.json" 'd.defaultFontSize')" "20"

# Placeholders in a note's text are escaped in the window, but not in the page.
note_mode vars edit
ui=$(open_note quick vars)/ui.json
expect "{var: and {const: are escaped with a word joiner" "$(json $ui ''$editor'.text')" "Vars: {${wj}var:x} and {${wj}const:y}"
note_mode vars view
expect "the page's text isn't escaped" "$(page_text "$(open_note quick vars)")" "Vars: {var:x} and {const:y}"
print -rn -- $'</script><b>"Quotes"</b>\n {value:x}\n' > "$notes/script.md"
expect "the page's text keeps </script>, quotes and U+2028" "$(page_text "$(open_note quick script)")" $'</script><b>"Quotes"</b>\n {value:x}'

# New notes.
id1=$(basename "$(open_note new=1 quick 'Buy milk')" .alfredui)
expect "a new note's ID is the time" "$id1" "20[0-9][0-9][01][0-9][0-3][0-9]-[0-2][0-9][0-5][0-9][0-5][0-9]"
# A new note that's open but not saved may have only its sticky bundle: an ID
# with one is taken. Bundles for the next few seconds' IDs make the next new
# note -2.
for s in {0..9}; do mkdir -p "$cache/windows/$(date -v+${s}S +%Y%m%d-%H%M%S).alfredui"; done
id2=$(basename "$(open_note new=1 quick '')" .alfredui)
expect "an ID whose sticky bundle exists is taken" "$id2" "20[0-9][0-9][01][0-9][0-3][0-9]-[0-2][0-9][0-5][0-9][0-5][0-9]-2"
expect_exact "a new note opens in Edit with its text, as a heading" "$(json $cache/quick/$id1.alfredui/ui.json '[Boolean('$editor'.hidden), JSON.stringify('$editor'.text)].join(" ")') $(page_text $cache/quick/$id1.alfredui)" 'false "# Buy milk\n\n" null'
id5=$(basename "$(open_note new=1 quick $'Line one\n  Line two  \n')" .alfredui)
expect_exact "a new note from text that isn't a heading keeps it exactly" "$(json $cache/quick/$id5.alfredui/ui.json '[Boolean('$editor'.hidden), JSON.stringify('$editor'.text)].join(" ")')" 'false "Line one\n  Line two  \n"'
expect "a new note isn't written until saved" "$(ls $notes | tr '\n' ' ')" "meeting.md script.md vars.md "
expect "open.js sets open_window, clears new and stick_note" "$(env notes_folder=$notes alfred_workflow_data=$notes.data alfred_workflow_cache=$cache new=1 $scripts/open.js quick x | json - 'JSON.stringify(d.alfredworkflow.variables)')" '{"open_window":"1","new":"","stick_note":"","stick_mode":""}'

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
expect_exact "toggle to View: the button shows Edit" "$(print -r -- $update | json - '[d.update.ids.toggle.image.src, d.update.ids.toggle.tooltip, d.update.ids.toggle.accessibility.label].join(" ")')" "$workflow/icons/lucide/pencil-light.svg Edit (⌘E) Edit"
expect "toggle: the mode is in the state and the sidecar" "$(json $cache/state/$id1.json d.mode) $(json $notes/.scratchnstick/$id1.json d.mode)" "view view"
window_js save "$id1" quick "Buy oat"
expect "save in View (typing stopped after the switch): nothing saved" "$(cat $notes/$id1.md)" "Buy oat milk"
window_js quit "$id1" quick "Buy oat"
expect "quit in View: no save from the hidden editor's text" "$(cat $notes/$id1.md)" "Buy oat milk"
expect "quit removes the state" "$([[ -e $cache/state/$id1.json ]] && print there || print gone)" "gone"
expect "toggle with no state: nothing, and nothing saved" "$(window_js toggle "$id1" quick "") $(cat $notes/$id1.md)" " Buy oat milk"
window_js save "$id1" quick ""
expect "save with no state: blank text isn't saved" "$(cat $notes/$id1.md)" "Buy oat milk"
bundle1=$(open_note stick "$id1")
update=$(window_js launched "$id1" sticky view; window_js toggle "$id1" sticky "")
expect "toggle to Edit: fades out the web view" "$(print -r -- $update | json - 'JSON.stringify(d.update.ids.web)')" '{"opacity":0}'
expect "toggle to Edit: shows the editor with the file's text and focus" "$(print -r -- $update | json - '[d.update.ids.editor.hidden, d.update.ids.editor.focus, d.update.ids.editor.text].join(" ")')" "false true Buy oat milk"
expect_exact "toggle to Edit: the button shows View" "$(print -r -- $update | json - '[d.update.ids.toggle.image.src, d.update.ids.toggle.tooltip].join(" ")')" "$workflow/icons/lucide/eye-light.svg View (⌘E)"
expect "edit in Edit: nothing" "$(window_js edit "$id1" sticky "")" ""
update=$(window_js view "$id1" sticky "Buy oat milk!")
src1=$(print -r -- $update | json - d.update.ids.web.src)
expect "view in Edit: saves, then reloads the page with the saved text" "$(cat $notes/$id1.md) $src1 $(page_text $bundle1) $(json $cache/state/$id1.json d.mode)" "Buy oat milk! file://$bundle1/view.html?v=* Buy oat milk! view"
expect "view in View: nothing, and nothing saved" "$(window_js view "$id1" sticky "") $(cat $notes/$id1.md)" " Buy oat milk!"
update=$(window_js edit "$id1" sticky "")
expect "edit in View: the editor with the file's text" "$(print -r -- $update | json - 'd.update.ids.editor.text') $(json $cache/state/$id1.json d.mode)" "Buy oat milk! edit"
src2=$(window_js view "$id1" sticky "Buy oat milk!" | json - d.update.ids.web.src)
expect "view again with the same text: a new URL, so the page reloads" "$([[ $src1 != $src2 ]] && print different)" "different"
window_js edit "$id1" sticky "" >/dev/null
window_js quit "$id1" sticky "Buy oat milk and bread"
expect "quit in Edit: saves" "$(cat $notes/$id1.md)" "Buy oat milk and bread"
expect "quit records the window's mode in the sidecar" "$(json $notes/.scratchnstick/$id1.json d.mode)" "edit"
expect "the next open uses the remembered mode" "$(json "$(open_note quick $id1)/ui.json" 'Boolean('$editor'.hidden)')" "false"

window_js launched "$id2" quick edit
window_js quit "$id2" quick "  "
expect "quit with a blank new note: nothing saved, no sidecar, bundle removed" "$(ls -A $notes $notes/.scratchnstick | grep -c $id2 || true) $([[ -e $cache/quick/$id2.alfredui ]] && print there || print gone)" "0 gone"
id4=$(basename "$(open_note new=1 quick 'Never switched')" .alfredui)
window_js launched "$id4" quick edit
window_js quit "$id4" quick "Never switched"
expect "quit of a new note never switched: Edit recorded, and it reopens in Edit" "$(json $notes/.scratchnstick/$id4.json d.mode) $(json "$(open_note quick $id4)/ui.json" 'Boolean('$editor'.hidden)')" "edit false"
print -rn -- "From another app" > "$notes/elsewhere.md"
expect "a note never open in a window opens in View, quick and sticky" "$(json "$(open_note quick elsewhere)/ui.json" 'Boolean('$editor'.hidden)') $(json "$(open_note stick elsewhere)/ui.json" 'Boolean('$editor'.hidden)')" "true true"
window_js quit elsewhere quick ""
expect "quit with no state: no mode recorded" "$(json $notes/.scratchnstick/elsewhere.json '"mode" in d')" "false"

# stick: Stick or ⌘P in a quick view saves before finishing, so the stick route
# finds the text on disk without waiting for the view's quit, and the sticky
# window carries on in the view's mode.
id3=$(basename "$(open_note new=1 quick 'Sticky straight away')" .alfredui)
window_js launched "$id3" quick edit
stickbutton=$(byid stick)
expect "quick: ⌘P and the Stick button run window.js stick with the editor's text" "$(json $cache/quick/$id3.alfredui/ui.json '[d.window.root.shortcuts.find(s => s.shortcut === "⌘P").action, ('$stickbutton').events[0].action].map(a => [a.src].concat(a.args).join(" ")).join(" | ")')" "$scripts/window.js stick $id3 quick {value:editor.text} | $scripts/window.js stick $id3 quick {value:editor.text}"
finish=$(window_js stick "$id3" quick "Sticky straight away {${wj}var:x}")
expect "stick in Edit: saves the editor's text, unescaped, before finishing" "$(cat $notes/$id3.md)" "Sticky straight away {var:x}"
expect "stick: finishes with stick_note, the escaped ID, and stick_mode, the view's mode" "$(print -r -- $finish | json - 'JSON.stringify(d)')" '{"finish":{"variables":{"stick_note":"'$id3'","stick_mode":"edit"}}}'
window_js quit "$id3" quick "Sticky straight away {${wj}var:x}"
ui=$(open_note stick_note=$id3 stick_mode=edit stick '')/ui.json
expect "stick: open.js sticks the saved text, in Edit" "$(json $ui '[Boolean('$editor'.hidden), '$editor'.text].join(" ")')" "false Sticky straight away {${wj}var:x}"
expect "stick: without stick_mode, the sticky window opens in the sidecar's mode, recorded by quit" "$(json $notes/.scratchnstick/$id3.json d.mode) $(json "$(open_note stick_note=$id3 stick '')/ui.json" 'Boolean('$editor'.hidden)')" "edit false"
note_mode $id3 view
expect "stick_mode only applies after Stick, with stick_note" "$(json "$(open_note stick_mode=edit stick $id3)/ui.json" 'Boolean('$editor'.hidden)')" "true"
expect "stick_mode=view: a blank note still opens in Edit" "$(json "$(open_note stick_note=$id2 stick_mode=view stick '')/ui.json" 'Boolean('$editor'.hidden)')" "false"
finish=$(window_js launched meeting quick view >/dev/null; window_js stick meeting quick "stale")
expect "stick in View: nothing saved from the hidden editor, stick_mode view" "$(head -1 $notes/meeting.md) $(print -r -- $finish | json - d.finish.variables.stick_mode)" "# Team meeting view"
window_js quit meeting quick ""
window_js launched "$id3" quick edit >/dev/null; window_js toggle "$id3" quick "Sticky straight away" >/dev/null; window_js quit "$id3" quick ""
expect "stick: the view's mode carries over, not the sidecar's" "$(json $notes/.scratchnstick/$id3.json d.mode) $(json "$(open_note stick_note=$id3 stick_mode=edit stick '')/ui.json" 'Boolean('$editor'.hidden)')" "view false"

# launched in a quick view: the note as it is now, if it changed after its
# bundle was written.
bundle=$(open_note quick meeting)
expect "launched with the note unchanged: no action" "$(window_js launched meeting quick view)" ""
print -rn -- $'# Team meeting\n- Ship it today\n' > "$notes/meeting.md"
update=$(window_js launched meeting quick view)
expect "launched in View with the note changed: reloads the page with its text" "$(print -r -- $update | json - 'd.update.ids.web.src') $(page_text $bundle)" $'file://'$bundle$'/view.html?v=* # Team meeting\n- Ship it today'
window_js quit meeting quick ""
note_mode meeting edit
bundle=$(open_note quick meeting)
print -rn -- $'# Team meeting\n- Ship it now {var:x}\n' > "$notes/meeting.md"
update=$(window_js launched meeting quick edit)
expect "launched in Edit with the note changed: the editor gets its text, escaped" "$(print -r -- $update | json - 'Object.keys(d.update.ids).join(" ") + " " + d.update.ids.editor.text')" $'editor # Team meeting\n- Ship it now {'$wj'var:x}'
window_js quit meeting quick $'# Team meeting\n- Ship it now {'$wj'var:x}'
print -rn -- $'# Team meeting\n- Ship it today\n' > "$notes/meeting.md"

# quit with another form's state: a quick view that handed over to the note's
# sticky window leaves the note and the sticky window's state alone.
print -r -- '{"form":"sticky","pid":1,"mode":"edit"}' > $cache/state/meeting.json
window_js quit meeting quick "stale text"
expect "quit with the other form's state: no save, state kept" "$(head -1 $notes/meeting.md) $(json $cache/state/meeting.json d.form)" "# Team meeting sticky"
rm $cache/state/meeting.json

window_js launched meeting quick edit >/dev/null
window_js quit meeting quick ""
expect "quit with an existing note emptied: deleted with its sidecar" "$(ls -A $notes | grep -c meeting || true) $(ls -A $notes/.scratchnstick | grep -c meeting || true)" "0 0"

# Ticking task boxes in View.
tasks=$'# Tasks\n- [ ] one\n- [x] two\n1. [ ] three\n> * [X] quoted\n  - [ ] nested\nnot a task\n'
print -rn -- $tasks > "$notes/tasks.md"
bundle=$(open_note stick tasks)
window_js launched tasks sticky view
line() { sed -n "$(( $1 + 1 ))p" $notes/tasks.md }
expect_exact "tick: ticks the line, prints nothing" "$(window_js tick tasks sticky 1 x) $(line 1)" " - [x] one"
expect_exact "tick: the page's note.js follows, so a reload shows it" "$(page_text $bundle | sed -n 2p)" "- [x] one"
expect_exact "untick" "$(window_js tick tasks sticky 2 o) $(line 2)" " - [ ] two"
expect_exact "tick a numbered task" "$(window_js tick tasks sticky 3 x) $(line 3)" " 1. [x] three"
expect_exact "untick a quoted task with [X]" "$(window_js tick tasks sticky 4 o) $(line 4)" " > * [ ] quoted"
expect_exact "tick a nested task" "$(window_js tick tasks sticky 5 x) $(line 5)" "   - [x] nested"
before=$(cat $notes/tasks.md)
update=$(window_js tick tasks sticky 6 x)
expect "tick a line that isn't a task: reloads the page, note unchanged" "$(print -r -- $update | json - d.update.ids.web.src) $([[ $(cat $notes/tasks.md) == $before ]] && print unchanged)" "file://$bundle/view.html?v=* unchanged"
update=$(window_js tick tasks sticky 1 x)
expect "tick a task that's already ticked: reloads the page" "$(print -r -- $update | json - d.update.ids.web.src) $(line 1)" "file://$bundle/view.html?v=* - \\[x\\] one"
print -rn -- $'# Tasks\n- [ ] one, changed elsewhere\n- [ ] two\n' > "$notes/tasks.md"
update=$(window_js tick tasks sticky 2 x)
expect "tick with the note changed under the page: reloads it, note unchanged" "$(print -r -- $update | json - d.update.ids.web.src) $(line 2) $(page_text $bundle | sed -n 2p)" "file://$bundle/view.html?v=* - \\[ \\] two - \\[ \\] one, changed elsewhere"
expect_exact "tick after that reload: ticks" "$(window_js tick tasks sticky 2 x) $(line 2)" " - [x] two"
expect "tick out of range: reloads the page" "$(window_js tick tasks sticky 99 x | json - 'd.update.ids.web.src')" "file://$bundle/view.html?v=*"
window_js toggle tasks sticky "" >/dev/null
expect_exact "tick in Edit: nothing" "$(window_js tick tasks sticky 1 x) $(line 1)" " - [ ] one, changed elsewhere"
window_js quit tasks sticky "$(cat $notes/tasks.md)"
expect_exact "tick with no state: nothing" "$(window_js tick tasks sticky 1 x) $(line 1)" " - [ ] one, changed elsewhere"

# changed.sh: the web view's changed event.
print -rn -- $'- [ ] a\n- [ ] b\n' > "$notes/tasks.md"
bundle=$(open_note stick tasks)
window_js launched tasks sticky view
url=$(fileurl() { osascript -l JavaScript -e 'ObjC.import("Foundation"); function run(argv) { return $.NSURL.fileURLWithPath(argv[0]).absoluteString.js; }' "$1" }; fileurl $bundle/view.html)
expect "changed: the page starting to load: nothing" "$(changed "$url" tasks sticky)" ""
expect "changed: a reload: nothing" "$(changed "$url?v=abc.def" tasks sticky)" ""
expect "changed: ready, quick: shows the web view at its opacity" "$(changed "$url?v=1#ready-0.8-1" tasks quick)" '{"update":{"ids":{"web":{"opacity":0.8}}}}'
expect "changed: ready, sticky: at full opacity" "$(changed "$url#ready-1-3" tasks sticky)" '{"update":{"ids":{"web":{"opacity":1}}}}'
expect "changed: ready with an opacity that isn't one: nothing" "$(changed "$url#ready-2-1" tasks sticky)$(changed "$url#ready-0.8" tasks sticky)$(changed "$url#ready-x-1" tasks sticky)" ""
window_js toggle tasks sticky "" >/dev/null
expect "changed: ready in Edit (a page that finished loading after ⌘E): nothing" "$(changed "$url?v=1#ready-1-1" tasks sticky)" ""
expect "changed: ready in Edit, but the state is another form's: shown" "$(changed "$url?v=1#ready-1-1" tasks quick)" '{"update":{"ids":{"web":{"opacity":1}}}}'
window_js toggle tasks sticky "$(cat $notes/tasks.md)" >/dev/null
expect "changed: ready with no state (a window opening in View): shown" "$(changed "$url#ready-0.8-1" palette quick)" '{"update":{"ids":{"web":{"opacity":0.8}}}}'
expect_exact "changed: a tick: ticks the note through window.js" "$(changed "$url?v=1#t-1-x-2" tasks sticky) $(line 1)" " - [x] b"
expect_exact "changed: a tick that doesn't parse: nothing" "$(changed "$url#t-0-q-2" tasks sticky)$(changed "$url#t--x-2" tasks sticky) $(line 0)" " - [ ] a"
expect "changed: another fragment: nothing" "$(changed "$url#t" tasks sticky)$(changed "$url#n-hello" tasks sticky)" ""
window_js quit tasks sticky ""

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

# Drop-downs: the icon and colour pickers.
picker() { env alfred_workflow_cache=$cache "$scripts/picker.sh" "$@" }
# A drop-down's buttons (in a ui.json, or a replace action's picker), one per
# line: id | bordered | image | tooltip | accessibility label | the script's
# arguments (a sticky colour's tint update first).
buttons_of() { print -r -- '(function find(c) { if (c.id === "'$1'") return c; for (const x of c.components || []) { const f = find(x); if (f) return f; } })(d.window ? d.window.root : d.replace.ids.'${1%box}').components.flatMap(r => r.components).map(b => [b.id, b.bordered, '$image'(b), b.tooltip, b.accessibility.label, [].concat(b.events[0].action).map(a => a.type === "json" ? a.src.update.ids.note.background : a.args.join(" ")).join(" | ")].join(" | ")).join("\n")' }
buttons=$(buttons_of iconpickerbox)
# The colour picker's swatches, one per line: id | its mark's background (or
# -) | bordered | symbol and font size | tint | tooltip | accessibility label |
# the script's arguments (a sticky colour's tint update first).
colours='(function find(c) { if (c.id === "colourpickerbox") return c; for (const x of c.components || []) { const f = find(x); if (f) return f; } })(d.window ? d.window.root : d.replace.ids.colourpicker).components.flatMap(r => r.components).map(m => { const b = m.components[0]; return [b.id, m.background || "-", b.bordered, b.image.type + " " + b.image.src + " " + b.font.size, b.contenttintcolour, b.tooltip, b.accessibility.label, [].concat(b.events[0].action).map(a => a.type === "json" ? a.src.update.ids.note.background : a.args.join(" ")).join(" | ")].join(" | "); }).join("\n")'
iconpickerv=$(byid iconpicker)
iconpickerbox=$(byid iconpickerbox)
colourpickerv=$(byid colourpicker)
colourpickerbox=$(byid colourpickerbox)
catcher=$(byid pickercatcher)
OPEN_ICON='{"update":{"ids":{"iconpicker":{"hidden":false},"colourpicker":{"hidden":true},"pickercatcher":{"hidden":false}}}}'
OPEN_COLOUR='{"update":{"ids":{"iconpicker":{"hidden":true},"colourpicker":{"hidden":false},"pickercatcher":{"hidden":false}}}}'
CLOSED='{"update":{"ids":{"iconpicker":{"hidden":true},"colourpicker":{"hidden":true},"pickercatcher":{"hidden":true}}}}'

# Colour.
print -rn -- $'Palette\n' > "$notes/palette.md"
colourbtn=$(byid colour)
ui=$(open_note quick palette)/ui.json
expect "quick: the colour button's swatch is the colour's control colour" "$(json $ui '('$colourbtn').contenttintcolour + " " + ('$colourbtn').image.src + " " + ('$colourbtn').font.size')" "#DBC503 circle.fill 16"
expect_exact "quick: the colour button is at the top of its box, 2 pt shorter, so its swatch is 1 pt higher" "$(json $ui 'JSON.stringify((function find(c) { if (c.id === "colourbox") return c; for (const x of c.components || []) { const f = find(x); if (f) return f; } })(d.window.root).constraints) + " " + JSON.stringify(('$colourbtn').constraints)')" '{"size":{"width":22,"height":22}} {"position":"topleft","insets":{"top":0,"left":0},"size":{"width":22,"height":20}}'
expect "quick: the colour button runs picker.sh toggle colour" "$(json $ui '[('$colourbtn').events[0].action.src].concat(('$colourbtn').events[0].action.args).join(" ")')" "$scripts/picker.sh toggle palette quick colour"
expect "the colour picker starts hidden, after the catcher and the icon picker, in the content stack" "$(json $ui '[('$colourpickerv').hidden, d.window.root.components[0].components.map(c => c.id).join(",")].join(" ")')" "true page,editor,pickercatcher,iconpicker,colourpicker"
expect "the colour picker: a box of one row, 8 pt in and 34 pt down, with its shadow around it" "$(json $ui '[JSON.stringify(('$colourpickerv').constraints), ('$colourpickerv').components.map(c => c.id).join(","), JSON.stringify(('$colourpickerbox').constraints), ('$colourpickerbox').components.length].join(" ")')" '{"position":"topleft","insets":{"top":26,"left":0},"size":{"width":188,"height":53}} colourpickershadow,colourpickerbox {"position":"topleft","insets":{"top":8,"left":8},"size":{"width":172,"height":37}} 1'
expect "the colour picker's shadow is an image its size, which exists" "$(json $ui 'JSON.stringify(('$colourpickerv').components[0].image.size) + " " + ('$colourpickerv').components[0].image.src') $(sips -g pixelWidth -g pixelHeight $workflow/icons/shadow-colour-picker.png | awk '/pixel/ {printf "%s ", $2}')" "{\"width\":188,\"height\":53} $workflow/icons/shadow-colour-picker.png 376 106 "
expect_exact "quick: the colour picker's swatches, borderless, the note's colour marked, each running window.js colour" "$(json $ui $colours)" $'colour-yellow | unemphasizedSelectedContentBackgroundColor | false | symbol circle.fill 14 | #DBC503 | Yellow (⌘1) | Yellow | colour palette quick yellow\ncolour-blue | - | false | symbol circle.fill 14 | #24D0E9 | Blue (⌘2) | Blue | colour palette quick blue\ncolour-green | - | false | symbol circle.fill 14 | #51BB51 | Green (⌘3) | Green | colour palette quick green\ncolour-pink | - | false | symbol circle.fill 14 | #F87F7F | Pink (⌘4) | Pink | colour palette quick pink\ncolour-purple | - | false | symbol circle.fill 14 | #7D9BEB | Purple (⌘5) | Purple | colour palette quick purple\ncolour-grey | - | false | symbol circle.fill 14 | #A8A8A8 | Grey (⌘6) | Grey | colour palette quick grey'
expect "the colour picker: each swatch and its mark 25 pt, the mark rounded" "$(json $ui '[...new Set(('$colourpickerbox').components.flatMap(r => r.components).map(m => [JSON.stringify(m.constraints.size), JSON.stringify(m.components[0].constraints.size), m.cornerradius].join(" ")))].join(", ")')" '{"width":25,"height":25} {"width":25,"height":25} 5'
expect "quick: ⌘2 runs window.js colour blue" "$(json $ui 'd.window.root.shortcuts.find(s => s.shortcut === "⌘2").action.args.join(" ")')" "colour palette quick blue"
ui=$(open_note stick palette)/ui.json
expect_exact "sticky: a colour's button updates the tint, then runs window.js" "$(json $ui $colours | sed -n 4p)" "colour-pink | - | false | symbol circle.fill 14 | #F87F7F | Pink (⌘4) | Pink | #FFC7C7 | colour palette sticky pink"
expect "sticky: ⌘6 updates the tint, then runs window.js" "$(json $ui 'd.window.root.shortcuts.find(s => s.shortcut === "⌘6").action.map(a => a.type === "json" ? a.src.update.ids.note.background : a.args.join(" ")).join(" | ")')" "#EEEEEE | colour palette sticky grey"
expect "default_colour sets a note's colour when it has none" "$(json "$(open_note default_colour=purple stick palette)/ui.json" 'd.window.root.background') $(json $cache/windows/palette.alfredui/context.json d.colour) $(page_note $cache/windows/palette.alfredui | json - d.NOTE_TINT)" "#B6CAFF purple #B6CAFF"
expect "an unknown default_colour is yellow" "$(json "$(open_note default_colour=orange stick palette)/ui.json" 'd.window.root.background')" "#FEF49C"
print -r -- '{"colour":"green"}' > $notes/.scratchnstick/palette.json
expect "a note's own colour wins over default_colour" "$(json "$(open_note default_colour=purple stick palette)/ui.json" 'd.window.root.background')" "#B2FFA1"
print -r -- '{"colour":"orange"}' > $notes/.scratchnstick/palette.json
expect "a note's unknown colour gets default_colour" "$(json "$(open_note default_colour=pink stick palette)/ui.json" 'd.window.root.background')" "#FFC7C7"
rm $notes/.scratchnstick/palette.json

bundle=$(open_note stick palette)
expect "colour with no state: nothing, and nothing recorded" "$(window_js colour palette sticky blue) $([[ -e $notes/.scratchnstick/palette.json ]] && json $notes/.scratchnstick/palette.json 'd.colour || "none"' || print none)" " none"
window_js launched palette sticky view
picker toggle palette sticky colour >/dev/null
action=$(window_js colour palette sticky blue)
expect "colour: recorded in the sidecar and the window's context" "$(json $notes/.scratchnstick/palette.json d.colour) $(json $bundle/context.json d.colour)" "blue blue"
expect "colour: replaces the customise group and the colour picker, leaving the actions (and the mode) alone" "$(print -r -- $action | json - 'Object.keys(d.replace.ids).join(" ")')" "customise colourpicker"
expect "colour: the swatch shows the new colour, and the picker marks it, hidden" "$(print -r -- $action | json - '('$colourbtn').contenttintcolour + " " + d.replace.ids.colourpicker.hidden') $(print -r -- $action | json - $colours | grep '| unemphasizedSelectedContentBackgroundColor |' | cut -d'|' -f1)" "#24D0E9 true colour-blue "
expect "colour: closes the open picker" "$(print -r -- $action | json - '[d.update.ids.iconpicker.hidden, d.update.ids.pickercatcher.hidden].join(" ")') $([[ -e $cache/state/palette.picker ]] && print open || print closed)" "true true closed"
expect "colour, sticky in View: reloads the page with the new tint" "$(print -r -- $action | json - 'd.update.ids.web.src') $(page_note $bundle | json - d.NOTE_TINT)" "file://$bundle/view.html?v=* #ADF4FF"
window_js toggle palette sticky "" >/dev/null
expect "colour, sticky in Edit: no reload" "$(window_js colour palette sticky green | json - 'String(d.update.ids.web)')" "undefined"
window_js toggle palette sticky "Palette" >/dev/null
expect "the switch to View gives the page the new tint" "$(page_note $bundle | json - d.NOTE_TINT)" "#B2FFA1"
expect "the note's next window has its colour" "$(json "$(open_note quick palette)/ui.json" '('$colourbtn').contenttintcolour')" "#51BB51"
expect "colour: an unknown colour is an error" "$(window_js colour palette sticky orange 2>&1 >/dev/null | grep -c 'Unknown colour')" "1"
window_js quit palette sticky ""
window_js launched palette quick view
expect "colour, quick in View: no reload (the page has no tint)" "$(window_js colour palette quick blue | json - 'String(d.update.ids.web)')" "undefined"
window_js quit palette quick ""
new=$(basename "$(open_note new=1 quick '')" .alfredui)
window_js launched "$new" quick edit
window_js colour "$new" quick pink >/dev/null
expect "colour on a new note before it's saved: recorded" "$(json $notes/.scratchnstick/$new.json d.colour)" "pink"
window_js quit "$new" quick ""
expect "a new note closed blank: its sidecar goes too" "$(ls -A $notes/.scratchnstick | grep -c $new || true)" "0"

# Font size.
print -rn -- $'Sizes\n' > "$notes/sizes.md"
sizebtn=$(byid fontsize)
# The Font size menu (in a ui.json, or a replace action's customise group), one
# item per line: text | state | the script's arguments, or "-" for a separator.
sizemenu='('$sizebtn').events[0].action.src.popupmenu.menu.map(i => i.type === "separator" ? "-" : [i.text, i.state, i.action.args.join(" ")].join(" | ")).join("\n")'
# The ✓ items of the Font size menu.
sizeticked='('$sizebtn').events[0].action.src.popupmenu.menu.filter(i => i.state === "on").map(i => i.text).join(",")'
ui=$(open_note quick sizes)/ui.json
expect_exact "the Font size button: after the colour and icon, a button icon, with its tooltip" "$(json $ui '[('$customise').components.map(c => c.id).join(","), '$image'('$sizebtn'), ('$sizebtn').bordered, ('$sizebtn').tooltip, ('$sizebtn').accessibility.label].join(" | ")')" "colourbox,icon,fontsize | icons/lucide/text-size-light.svg 19x19 | false | Font size (⌘+, ⌘−) | Font size"
expect "the Font size button pops up its menu" "$(json $ui '[('$sizebtn').events[0].triggers, ('$sizebtn').events[0].action.type, ('$sizebtn').events[0].action.src.popupmenu.src].join(" ")')" "actioned json fontsize"
expect_exact "the Font size menu: Default (the setting) ticked, then the sizes" "$(json $ui $sizemenu | head -4)" $'Default (13 pt) | on | fontsize sizes quick default\n-\n10 pt | off | fontsize sizes quick 10\n11 pt | off | fontsize sizes quick 11'
expect_exact "the Font size menu: the default size is ticked too" "$(json $ui $sizeticked)" "Default (13 pt),13 pt"
expect_exact "the Font size menu: every size in NOTE_FONT_SIZES" "$(json $ui $sizemenu | tail -n +3 | cut -d' ' -f1 | tr '\n' ' ')" "10 11 12 13 14 16 18 20 24 28 32 36 48 64 72 96 "
expect "the menu's items run window.js" "$(json $ui '('$sizebtn').events[0].action.src.popupmenu.menu[0].action.src')" "$scripts/window.js"
expect_exact "the font size shortcuts" "$(json $ui 'd.window.root.shortcuts.filter(s => /[=+0-]$/.test(s.shortcut)).map(s => s.shortcut + " " + s.action.args.join(" ")).join(", ")')" "⌘= fontsize sizes quick bigger, ⇧⌘= fontsize sizes quick bigger, ⌘+ fontsize sizes quick bigger, ⌘- fontsize sizes quick smaller, ⌘0 fontsize sizes quick default"
expect_exact "Default shows the font_size setting" "$(json "$(open_note font_size=17 quick sizes)/ui.json" $sizeticked)" "Default (17 pt)"
print -r -- '{"fontSize":24}' > $notes/.scratchnstick/sizes.json
bundle=$(open_note font_size=17 stick sizes)
expect "a note's own size: the editor, the page, the context, and ✓ on it" "$(json $bundle/ui.json ''$editor'.font.size') $(page_note $bundle | json - d.NOTE_FONT_SIZE) $(json $bundle/context.json '[d.ownFontSize, d.defaultFontSize].join(" ")') $(json $bundle/ui.json $sizeticked)" "24 24 24 17 24 pt"
print -r -- '{"fontSize":500}' > $notes/.scratchnstick/sizes.json
expect "a note's own size past the list is brought within it" "$(json "$(open_note stick sizes)/context.json" d.ownFontSize)" "96"
print -r -- '{"fontSize":"big"}' > $notes/.scratchnstick/sizes.json
expect "a note's own size that isn't a number: the default" "$(json "$(open_note font_size=15 stick sizes)/ui.json" ''$editor'.font.size')" "15"
rm $notes/.scratchnstick/sizes.json

bundle=$(open_note stick sizes)
expect "fontsize with no state: nothing, and nothing recorded" "$(window_js fontsize sizes sticky 24) $([[ -e $notes/.scratchnstick/sizes.json ]] && json $notes/.scratchnstick/sizes.json 'd.fontSize || "none"' || print none)" " none"
window_js launched sizes sticky view
picker toggle sizes sticky colour >/dev/null
action=$(window_js fontsize sizes sticky 24)
expect "fontsize: recorded in the sidecar and the window's context" "$(json $notes/.scratchnstick/sizes.json d.fontSize) $(json $bundle/context.json d.ownFontSize)" "24 24"
expect "fontsize: replaces the customise group, whose menu ticks the size" "$(print -r -- $action | json - 'Object.keys(d.replace.ids).join(" ")') $(print -r -- $action | json - $sizeticked)" "customise 24 pt"
expect "fontsize: updates the editor's font, keeping it monospaced" "$(print -r -- $action | json - 'JSON.stringify(d.update.ids.editor)')" '{"font":{"size":24,"monospaced":true}}'
expect "fontsize: closes the open picker" "$(print -r -- $action | json - '[d.update.ids.colourpicker.hidden, d.update.ids.pickercatcher.hidden].join(" ")') $([[ -e $cache/state/sizes.picker ]] && print open || print closed)" "true true closed"
expect "fontsize in View: reloads the page at the new size" "$(print -r -- $action | json - 'd.update.ids.web.src') $(page_note $bundle | json - d.NOTE_FONT_SIZE) $(page_text $bundle)" "file://$bundle/view.html?v=* 24 Sizes"
expect "fontsize bigger: the next size in the list" "$(window_js fontsize sizes sticky bigger | json - d.update.ids.editor.font.size) $(json $notes/.scratchnstick/sizes.json d.fontSize)" "28 28"
expect "fontsize smaller: the one before" "$(window_js fontsize sizes sticky smaller | json - d.update.ids.editor.font.size)" "24"
window_js fontsize sizes sticky 96 >/dev/null
expect "fontsize bigger at the largest size: nothing" "$(window_js fontsize sizes sticky bigger) $(json $notes/.scratchnstick/sizes.json d.fontSize)" " 96"
action=$(window_js fontsize sizes sticky default)
expect_exact "fontsize default: no size of its own, so the setting's, with ✓ on Default" "$(json $notes/.scratchnstick/sizes.json 'String(d.fontSize)') $(json $bundle/context.json 'String(d.ownFontSize)') $(print -r -- $action | json - d.update.ids.editor.font.size) $(print -r -- $action | json - $sizeticked)" "undefined null 13 Default (13 pt),13 pt"
expect "fontsize default again: nothing" "$(window_js fontsize sizes sticky default)" ""
expect "fontsize smaller from the default: the size below it" "$(window_js fontsize sizes sticky smaller | json - d.update.ids.editor.font.size)" "12"
window_js toggle sizes sticky "" >/dev/null
expect "fontsize in Edit: no reload" "$(window_js fontsize sizes sticky 18 | json - '[d.update.ids.editor.font.size, String(d.update.ids.web)].join(" ")')" "18 undefined"
window_js toggle sizes sticky $'Sizes\n' >/dev/null
expect "the switch to View gives the page the new size" "$(page_note $bundle | json - d.NOTE_FONT_SIZE)" "18"
expect "the note's next window has its size" "$(json "$(open_note quick sizes)/ui.json" ''$editor'.font.size')" "18"
expect "fontsize: an unknown size is an error" "$(window_js fontsize sizes sticky huge 2>&1 >/dev/null | grep -c 'Unknown font size')" "1"
window_js quit sizes sticky ""

# Icons.
print -rn -- $'Icons\n' > "$notes/icons.md"
iconbtn=$(byid icon)
ui=$(open_note quick icons)/ui.json
expect_exact "no icon: the icon button is the placeholder button icon, after the colour button" "$(json $ui ''$image'('$iconbtn') + " " + ('$iconbtn').tooltip + " " + ('$customise').components.map(c => c.id).join(",")')" "icons/lucide/smile-plus-light.svg 18x18 Icon (⌘I) colourbox,icon,fontsize"
expect_exact "the actions are button icons too: Edit (the note opens in View), and Stick to the desktop" "$(json $ui '['$actions'.components.map(b => '$image'(b))].join(", ")')" "icons/lucide/pencil-light.svg 18x18,icons/lucide/sticky-note-light.svg 18x18"
expect_exact "every button in the top row is a 22 pt box, so the groups' heights don't change" "$(json $ui '[...new Set(['$customise', '$actions'].flatMap(g => g.components).map(b => JSON.stringify(b.constraints)))].join(" ")')" '{"size":{"width":22,"height":22}}'
note_mode icons edit
expect_exact "the eye is drawn larger than the other button icons, as it looks small" "$(json "$(open_note stick icons)/ui.json" ''$image'(('$actions').components[0])')" "icons/lucide/eye-light.svg 20x20"
note_mode icons view
expect "the icon button and ⌘I run picker.sh toggle icon" "$(json $ui '[('$iconbtn').events[0].action.src].concat(('$iconbtn').events[0].action.args, d.window.root.shortcuts.find(s => s.shortcut === "⌘I").action.args).join(" ")')" "$scripts/picker.sh toggle icons quick icon toggle icons quick icon"
expect "the catcher: hidden, filling the window, a mouse-down running picker.sh close" "$(json $ui '[('$catcher').hidden, ('$catcher').constraints.stretch, ('$catcher').events[0].triggers, ('$catcher').events[0].action.src].concat(('$catcher').events[0].action.args).join(" ")')" "true both mousedown $scripts/picker.sh close icons quick"
expect "the icon picker: a box, 8 pt in and 34 pt down, with its shadow around it" "$(json $ui '[('$iconpickerv').hidden, JSON.stringify(('$iconpickerv').constraints), ('$iconpickerv').components.map(c => c.id).join(","), JSON.stringify(('$iconpickerbox').constraints)].join(" ")')" 'true {"position":"topleft","insets":{"top":26,"left":0},"size":{"width":215,"height":107}} iconpickershadow,iconpickerbox {"position":"topleft","insets":{"top":8,"left":8},"size":{"width":199,"height":91}}'
expect "the drop-down's box: the window's background, rounded, with a hairline border" "$(json $ui '[('$iconpickerbox').background, ('$iconpickerbox').cornerradius, JSON.stringify(('$iconpickerbox').border)].join(" ")')" 'windowBackgroundColor 10 {"width":1,"colour":"separatorColor"}'
expect "the icon picker's shadow is an image its size, which exists" "$(json $ui 'JSON.stringify(('$iconpickerv').components[0].image.size) + " " + ('$iconpickerv').components[0].image.src') $(sips -g pixelWidth -g pixelHeight $workflow/icons/shadow-icon-picker.png | awk '/pixel/ {printf "%s ", $2}')" "{\"width\":215,\"height\":107} $workflow/icons/shadow-icon-picker.png 430 214 "
expect "the drop-downs' buttons have a fixed size, so their boxes' are known" "$(json $ui '[...new Set([('$iconpickerbox'), ('$colourpickerbox')].flatMap(x => x.components).flatMap(r => r.components).map(b => JSON.stringify(b.constraints.size)))].join(" ")')" '{"width":25,"height":25}'
expect "the icon picker: None and the 20 icons, in rows of 7" "$(json $ui '('$iconpickerbox').components.map(r => r.components.length).join(" ")')" "7 7 7"
expect_exact "the icon picker: None first, bordered for a note without an icon" "$(json $ui $buttons | head -1)" "icon-none | true | icons/lucide/ban-light.svg 20x20 | No icon | No icon | icon icons quick none"
expect_exact "the icon picker: an icon's button icon, light without a theme, at 20 pt" "$(json $ui $buttons | sed -n 2p)" "icon-sticky-note | false | icons/lucide/sticky-note-light.svg 20x20 | Note | Note | icon icons quick sticky-note"
expect_exact "the icon picker: the icons in order, none of them bordered" "$(json $ui $buttons | tail -n +2 | cut -d'|' -f1,2 | tr -d ' ' | tr '\n' ' ')" "icon-sticky-note|false icon-list-todo|false icon-shopping-cart|false icon-lightbulb|false icon-book-open|false icon-bookmark|false icon-briefcase|false icon-calendar|false icon-phone|false icon-users|false icon-house|false icon-utensils|false icon-plane|false icon-gift|false icon-wallet|false icon-code|false icon-music|false icon-heart|false icon-star|false icon-flag|false "
expect "every file the window names exists" "$(missing_files $ui)" ""
expect "no icon: a sticky window's app icon is Scratch'n'Stick's" "$(json "$(open_note stick icons)/ui.json" d.iconpath)" "$workflow/ui/appicon.png"

# The quick view's button icons follow the appearance Alfred gives its window: a
# theme's own appearanceMode, or else its background colour. Sticky windows are
# always light.
mkdir -p $tmp/prefs/themes/light2dark $tmp/prefs/themes/dark2light $tmp/prefs/themes/plain
print -r -- '{"alfredtheme":{"appearanceMode":2,"window":{"color":"#FFFFFF0A"}}}' > $tmp/prefs/themes/light2dark/theme.json
print -r -- '{"alfredtheme":{"appearanceMode":1,"window":{"color":"#101010FF"}}}' > $tmp/prefs/themes/dark2light/theme.json
print -r -- '{"alfredtheme":{"window":{"color":"#101010FF"}}}' > $tmp/prefs/themes/plain/theme.json
appearance_of() { json "$(open_note "$@" quick icons)/context.json" d.appearance }
expect "button icons: a dark theme colour" "$(appearance_of alfred_theme_background='rgba(16,16,16,1.00)')" "dark"
expect "button icons: a light theme colour" "$(appearance_of alfred_theme_background='rgba(237,237,237,1.00)')" "light"
expect "button icons: a theme's appearanceMode 2 wins over a light colour" "$(appearance_of alfred_preferences=$tmp/prefs alfred_theme=light2dark alfred_theme_background='rgba(255,255,255,0.04)')" "dark"
expect "button icons: a theme's appearanceMode 1 wins over a dark colour" "$(appearance_of alfred_preferences=$tmp/prefs alfred_theme=dark2light alfred_theme_background='rgba(16,16,16,1.00)')" "light"
expect "button icons: a theme without one goes by its colour" "$(appearance_of alfred_preferences=$tmp/prefs alfred_theme=plain alfred_theme_background='rgba(16,16,16,1.00)')" "dark"
expect "button icons: a missing theme goes by its colour" "$(appearance_of alfred_preferences=$tmp/prefs alfred_theme=gone alfred_theme_background='rgba(16,16,16,1.00)')" "dark"
expect "button icons: the dark button icons in a dark quick view's picker" "$(json $cache/quick/icons.alfredui/ui.json $buttons | sed -n 2p | cut -d'|' -f3)" " icons/lucide/sticky-note-dark.svg 20x20 "
expect "button icons: a sticky window's are light, whatever the theme" "$(json "$(open_note alfred_theme_background='rgba(16,16,16,1.00)' stick icons)/context.json" d.appearance)" "light"

# Opening and closing the drop-downs, and choosing an icon.
bundle=$cache/windows/icons.alfredui
expect "picker with no state: nothing; Esc closes the window" "$(picker toggle icons sticky icon)|$(picker close icons sticky)|$(picker escape icons sticky)" '||{"finish":{}}'
expect "icon with no state: nothing, and nothing recorded" "$(window_js icon icons sticky star) $([[ -e $notes/.scratchnstick/icons.json ]] && json $notes/.scratchnstick/icons.json 'd.icon || "none"' || print none)" " none"
window_js launched icons sticky edit
expect_exact "toggle icon: shows the icon picker and the catcher" "$(picker toggle icons sticky icon) $(<$cache/state/icons.picker)" "$OPEN_ICON icon"
expect_exact "toggle colour with the icon picker open: switches to the colour picker" "$(picker toggle icons sticky colour) $(<$cache/state/icons.picker)" "$OPEN_COLOUR colour"
expect_exact "toggle colour again: closes it" "$(picker toggle icons sticky colour) $([[ -e $cache/state/icons.picker ]] && print open || print closed)" "$CLOSED closed"
picker toggle icons sticky icon >/dev/null
expect_exact "a click elsewhere (the catcher): closes the open picker" "$(picker close icons sticky) $([[ -e $cache/state/icons.picker ]] && print open || print closed)" "$CLOSED closed"
expect_exact "a click elsewhere with none open: nothing" "$(picker close icons sticky)" ""
picker toggle icons sticky icon >/dev/null
expect_exact "Esc with a picker open: closes it, not the window" "$(picker escape icons sticky)" "$CLOSED"
expect_exact "Esc with none open: closes the window" "$(picker escape icons sticky)" '{"finish":{}}'
expect "picker with another form's state: nothing" "$(picker toggle icons quick icon)" ""
expect "picker toggle without a picker's name: an error" "$(picker toggle icons sticky || print failed $?)" "failed 1"
picker toggle icons sticky icon >/dev/null
action=$(window_js icon icons sticky shopping-cart)
expect "icon: every file the replace names exists" "$(print -r -- $action | missing_files -)" ""
expect "icon: recorded in the sidecar and the window's context" "$(json $notes/.scratchnstick/icons.json d.icon) $(json $bundle/context.json d.icon)" "shopping-cart shopping-cart"
expect "icon: replaces the customise group and the icon picker, and hides the rest" "$(print -r -- $action | json - 'Object.keys(d.replace.ids).join(" ") + " " + JSON.stringify(d.update.ids)')" 'customise iconpicker {"colourpicker":{"hidden":true},"pickercatcher":{"hidden":true}}'
expect "icon: the icon button shows its button icon, light in a sticky window" "$(print -r -- $action | json - ''$image'('$iconbtn')')" "icons/lucide/shopping-cart-light.svg 18x18"
expect "icon: the icon picker marks it, and comes back hidden" "$(print -r -- $action | json - 'd.replace.ids.iconpicker.hidden') $(print -r -- $action | json - $buttons | grep '| true |' | cut -d'|' -f1)" "true icon-shopping-cart "
expect "icon: the picker closed in the state" "$([[ -e $cache/state/icons.picker ]] && print open || print closed)" "closed"
expect "icon: the window's actions make no badge (only open.js does, for the app icon)" "$(ls $cache/icons 2>/dev/null | grep -c badge-shopping-cart || true)" "0"
expect "icon: the next sticky window's app icon is its badge in its colour, made in the cache" "$(json "$(open_note stick icons)/ui.json" d.iconpath)" "$cache/icons/badge-shopping-cart-FEF49C-DBC503-1.72.0-*.svg"
expect "icon: the next window's icon button and picker show it" "$(json $bundle/ui.json ''$image'('$iconbtn')') $(json $bundle/ui.json $buttons | grep -c 'icon-shopping-cart | true')" "icons/lucide/shopping-cart-light.svg 18x18 1"
expect "every file the sticky window names exists, its badge too" "$(missing_files $bundle/ui.json)" ""
expect "colour: the customise group keeps the icon" "$(window_js colour icons sticky green | json - ''$image'('$iconbtn')')" "icons/lucide/shopping-cart-light.svg 18x18"
expect "colour: makes no badge in the new colour" "$(ls $cache/icons | grep -c 'badge-shopping-cart-B2FFA1' || true)" "0"
expect "icon: an unknown icon is an error, and nothing changes" "$(window_js icon icons sticky rocket 2>&1 >/dev/null | grep -c 'Unknown icon') $(json $notes/.scratchnstick/icons.json d.icon)" "1 shopping-cart"
# In View, as in Edit.
window_js toggle icons sticky "Icons" >/dev/null
expect_exact "toggle icon in View: shows it, leaving the page as it is" "$(picker toggle icons sticky icon)" "$OPEN_ICON"
action=$(window_js icon icons sticky none)
expect "icon none: removes the key, keeping the others" "$(json $notes/.scratchnstick/icons.json '[String(d.icon), "icon" in d, d.colour].join(" ")') $(json $bundle/context.json 'String(d.icon)')" "undefined false green null"
expect "icon none: the placeholder, and None marked" "$(print -r -- $action | json - ''$image'('$iconbtn')') $(print -r -- $action | json - $buttons | head -1 | cut -d'|' -f2)" "icons/lucide/smile-plus-light.svg 18x18  true "
picker toggle icons sticky colour >/dev/null
expect "the Edit / View switch closes the open picker" "$(window_js toggle icons sticky "" | json - '[d.update.ids.iconpicker.hidden, d.update.ids.colourpicker.hidden, d.update.ids.pickercatcher.hidden].join(" ")') $([[ -e $cache/state/icons.picker ]] && print open || print closed)" "true true true closed"
expect "a switch with none open leaves them alone" "$(window_js toggle icons sticky "Icons" | json - 'String(d.update.ids.pickercatcher)')" "undefined"
picker toggle icons sticky icon >/dev/null
window_js quit icons sticky ""
expect "quit removes the picker file" "$(ls $cache/state | grep -c '^icons\.' || true)" "0"
print -rn -- icon > $cache/state/icons.picker
window_js launched icons quick view >/dev/null
expect "launched clears a picker left open (a killed window)" "$([[ -e $cache/state/icons.picker ]] && print open || print closed)" "closed"
expect_exact "toggle in a quick view" "$(picker toggle icons quick icon)" "$OPEN_ICON"
window_js quit icons quick ""
new=$(basename "$(open_note new=1 quick '')" .alfredui)
window_js launched "$new" quick edit
window_js icon "$new" quick heart >/dev/null
expect "icon on a new note before it's saved: recorded" "$(json $notes/.scratchnstick/$new.json d.icon)" "heart"
window_js quit "$new" quick ""
expect "a new note with an icon closed blank: its sidecar goes too" "$(ls -A $notes/.scratchnstick | grep -c $new || true)" "0"

# macOS 12 can't read the button icons and badges (SVGs), so its windows have
# no note icons: no icon button, icon picker or ⌘I, the actions as SF Symbols,
# and Scratch'n'Stick's app icon. A note's icon stays in its sidecar.
print -r -- '{"icon":"heart"}' > $notes/.scratchnstick/icons.json
bundle=$(open_note scratchnstick_macos_version=12 quick icons)
ui=$bundle/ui.json
expect "macOS 12: no icon button or icon picker; the colour picker and the catcher stay" "$(json $ui $ids)" "note:view content:view page:view web:webkitview editor:textarea pickercatcher:view colourpicker:view colourpickershadow:imageview colourpickerbox:view colourmark-yellow:view colour-yellow:button * customise:view colourbox:view colour:button fontsize:button actions:view toggle:button stick:button"
expect "macOS 12: no ⌘I" "$(json $ui 'd.window.root.shortcuts.map(s => s.shortcut).join(" ")')" "⌘E ⌘↩ ⌘P ⌘1 ⌘2 ⌘3 ⌘4 ⌘5 ⌘6 ⌘= ⇧⌘= ⌘+ ⌘- ⌘0"
expect_exact "macOS 12: the actions and the Font size button are SF Symbols" "$(json $ui '['$actions'.components.map(b => '$image'(b)), '$image'('$sizebtn')].join(", ")')" "symbol pencil,symbol note.text, symbol textformat.size"
expect "macOS 12: the context says so, without the note's icon" "$(json $bundle/context.json '[d.icons, d.icon].join(" ")')" "false "
expect "macOS 12: no SVG at all, and every file it names exists" "$(grep -c '\.svg' $ui || true) $(missing_files $ui)" "0 "
bundle=$(open_note scratchnstick_macos_version=12 stick icons)
ui=$bundle/ui.json
expect "macOS 12, sticky: Scratch'n'Stick's app icon, though the note has an icon" "$(json $ui d.iconpath)" "$workflow/ui/appicon.png"
expect_exact "macOS 12, sticky: the close button is an SF Symbol" "$(json $ui ''$image'('$closebtn')')" "symbol xmark.circle.fill"
window_js launched icons sticky view
action=$(window_js colour icons sticky blue)
expect "macOS 12: a colour change gives no icon button, and keeps the icon in the sidecar" "$(print -r -- $action | json - '('$customise').components.map(c => c.id).join(",")') $(json $notes/.scratchnstick/icons.json '[d.icon, d.colour].join(" ")')" "colourbox,fontsize heart blue"
expect "macOS 12: switching to Edit gives the symbol" "$(window_js toggle icons sticky "" | json - '[d.update.ids.toggle.image.type, d.update.ids.toggle.image.src].join(" ")')" "symbol eye"
expect_exact "macOS 12: picker.sh still opens the colour picker" "$(picker toggle icons sticky colour)" "$OPEN_COLOUR"
window_js quit icons sticky $'Icons\n'
rm $notes/.scratchnstick/icons.json

# Sticky windows.
mkdir -p $cache/state && print -r -- '{"form":"sticky","pid":'$$',"mode":"edit"}' > $cache/state/vars.json
expect "a sticky state whose process isn't Alfred UI doesn't count" "$(open_note quick vars)" "$cache/quick/vars.alfredui"
expect "stick_note: sticks the note it names, ignoring new" "$(open_note new=1 stick_note="v{${wj}var:x}" stick 'ignored' 2>&1 | tail -1)" "$cache/windows/v{var:x}.alfredui"

print
if (( failures )); then print "FAILED: $failures"; exit 1; else print "All passed"; fi
