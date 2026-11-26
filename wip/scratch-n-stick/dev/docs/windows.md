# Note windows

How a note's window is opened, built and kept: its two forms, the generated bundles, window state, sticking, saving and window positions. Part of Scratch'n'Stick's [developer notes](../../DEVELOPMENT.md). What's in the window is in [Window layout and controls](window-ui.md) and [Preview](view-mode.md).

## Quick views and sticky notes

Every note window is an Alfred UI, and the same kind of bundle can be opened in two ways, so a note has two forms:

- **Quick view**: ↩ on a note opens it inside Alfred's window ("Open within Alfred"), for a quick read or edit. It runs in Alfred's own process, has no ⌘-Tab entry, and goes when Alfred closes. The view replaces the results from one frame to the next, so it feels part of Alfred.
- **Sticky note**: ⌘↩ on a note, or Stick to the desktop (⌘D, or its button) in the quick view, opens the note as its own window on the desktop (launched externally), in its own process of Alfred's `Alfred UI.app` helper, with its own saved position.

A note is never open in both forms: ↩ on a sticky note brings its window to the front instead of opening a quick view.

### Why two forms

Each externally launched Alfred UI is a separate helper process with exactly one window, and nothing in Alfred UI can open a second window in a process or change how the process shows in ⌘-Tab and the Dock (a process can only change its own presentation, and the helper is Alfred's signed app). So every sticky note is its own ⌘-Tab and Dock entry, labelled "Alfred UI", and costs about 50 MB. The options were to accept it, to show many notes in one window (no sticky notes), to write a native Swift app (much more code, and a signed, notarised binary), or to ask Alfred for help. The workflow accepts it for the notes deliberately stuck to the desktop, and keeps everything else in the quick view. Sticky windows are titled with the note's title, so they can be told apart in window switchers; their app icon is the workflow's (`ui/appicon.png`), as Alfred UI sets it only at launch and a note's colour and icon can change while it's open (see [Colours and icons](colours-and-icons.md#the-images)). The Alfred requests for several windows per process and for keeping a UI out of ⌘-Tab and the Dock are filed in [Alfred requests](../../../../Alfred%20requests.md#alfred-ui-several-windows-in-one-ui-process); a native app is in reserve.

Sticky notes don't float above other apps' windows: Alfred UI can't do that (also filed in Alfred requests), so they're ordinary windows, and the user guide doesn't promise that they stay on top.

## The routes

The Alfred objects (see also [Results and new notes](results.md)):

- **↩ in the results list or a new-note keyword** goes straight to the quick view's Alfred UI object (Open within Alfred), whose path is `{query}`: the result's arg, its quick bundle. Nothing may sit between them; see [Seamless quick views](#seamless-quick-views).
- **↩ on a sticky note** has no arg, and sets `sticky` = `1` and `stick_note` = its ID. The Script Filter's ↩ has a second connection to a Conditional that goes on only when `sticky` is `1`, to the stick route. The Alfred UI object, given an empty path, shows nothing.
- **The stick route** is the Run Script `./scripts/open.js stick "$1"` (an inline one-liner, as an external script can't take a fixed first argument), then a Conditional that goes on only when `open_window` is `1`, then the sticky Alfred UI object (Launch Externally). `open.js` sets `open_window` only when it wrote a bundle to open; when the note already has a live sticky window, it activates that instead. ⌘↩ in the lists, the new sticky note keyword, the New sticky note Universal Action and the new-note hotkey all lead here.
- **The quick view's Alfred UI object** is connected on to the stick route, so a quick view that finishes with the variable `stick_note` set (Stick to the desktop) carries on there once it has closed. No AppleEvent is sent, so nothing can deadlock Alfred, and macOS asks for no permission. A quick view's Close sets `close_view`, so `open.js` opens nothing.

`open.js` sticks a note: it checks for a notes folder move and the palette, guards against a second window, writes the sticky bundle, saves a new note's starting text, and starts the window placement (below). `open.js quick` writes a quick bundle as `list.js` does, for the New scratch note Universal Action and for tests.

## Bundles

Each note opens from a bundle generated for it:

- `$alfred_workflow_cache/quick/<id>.alfredui` for its quick view, written by `list.js` (or `new.js`) when out of date;
- `$alfred_workflow_cache/windows/<id>.alfredui` for its sticky window, rewritten by `open.js` every time it's stuck, and kept after the window closes only so its path, and with it the window's saved position, stays the same.

The separate folders mean `list.js` never rewrites an open sticky window's bundle. Both are deleted when the note is (deleted for being empty, or trashed).

Generated bundles, rather than one shared bundle with the note passed in variables: some window settings need real JSON types (the font size is a number), and variables reach a UI only as strings, which Alfred ignores there. A `{file:…}` placeholder can insert typed JSON, but its path can't contain a placeholder, so it can't be per note. And AppKit saves a window's position per bundle path, so each note needs its own path anyway.

A bundle holds:

- `ui.json`, built by `noteWindowUi` from the templates in `ui/` (below), with the note's text, its title as the window `title`, colour, icon, font size, form and mode. Text, title and ID are escaped (see [Placeholders in a note's text](#placeholders-in-a-notes-text)).
- `context.json`: what the window's scripts need and don't get from Alfred, as an Alfred UI's scripts get only the `alfred_*` variables, not User Configuration: the notes folder, the palette and the note's colour slot, its icon, its own font size and the setting's, the button icons' appearance, whether collapsed, and `textHash`, the hash of the text the window was given (for `launched`'s and `tick`'s checks). `updateNoteContext` merges changes into it, so parts the window's scripts build later match. A changed setting reaches a window the next time it opens.
- The page, `view.html` and `note.js` (see [Preview](view-mode.md)).

A bundle's actions run `scripts/window.js` by its absolute path, with the note ID and the form as arguments.

`writeNoteWindow({ store, workflowFolder, id, form, note, text, mode })` builds and writes a bundle. Other functions: `noteWindowPart`, `findNoteComponent`, `noteWindowOptions` (options from an open window's context), `writeNoteBundle`, `readNoteContext`, `removeNoteBundle`, `noteBundlePath`, `noteWindowsFolder`, `textHash`.

### Templates

The `ui/` files are `ui.json` as Alfred UI reads it, with directives that `resolveNoteTemplate` resolves and removes, so one set of files covers both forms, both modes, a collapsed window and macOS 12:

- `"@form": "quick"` or `"sticky"`, `"@mode": "edit"` or `"view"`, and `"@needs": "icons"` on an array element keep it only in that form, mode, or a window that can show note icons (not macOS 12).
- `"@quick"`, `"@sticky"`, `"@edit"`, `"@view"` and `"@collapsed"` hold properties merged into their object in that form, mode, or a collapsed sticky window.
- A string that's a whole token (`"@text"`, `"@title"`, `"@tint"`, `"@swatch"`, `"@fontSize"`, `"@iconPath"`, `"@buttonIcon:<name>"`, `"@dropdowns"`, the layout tokens from `NOTE_WINDOW_LAYOUT`, and others; see `noteWindowTokens`) becomes its value, typed (a font size is a number, a place an object), except in `args`, where it's a string. An array element whose token's value is an array is replaced by its elements: `window.json`'s shortcuts end with `"@colourShortcuts"` and `"@fontSizeShortcuts"`, and `content.json`'s components include `"@dropdowns"`.
- `{ "id": "<part>" }` placeholders in `window.json` are filled with the template of that name (`NOTE_WINDOW_PARTS`: `content`, `keyhints`, `customise`, `actions`, `collapsedtitle`, `titlestrip`, `windowbuttons`, `menubutton`). Scripts replace a part with a fresh copy of the same template (`noteWindowPart`), such as the `customise` group after a colour change.
- An action's `"src": "scripts/…"` becomes an absolute path, as the bundle isn't in the workflow folder.

## Window state

Variable persistence (`persist`) is keyed on a UI's `bundleid`, so all windows would share it. Each window's state is instead a file keyed by note ID, `$alfred_workflow_cache/state/<id>.json`: its form, PID, mode, and whether it's collapsed (sticky). `launched` writes it (the PID is `window.js`'s parent: the helper's when sticky, Alfred's when quick), the mode switch and collapsing update it, and `quit` removes it. `<id>.picker` beside it exists while a drop-down is open (see [Drop-downs](window-ui.md#drop-downs)).

A note is sticky only when its state's form is `sticky` and the PID is still an Alfred UI helper (`stickyNotePid`); a quick view's PID is Alfred's, which is always alive. `stickyNoteIds()` lists them, for the lists. A `quit` without a state (its `launched` failed) saves only non-blank text.

Opening a note that has a live sticky window brings that window to the front instead of opening a second one: two queued Sticks once opened two windows for a note, and once none, so the guard is needed.

`activateWindowProcess(pid)` brings a sticky window to the front and closes Alfred's window. Activating the window's process is enough when another app is in front, but Alfred's window opens without making Alfred active, so when the note's own window was already in front, activating it changed nothing and Alfred stayed open. So it activates Alfred first, waits until Alfred is active (about 7 ms), then the note, but only while Alfred has a window on screen: with Alfred's window already closed, doing so could leave a third app in front. Accessibility calls (`AXFrontmost`, `AXRaise` and the like) all succeed but leave Alfred's window open. `activateWindowProcesses(pids)` does several in order, each once the one before is active.

`closeStickyNoteWindow(id)` force-quits a window's process, so its `quit` doesn't run and nothing writes the note back; `trash.js` uses it before trashing a sticky note. `quitStickyNoteWindows` asks windows to quit normally, so they save (the sticky notes list's Close, and moving the notes folder).

## Seamless quick views

Alfred replaces the results with a quick view from one frame to the next only when the Script Filter connects straight to the Alfred UI object. With anything in between, even a Run Script that only echoes or a Conditional, Alfred hides its whole window on ↩ and fades the view in over about 170 ms, after 170–200 ms of nothing. Filling an empty view from its `launched` script pops the text in about 100 ms late. So each note's quick bundle, with its text, has to exist before ↩: `list.js` writes them (`quickWindows` in `lib.js`), and each result's arg is its bundle's path.

- **Fingerprints.** A bundle is rebuilt only when its fingerprint changes: a hash of the note's text, mode, colour, icon and own font size, the font size setting, the palette, the button icons' appearance (from Alfred's theme), whether the Mac can show note icons, the notes and workflow folders, and the modification times of the template sources (`NOTE_WINDOW_SOURCES`: the `ui/` files, `lib.js`, `text-rules.js`). The fingerprints are in `quick/.index.json`, read once per run. So most keystrokes rebuild nothing, an edited note's next list rebuilds its bundle, and a workflow update or changed setting rebuilds every bundle once. Images aren't in it: a bundle names them by path and Alfred UI reads them when the window opens.
- **Speed.** With 300 notes, a run with nothing to rebuild takes about 0.2 s, mostly reading the notes; rebuilding all of them about 1.5 s, about 5 ms a bundle. Variables and the bundle folder are read once per run (per note through the ObjC bridge added 0.1 s). Reading the templates once per run, rather than per bundle, would save about 0.2 s of a full rebuild.
- **Clean-up.** Each run removes the quick bundles of notes that have gone and of New notes that were offered and never opened, keeping any that's open (has a state).
- **New note.** `list.js` picks the new note's ID (the time) and writes its bundle with the query as its text each time it shows the result; within one second it's the same ID and bundle.
- **A note changed since the list.** The view's `launched` compares the note with its bundle's `textHash`, and if the note changed in between (an edit elsewhere between the list and ↩), gives the window the note as it is now (an `update` of the editor's text in Edit, a page reload in Preview), so a stale text can never be saved back over it.
- **A note stuck since the list.** Its quick view still opens, then hands over: `launched` finishes as Stick to the desktop does, with `stick_note`, so Alfred carries on to the stick route. It records no state, and its `quit` sees the sticky window's state and leaves everything alone. The quick view shows for about 130 ms.

## Sticking from a quick view

Stick to the desktop runs `window.js stick`, which saves the editor's text and prints a `finish` with the variables `stick_note` (the ID) and `stick_mode` (the view's mode, which the sticky window opens in). It has to save first: Alfred runs the stick route without waiting for the view's `quit`, so `open.js` could read the note before `quit` saved it, and a new note with text not yet typed in (from a Universal Action, or New note with a query) opened blank, and closing that window then deleted the note.

## Saving from a window

- The editor's `typingstopped` event runs `window.js save` with the text (`{value:editor.text}`), about a second after typing stops, and `quit` saves once more. The actions aren't `async`, so they run in order and an earlier save can't overtake the `quit` save.
- Both save only while the window's state says Edit (`isEditorText`). In Preview the hidden editor holds the text it last showed, which ticks may since have changed on disk; and a late `typingstopped` after a switch to Preview must not write stale or empty text.
- `quit` fires however a window closes (close button, ⌘W, Esc, sticking, and for a quick view Alfred closing), but not when its process is killed.
- Switching to Preview saves and reloads the page with the saved text; ticking a task box edits the file (see [Preview](view-mode.md#ticking-task-boxes)).
- A note whose text is blank when its window closes is deleted, with its bundles (see [Storage](storage.md#empty-notes)).

Inside a quick view the scripts run synchronously in Alfred's process, so typing pauses run a save inside Alfred; this felt fine in use.

## Placeholders in a note's text

Alfred UI expands `{var:…}` and `{const:…}` in every string it's given, and `{value:…}` and `{data:…}` in action arguments (see [Alfred UI](alfred-ui.md#placeholders)). So a note containing `{var:x}` would lose it in its window, and the next save would write the note back without it. Text coming out of a window is safe.

So everything put into a window from a note (its text, title and ID, and user text such as a palette slot's name) has a word joiner (U+2060) inserted after the `{` of each `{var:`, `{const:`, `{value:` and `{data:` (`escapeForAlfredUi`), which stops the match and is invisible. It comes back in the editor's text, and `window.js` removes it from exactly those places before saving (`unescapeFromAlfredUi`). The cost, only in notes containing these strings: the caret steps over an invisible character there, and text copied from the editor includes it. The page isn't affected: the note reaches it through `note.js`, not `ui.json`.

## Window positions

Each sticky window keeps its own position because AppKit saves a window's frame under its bundle's path (`frameautosave`; see [Alfred UI](alfred-ui.md#window-frames)), and each note has its own bundle path.

AppKit restores a saved frame only on the active screen: a note left on one display reopened, moved, on whichever display was active. So `open.js` reads the window's saved frame before it opens (`startStickyWindowPlacement` in `lib.js`). If the frame's screen is still connected (one of the screens holds the saved screen's visible frame and the window's centre; `stickyWindowRestorePoint`), it starts `scripts/place.js` in the background with the bundle's path and the top left the window belongs at. `place.js` leaves its process group (as `move.js` does), finds the Alfred UI process launched with that path (`ps`), waits up to 10 s for its window, and if it isn't at that top left, moves it there through the Accessibility API, checking again up to five times while AppKit may still be placing it. AppKit then saves the moved frame. A window restored exactly is left alone, and so is one whose screen has gone or moved.

It works only because a script Alfred starts has Alfred's Accessibility permission; the window's own scripts, run by Alfred UI, don't. Without the permission, `place.js` does nothing. The window shows on the active screen for about 0.1 s before it moves. An Alfred request for Alfred UI to restore the frame on its saved screen itself is filed in [Alfred requests](../../../../Alfred%20requests.md#alfred-ui-reopen-a-window-on-the-screen-it-was-saved-on).

`place.js` doesn't load `lib.js`. JXA can't build the pointer `AXValueCreate` reads a `CGPoint` from; `NSValue`'s `getValue:size:` into an `NSMutableData`'s `mutableBytes` works, as it does for `CC_SHA1`'s buffers.

## Changes made elsewhere

A note's window doesn't notice its file changing on disk (another editor, a sync), so its next save overwrites that change; Preview's ticks check the text first and refuse a stale tick (see [Preview](view-mode.md#ticking-task-boxes)). ⌥↩ in the results closes a sticky note's window itself before trashing it, but a note deleted by anything else leaves its window open, and closing it writes the note back.

Reloading and closing the window when its file changes or goes is [planned](planned.md#changes-made-elsewhere).
