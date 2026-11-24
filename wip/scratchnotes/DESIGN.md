# ScratchNotes design

Working design for ScratchNotes: quick scratch notes, each a Markdown file, listed in Alfred and opened in their own small Alfred UI windows, like sticky notes on the desktop.

Every item is marked with its status:

- **Decided**: agreed, build to it.
- **Proposed**: the current idea, not agreed yet.
- **Open**: a question still to answer, possibly with options.
- **To test**: depends on Alfred behaviour that isn't documented; needs an experiment.

## Goals

- Any number of notes, each a plain `.md` file, in the workflow's data folder or a folder the user chooses. **Decided**
- An Alfred results list of the notes, with a preview and when each was last edited; actioning one opens it in its own window. **Decided**
- One window per note, so several notes can be open at once, arranged around the desktop like sticky notes. **Decided** (feasibility tested, see [Multiple windows](#multiple-windows))
- Notes are edited as Markdown, with a toggle between editing the source and viewing it rendered. **Decided**
- Each note has its own colour, shown in its window and in the results list. **Decided**
- New notes from a keyword, from the results list, and from a Universal Action on text. **Decided**

## Storage

### Notes folder

- One `.md` file per note, in a notes folder. **Decided**
- By default the notes folder is `notes/` in the workflow's data folder (`$alfred_workflow_data/notes/`), created on first use. The data folder, not the cache, which Alfred or a cleaning app may empty; a subfolder, so the notes are kept apart from anything else the workflow stores there. Notes only go somewhere permanent and visible if the user sets the `notes_folder` preference. A configured folder is created if missing, but only if its parent exists, so a folder on an unmounted volume isn't recreated on the startup disk. **Decided**
- The notes are the files directly in the folder whose names end in `.md`, in any case (`.MD` too), and don't start with `.`. Subfolders, hidden files (including temporary save files) and other files are ignored. **Decided**
- When `notes_folder` changes, the notes move to the new folder without asking, so the change is seamless. **Decided**. Which files move is **Open**, on hold: there are many cases to think through, such as a folder of the user's own (an Obsidian vault, say) whose other `.md` files would count as notes. The moving code waits for that; until it's written, changing the folder leaves the notes in the old one.

### Filenames

- Filenames are stable IDs, never derived from the content, so a file isn't renamed while a window has it open. A note's ID is its filename without `.md`, so a file added by hand (`shopping.md`) is a note too, with its own name as its ID. **Decided**
- New notes are named for their creation time in local time, `YYYYMMDD-HHMMSS.md` (e.g. `20261120-153012.md`), with `-2`, `-3`… added if the ID is taken. Sorts by creation in Finder. An ID is taken if its note or its metadata sidecar exists (a trashed note keeps its sidecar), or if the caller says so, which lets new notes that are open but not yet saved count (see [lib.js](#libjs)). **Decided**

### Metadata

- Per-note metadata, such as the colour and creation time, is kept in a hidden JSON sidecar per note, `.scratchnotes/<id>.json` in the notes folder, rather than as YAML front matter in the note. **Decided**
  - Each `.md` stays plain Markdown, which can be moved, exported or opened in any app without a block of YAML at the top, and the editor's text is the whole file, with nothing to remove and put back.
  - Changing a note's colour doesn't rewrite the note, so it doesn't change its modification time and move it to the top of "last edited".
  - Sidecars stay with the notes when the whole folder is synced or copied, but a note moved or renamed on its own loses its metadata (it gets the default colour). Front matter was chosen first so metadata would travel with each note; with the notes in the workflow's data folder by default, that matters less than the above.
  - A hidden folder adds one hidden item to the notes folder, rather than a file per note beside each note.
- A sidecar holds a JSON object, merged on write: keys being set are replaced, keys set to null are removed, and every other key is kept as it is, including ones from other versions or tools. An unreadable sidecar, or one that isn't a JSON object, reads as empty. A sidecar is only written once there's something to store, and removed when its last key is. **Decided**
- Every note in the notes folder is used, with or without a sidecar, so `.md` files added by hand or by other apps are notes too. A note without a sidecar is given one the first time it's read or listed, recording the file's birth time as `created`. A sidecar that exists but can't be read is left alone rather than overwritten. This applies in any notes folder, including one of the user's own, so "has a sidecar" doesn't mark the notes ScratchNotes made. **Decided**
- Moving a note to the Trash leaves its sidecar in place, so a note that's put back keeps its colour. TO-DO: a sweep for sidecars whose notes have been gone a long time (each is a few hundred bytes).
- Notes from other apps may start with YAML front matter. It's left in the text, but skipped when working out the title and preview.

```json
{
  "created": "2026-11-20T15:30:12+13:00",
  "colour": "yellow"
}
```

### Title, timestamps, empty notes

- The title is the note's first line that has any text once Markdown markers are removed: heading `#`s, `>` quotes, list bullets and numbers, task boxes, and inline emphasis, code and link syntax (a link becomes its text). Code fence lines, thematic breaks and setext underlines are skipped. "Untitled" if nothing is left. The preview is the following lines, cleaned the same way and joined: " | " before a heading, ": " after one, ", " between list items, and a space between other lines (`# Shopping` / `- milk` / `- eggs` gives "Shopping" and "milk, eggs"; `## Team meeting` / `### Decisions` / `- Ship on Friday` / `- Stand-up at 9:30` / `### Actions` / `- Release notes` gives "Team meeting" and "Decisions: Ship on Friday, Stand-up at 9:30 | Actions: Release notes"). Only `#` headings count, since a setext heading's text comes before its underline. Both are truncated on whole characters (an emoji with modifiers, a flag, or a letter with combining accents counts as one, and is never split), with "…": the title at 80 characters and the preview at 100. **Decided**
- "Created" is recorded in the note's sidecar (`created`, ISO 8601 in local time with its UTC offset) when the note is first saved, or, for a note added by hand, first read or listed (the file's birth time then), so it never changes, whatever happens to the file. "Last edited" is the file's modification time. **Decided**
- Saves are atomic, keep the file's birth time and Finder tags, and skip writing when the text hasn't changed (see [Saving](#saving)), so opening and closing a note doesn't change its "last edited". **Decided**
- A note is empty when its text is only whitespace, whatever its sidecar holds. A new note isn't written to disk until its text isn't blank. Saving blank text over an existing note writes it, so deleting everything and typing again keeps the note's file and sidecar. A note that's empty when its window closes is deleted outright with its sidecar (not through the Trash: there's nothing to recover), so abandoned new notes leave no files. **Decided**

## Colour

- Each note has a colour, stored in its metadata sidecar (see [Metadata](#metadata)). **Decided**
- Colours are a fixed, named palette of about 6–8 (e.g. yellow, orange, pink, purple, blue, green, grey), picked from a `picker` or a button with a `menu`, and stored by name (`"colour": "yellow"`). **Decided**
  - Each name maps to one tint, defined in one place, so the palette can be re-tuned without rewriting notes.
  - The workflow ships one pre-made dot icon per colour for the results list.
  - A missing or unknown colour name gets the default colour (see [Configuration](#configuration)).
  - Free choice (hex) was rejected: Alfred UI has no colour well component, so it would need `opendialog`-style workarounds or a `webkitview` (unproven), icons generated on demand, and tints derived from arbitrary hex values to stay readable.
- The colour tints the whole window, text area included, like a sticky note: the root view's `background` is the tint, and the `textarea` and `markdownarea` have `background: null`, so it shows through them. Tested inside Alfred and in a pinned window, with solid (`#FFF3B0`), translucent (`#FFCC0033`, `#FFCC0066`) and macOS (`systemYellowColor`, `yellowColor`) colours, all readable in light appearance. **Decided**
- A note looks the same in light and dark appearance, like Apple's Stickies: its pale tint stays, and its text is always dark, set with `colour` on the `textarea` and `markdownarea`. The default text colour follows the appearance, so without this, dark mode gives white text on the pale tint, which is unreadable (tested). **Decided**
  - Only macOS's named colours adapt to the appearance by themselves; hex, `rgb()`, `hsv()` and `ui.json`'s `colours` constants are fixed. Adaptive notes would need either a light and a dark tint per colour, chosen by the script that opens the window (so an open window keeps its tint until reopened), or a translucent tint that suits both.
  - TO-DO: dark-appearance variants of the palette, in a later version.
  - Tested in dark appearance with a pale tint and `colour: "#1D1D1F"` on both: the editor and the rendered view stayed dark and readable across seven pale hues (`#FFF3B0`, `#FFD6E0`, `#D6E9FF`, `#D9F2D0`, `#E8DDF7`, `#FFE2C2`, `#E6E6E6`). The top row's buttons still switched to their dark style.
  - Simpler, and covering the buttons, caret and selection too: give the root view `appearance: "light"`, so the whole note keeps its light-appearance look, rather than setting `colour` on each component. **Proposed**; **To test**, inside Alfred as well as pinned.

## Alfred results list

A Script Filter on a keyword (`scratch` by default, configurable), run by `scripts/list.js`. **Decided** throughout, except where marked:

- One result per note, sorted by last edited, newest first. Each result's `uid` is the note's ID, so Alfred learns from use and keeps the selection steady.
- Title: the note's title. Subtitle: when it was last edited and its preview, e.g. `Edited 3h ago · milk, eggs, flour…`. The time is "just now", minutes, hours or days ago ("5m ago", "3h ago", "2d ago"), and after a week the date in the Mac's format ("12 Nov", with the year if it isn't this year).
- Icon: the note's colour (step 4; until then results have no icon of their own).
- Typing searches the whole note, not just the title: every word of the query must appear somewhere in the note, in any order, ignoring case and accents ("cafe" finds "Café"). `list.js` does the matching itself, rather than leaving it to Alfred (`alfredfiltersresults` is off), since it has to know when nothing matches. It reruns on every keystroke, reading every note (about 115 ms for 300 notes, plus `osascript`'s startup), and Alfred stops the previous run when a new one starts (`queuemode` 2).
- A **New note** result, at the top with no query. With a query that matches nothing, it's the only result, **New note: \<query>**, creating a note with that text. It has no `uid`, so Alfred's learning never moves it. ↩ and ⌘↩ on it behave as they do on a note, as closely as possible: ↩ opens the new note in a quick view, ⌘↩ pins it (connected in step 3).
- ⌘C copies the note's text and ⌘L shows it in Large Type. → shows Alfred's file actions for the note's file (the item's `action`).
- Modifiers on a note:
  - ↩ opens it in a quick view inside Alfred, or, if it's already pinned, brings its window to the front (see [Quick notes and pinned notes](#quick-notes-and-pinned-notes)). **Decided**
  - ⌘↩ pins it: opens it as its own window on the desktop, or brings that window to the front if it's already pinned. **Decided**
  - ⌥↩ moves it to the Trash, through Finder so "Put Back" works, without asking first, and shows a notification naming the note. If the note is pinned, its window is closed first (see [Changes made elsewhere](#changes-made-elsewhere)). **Decided**
  - ⌃↩ reveals it in Finder.
  - ⇧ / ⌘Y Quick Looks it (`quicklookurl` is the file).
- Creating a note from the clipboard comes later (step 5), on a key still to choose, since ⌘↩ on New note pins it. **Open**

## Creating notes

- A keyword for a new note (`snn` by default, configurable), with optional text: `snn` opens a blank note, `snn buy milk` creates one with that text and opens it. **Proposed**
- A Universal Action on text, "New ScratchNote", creating a note from the text and opening it. Covers the macOS selection (via Alfred's Universal Action hotkey) and items in Alfred's clipboard history. **Decided** (the action itself); naming **Proposed**
- From the clipboard: from the results list, on a key still to choose (see [Alfred results list](#alfred-results-list)), rather than its own keyword. **Open**
- An optional hotkey for a new blank note, unset by default. **Proposed**

## Note windows

### Components

- Edit mode is a `textarea`: `editable`, a monospaced `font`, `disableallsubstitutions: true` (no smart quotes or dashes in Markdown). **Proposed**
- View mode is a `markdownarea`, which renders with Alfred's own Markdown renderer (headings, lists, code blocks, tables, block quotes, images, links). It's display-only. Tested: task lists, tables, inline code, bold and italic render; raw HTML (e.g. `<b>Hello</b>`) doesn't. **Proposed**
- The toggle swaps one for the other with a `replace` of the view that holds them, as Now Playing does: a hidden component still takes up space (Alfred's docs say so), so they can't be stacked with one hidden. The text goes through the save file: switching to View saves the editor's text and renders it, and switching back puts the saved text in a new `textarea`. Tested, in both forms. **Proposed**
- `webkitview` was considered for rendering (full CommonMark via a vendored JS library) and for a richer editor, but Alfred documents no way for a page's JavaScript to call back to the workflow, so it couldn't save. Not used unless that changes.

### Layout and controls

- A slim top row with the colour control and the Edit / View toggle; the rest of the window is the note. **Proposed**
- ⌘E toggles Edit / View; Esc closes the window. **Proposed**
- New notes open in Edit mode with the caret in the text; existing notes open in View mode. Possibly a preference. **Proposed**
- A pinned window's title is the note's title, so pinned notes can be told apart in ⌘-Tab, the Dock and window switchers (it's hidden in the window itself if the title bar is transparent). **Decided**. It's set when the window opens and can't change while it's open: neither an `update` of the window's `id` nor a `window` action with a `title` changed it (tested), and Alfred's docs give the `window` action only `resize`. Renaming a note shows in its window title the next time it's pinned.
- Alfred UI can't keep a window above other apps' windows (see [Alfred requests](../../Alfred%20requests.md#alfred-ui-always-on-top-windows)), so notes behave like normal windows, not floating stickies.

### Saving

- The `textarea`'s `typingstopped` event runs the save script with the text as an argument (`{value:editor.text}`), and the `quit` event saves once more. **Proposed**
- Saves are atomic: the text is written to a hidden temporary file in the same folder, which then replaces the note with `NSFileManager`'s `replaceItemAtURL`, so a crash, a sync app or another save never sees half a note, and when saves race (the `typingstopped` and `quit` saves of one window, each its own process) the last to finish wins whole. `replaceItemAtURL` keeps the note's birth time, permissions and Finder tags; Cocoa's own `writeToFile:atomically:` also swaps in a new file but loses them (tested). A save whose text matches the file is skipped, so its modification time stays. **Decided**
  - Tested by racing separate processes on one note: with versions of about 5 MB (large enough for the writes to overlap despite `osascript`'s startup time), a plain write in place left a mixed note every time, and the atomic save never did. With notes of ordinary size the writes didn't overlap either way, so the risk is small, but the atomic save costs nothing.
- `quit` fires however a window closes (close button, ⌘W, Esc, pinning, and, for the quick view, Alfred closing), but not if its process is killed (see [Multiple windows](#multiple-windows)). In View mode `{value:editor.text}` is empty, so the `quit` save must know the mode (e.g. from a per-window state file) and skip saving in View mode, where the file is already up to date from the switch to View. **Decided**
- The View mode's `markdownarea` is refreshed from the saved text when switching to View. **Proposed**

### Changes made elsewhere

- If the file is changed on disk while its window is open (another editor, a sync), and the window has no unsaved typing, the window reloads it. Done with a slow pulse comparing the file's modification time. **Proposed**, possibly later.
- If the file is deleted or trashed while open, the window closes without its final save, which would otherwise write the note back. ⌥↩ in the results list closes the note's window itself before trashing the file; a deletion by anything else is caught by the same pulse as above, so until that pulse exists such a window stays open. **Decided**

## Multiple windows

One window per note is the main thing to prove before building further.

### Test results

Tested by launching Alfred's UI helper directly with a throwaway bundle, the way Alfred launches an external UI (not yet through the Alfred UI workflow object):

- **Several windows from one bundle work.** Alfred starts a new `Alfred UI.app` process for each launch (`open -n`), with the bundle path as its argument. Two launches of the same bundle gave two independent processes and windows.
- **Each window gets its own variables.** The helper reads the workflow's variables from the `__alfredui_variables` environment variable (a JSON object), but only those declared in `ui.json`'s `variablesconfig` (`{ "note": { "src": "variable", "scriptenv": true } }`). With that, `{var:note}` resolves per window (in the window `id`, `title`, component text and action args), and the UI's scripts get `note` in their environment.
- **Window positions are saved per bundle path, not per window `id`.** With `frameautosave: true`, AppKit saves the frame as `NSWindow Frame <bundle file name>-<SHA-1 of the bundle path>` (e.g. `A-6c9d…` for `…/windows/A.alfredui`) in the `com.runningwithcrayons.Alfred-UI` defaults. The window `id` and `title` don't affect it, and a string `frameautosave` (e.g. `"scratchnote-{var:note}"`) isn't used as a name. So all windows of one bundle share one saved position.
- **A per-note symlink gives each note its own position.** The path isn't resolved before hashing, so launching through a symlink per note (e.g. `<cache>/windows/<note id>.alfredui` → the workflow's bundle) gives each its own saved frame. Two notes dragged to different places and closed reopened exactly where each was left. (With no saved frame under its own name, a window opened once at a frame seeded under `<last part of bundleid>-<same hash>`, so there seems to be a fallback name; it doesn't matter here.)
- **An open note's window can be brought to the front** by its process ID (`NSRunningApplication` … `activateWithOptions`, from JXA). Each window's scripts see their helper's PID as their parent PID, so the `launched` event can record it.
- **`typingstopped` delivers the text.** With `{value:editor.text}` as an action argument, the script gets the whole text, newlines included, after each pause in typing.
- **`quit` fires when the window closes**, by its close button or ⌘W, and `{value:editor.text}` still holds the final text then, so a last save on close works. It doesn't fire when the process is killed.
- **A newly opened window takes keyboard focus** (the helper activates on launch, and the `textarea` has `focus`). Keystrokes meant for another app landed in test windows as they opened. Fine when the user opens a note; something to handle if notes are ever reopened in bulk (e.g. at login).

Then tested through the Alfred UI workflow object (External Trigger → Run Script → Alfred UI, "Launch Externally"):

- **The "Alfred UI file" path takes a placeholder.** `{var:uipath}`, set by the Run Script to the note's symlink, resolved per run, so each note opens through its own path.
- **Each run opens a new window**, in its own process, as with the direct launches.
- **The stream's variables arrive** (declared in `variablesconfig`), and the UI's scripts also get `alfred_workflow_cache` and the other `alfred_*` variables. The stream's argument is passed as an extra launch argument after the bundle path.
- **First-time placement:** with no saved frame, the two windows opened at different, uncentred positions; Alfred seems to place them. Not looked into.
- **"Open within Alfred" runs in Alfred's own process.** With the object's launch mode set to open within Alfred, the same bundle showed in Alfred's window, no helper process started, and the `launched` event's script ran as a child of Alfred itself.

### Limitation: one process per window

Each window is a separate process of Alfred's helper app, and a process has exactly one window: nothing in Alfred UI opens a second window in the same process, or sets how the process appears in ⌘-Tab and the Dock. So every open note is its own entry in ⌘-Tab, named after its window title, rather than one "ScratchNotes" app with several windows. A process can only change its own presentation, and the helper is Alfred's signed app, so a workflow can't change this. The options were:

1. Accept it, and make the entries recognisable: every note window uses the ScratchNotes icon (`iconpath`). The window title is either the note's title (distinguishable in window switchers) or a fixed "ScratchNotes" (consistent, but all alike).
2. One window holding many notes (tabs or a sidebar): one ⌘-Tab entry, but no sticky notes spread around the desktop.
3. A small native app (Swift) launched by the workflow: real multiple windows in one app, and room for things Alfred UI can't do (always on top, reopening notes at login, staying out of ⌘-Tab). Much more code, and a compiled app to build for both architectures, sign and notarise.
4. Ask Alfred for a UI to open several windows in one process, or for a setting that keeps a UI out of ⌘-Tab and the Dock (notes would then be reached through the ScratchNotes results, which can bring an open note to the front). Both are filed in [Alfred requests](../../Alfred%20requests.md#alfred-ui-several-windows-in-one-ui-process).
5. Open notes inside Alfred by default, and only "pin" them to the desktop as their own windows on request. See [Quick notes and pinned notes](#quick-notes-and-pinned-notes). This doesn't remove the limitation, but it keeps it to the notes deliberately kept on the desktop.

Chosen: 5 combined with 1. Pinned windows use the ScratchNotes icon and are titled with the note's title. 4 is filed and 3 is in reserve. **Decided**; the quick form passed its tests (below).

### Quick notes and pinned notes

Alfred's own displays (the Text View, "View in Alfred", Quick Look, Large Type) and Alfred UI's "Open within Alfred" mode all live in Alfred's window and process: one at a time, closing when Alfred closes. None stays on the desktop. But the same `.alfredui` bundle can be opened either way, so a note can have two forms. **Decided**:

- **Quick:** ↩ on a note opens it inside Alfred's window, for a quick read or edit. No process, no ⌘-Tab entry; it goes when Alfred closes.
- **Pinned:** ⌘↩ on a note, or a pin button in the quick view, opens it as its own window on the desktop (its own process, per-note position, as in [Test results](#test-results)). Pinning from the quick view closes the quick view (`finish`) and launches the external window.
- If a note is already pinned, ↩ brings its window to the front rather than opening a quick view, so a note is never open in two places at once.

Tested so far for the quick form:

- **`quit` fires when Alfred's window closes.** A quick view opened while Alfred was hidden closed at once, and its `quit` event ran with the `textarea`'s text, so a last save on close works. Opening a quick view from outside Alfred (an External Trigger) needs Alfred's window showing first, or it closes straight away.
- **Pinning from the quick view works.** A Pin button whose script fires an External Trigger (→ Run Script → Alfred UI object set to launch externally) and prints `{"finish":{}}` opened the note as its own window.
- **A script running inside Alfred must never wait on Alfred.** The quick view's scripts run synchronously in Alfred's process, so a script that calls Alfred over AppleScript (`run trigger`) and waits for the reply deadlocks Alfred until the AppleEvent times out (2 minutes), with a beach ball and no way to quit Alfred normally. Send the AppleEvent in the background (`… &!`) and return straight away. Killing the stuck `osascript` releases Alfred.
- **A note needs a guard against a second window.** Two queued pins opened two windows for the same note; opening or pinning must check for a live window first (see [Proposed approach](#proposed-approach)).

Then tested by hand with a test bundle (a top row of buttons over a `textarea`, opened by a keyword inside Alfred and by an External Trigger externally):

- **The bundle lays out sensibly inside Alfred's window.** The top row and the `textarea` showed at a usable size.
- **Editing inside Alfred works.** Typing, ↩ for a new line, Tab, the arrow keys, ⌘A, ⌘C / ⌘V and ⌘Z / ⇧⌘Z all went to the `textarea`, not to Alfred, and `typingstopped` delivered the text as it does externally.
- **`quit` fires however the quick view closes**: Esc, clicking another app, and pinning (`finish`). Esc in the quick view is handled by Alfred itself: a `⎋` entry in the root view's `shortcuts` doesn't run there, but `quit` does, with the text.
- **Pinning with the background trigger works**, from the quick view and from a pinned window (whose `finish` closes it before the new window launches). Each time the old view's `quit` ran before the new window's `launched`.
- **Esc in a pinned window** (a `⎋` shortcut running a script, then `finish`) runs the shortcut and then fires `quit` with the text.
- **`{value:editor.text}` is empty when the `textarea` isn't in the window.** After the Edit / View toggle has replaced the `textarea` with the `markdownarea`, `quit` (and any other action) gets an empty string for it. A save on `quit` must only use it in Edit mode, or it would blank the note (and the empty-note rule would then delete it); see [Saving](#saving).
- **Pinning a note that's already pinned** once opened a second window (above) and once opened none, so the behaviour isn't reliable either way; the guard is still needed.

### Still to test

- Per-window state: variable persistence (`persist`) is keyed on the UI's `bundleid`, so all windows would share it. Each window's own state (its note, mode, PID) must live elsewhere, e.g. in files keyed by note ID in `$alfred_workflow_cache`.

### Proposed approach

Given the results so far (**Proposed**; details in [The note window bundle](#the-note-window-bundle)):

- Each note opens from its own bundle path in `$alfred_workflow_cache/windows/<note id>.alfredui`, so a pinned window reopens where it was left.
- On `launched`, the window records its form, PID and mode in a state file keyed by note ID; on `quit` it removes it. Opening a note that has a live pinned window brings that window to the front instead of opening a second one.

## Configuration

User Configuration fields (values saved in the gitignored `prefs.plist`). **Proposed**

| Variable | Type | Default |
|---|---|---|
| `notes_folder` | folder picker | blank: `$alfred_workflow_data/notes/` (**Decided**) |
| `keyword` | text | `scratch` (**Decided**) |
| `keyword_new` | text | `snn` |
| `default_colour` | popup of the palette's colour names | `yellow` (**Decided**) |
| `font_size` | slider, 11–20 pt, for both Edit and View | `13` (**Decided**) |
| `open_mode` | popup: View / Edit | View for existing notes |

## Language

**Decided**: JavaScript for Automation (JXA) for all scripts, as one executable script per job (or one script with subcommands), run as external script files with an `osascript -l JavaScript` shebang.

- JSON is native, both for Script Filter output and for Alfred UI's `update` / `replace` actions.
- Unicode-safe string handling for titles, previews and truncation, and easy relative dates.
- Cocoa through the ObjC bridge where needed: atomic writes (`replaceItemAtURL`), file attributes (modification and birth dates), the Trash via Finder for "Put Back".
- Ships with macOS on every version Alfred 6 supports, with nothing to vendor or sign.
- Cost: about 70ms to start `osascript`, which is fine for a Script Filter, a save, or a pulse every few seconds. JXA has no `require`, so every script loads the shared `lib.js` and evaluates it at startup (see [Loading lib.js](#loading-libjs)).

Alternatives considered: zsh with `jq` (Now Playing's approach) is quick to start, but Markdown title parsing, Unicode truncation and JSON building are clumsier, and `/usr/bin/jq` only ships from macOS 15. Swift would need compiled, signed and notarised binaries. Python no longer ships with macOS.

## Implementation plan

**Proposed.** The steps below are in build order. Each leaves the workflow working in Alfred (edits to the folder are live) and is tested before the next starts. The multiple-windows and quick-view experiments (above) are done.

Alfred objects are added to `info.plist` with targeted `plutil` edits and then checked in Alfred's workflow editor, where they can be rearranged. Each User Configuration field is added in the step that first uses it.

### Files

| Path | Contents |
|---|---|
| `scripts/lib.js` | Shared code, loaded by every script: configuration (from the workflow's variables, with defaults), paths, the palette, metadata sidecars, titles and previews, atomic writes, note IDs, window state. |
| `scripts/list.js` | The results list's Script Filter. |
| `scripts/open.js` | Opens a note, quick or pinned: writes its window bundle, or brings its pinned window to the front. |
| `scripts/new.js` | Creates a note (blank, from text, or from the clipboard) and opens it. |
| `scripts/trash.js` | Closes a note's window, if it has one, and moves the note to the Trash. |
| `scripts/window.js` | The note window's actions: `launched`, `typingstopped`, `quit`, the Edit / View toggle, the colour control, Pin. |
| `ui/` | The templates a note's window is built from: `window.json` and the parts it's assembled from. |
| `icons/<colour>.png` | One dot icon per palette colour, for the results list. |
| `dev/make-icons.js` | Draws the icons from the palette. Development only (`.wfignore`). |
| `dev/install-samples.js` | Installs eight sample notes, `example1` to `example8`, in the current notes folder (or a folder given as its argument), replacing their text, sidecars and dates, so the samples can be reset however they've been changed. Other notes are left alone. Outside Alfred it reads `notes_folder` from `prefs.plist`, falling back to the data folder. Development only (`.wfignore`). |
| `dev/test-list.sh` | Tests `list.js` with sample notes and queries in a temporary folder. Development only (`.wfignore`). |
| `dev/test-storage.sh` | Tests `lib.js`'s storage functions against a temporary folder, with `dev/test-storage.js`, which does the work. Development only (`.wfignore`). |

### Loading lib.js

**Decided**, and tested. JXA has no `require`, and `Library()` only loads from `~/Library/Script Libraries`, which a workflow can't ship in. So each script ends with this function, and calls `loadLib(argv, "lib.js")` first thing in `run`:

```js
function loadLib(argv, relativePath) {
  const args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments);
  let script = args[args.length - argv.length - 1];
  if (!script.startsWith("/")) script = `${$.NSFileManager.defaultManager.currentDirectoryPath.js}/${script}`;
  const path = $(script).stringByDeletingLastPathComponent.stringByAppendingPathComponent(relativePath).stringByStandardizingPath.js;
  const source = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  if (source.isNil()) throw new Error(`Can't load ${path}`);
  (0, eval)(source.js);
  return path;
}
```

- `lib.js` is found from the script's own path, not the working directory, so it loads whoever runs the script and from wherever: an external script (Alfred), an Alfred UI action running `scripts/window.js` by its absolute path, or a terminal. A script run through its shebang or as `osascript -l JavaScript <path>` gets `osascript`'s arguments with its own path just before `argv`, which is what `run` receives; a relative path is from the working directory. `dev/test-storage.sh` runs a script with this function by absolute and relative paths, from other folders (including `/`), through a symlinked workflow folder (as Alfred links it) and with `osascript -l JavaScript <path>`.
- The indirect `eval` (`(0, eval)(…)`) runs `lib.js` in the global scope: its function declarations become globals, while its top-level `const` and `let` stay private to it (its functions still see them). It mustn't have `"use strict"`, which would keep the functions private too. All functions share one namespace, so `lib.js` names them for what they do (`noteSummary`, not `summary`), and a script mustn't define a function with the same name as one of its functions.
- `lib.js` mustn't use regular expression lookbehind (`(?<=…)`, `(?<!…)`): macOS 12's JavaScriptCore can't parse it, and a syntax error stops the whole file loading.

### lib.js

The storage functions (step 1), for the later scripts. Fuller notes are in the comments in `lib.js`.

- `notesFolder()`: the notes folder (see [Notes folder](#notes-folder)), created if missing. Throws if `notes_folder` and `alfred_workflow_data` are both unset (a script run by hand needs one of them).
- `noteStore(folder = notesFolder())` returns the functions for the notes in a folder. Notes are passed as IDs, which are checked (`isNoteId`: one non-hidden filename component, so an ID from a script argument can't reach outside the folder):
  - `list()`: every note, last edited first, as note objects: `{ id, path, fileName, text, meta, modified, created, title, preview }`. `text` is the whole file, `meta` the sidecar's object (`{}` without one), `modified` and `created` are `Date`s. For the results list. Gives notes without a sidecar one (see [Metadata](#metadata)), as `read` does.
  - `read(id)`: one note object, or null if it doesn't exist.
  - `newId({ date, isTaken })`: an ID for a new note. Nothing is written, so a new note can open before it's saved; `isTaken(id)` should return true for the IDs of notes that are open but not saved yet (in step 3, ones with a window bundle or state file), or two notes created in the same second would get the same ID.
  - `save(id, text)`: saves the whole text atomically and returns `"created"`, `"saved"`, `"unchanged"` (not rewritten) or `"blank"` (a new note with blank text, not written). Records `created` in the sidecar on a note's first save.
  - `readMeta(id)` and `updateMeta(id, changes)`: the sidecar. `updateMeta` merges, removes keys set to null, and returns the result. It works for a note that isn't saved yet (a colour picked before typing).
  - `deleteIfEmpty(id)`: for a window closing on its note. Deletes the note and its sidecar if its text is blank or it was never saved, and returns whether it did.
  - `trash(id)`: moves the note to the Trash through Finder, keeping its sidecar, and returns its path in the Trash (null if there was no note). macOS asks once for permission to control Finder: for Alfred, the first time a note is trashed.
  - Also `notePath(id)`, `exists(id)` and `folder`.
- `noteSummary(text, { titleLength, previewLength })`: `{ title, preview }` (see [Title, timestamps, empty notes](#title-timestamps-empty-notes)), for a note's text that isn't saved yet, such as a window's title.
- Smaller helpers: `workflowVariable(name)`, `truncateText(text, maxLength)`, `isBlankText`, `formatNoteId(date)`, `formatLocalIsoDate(date)`, `readText(path)`, `writeFileAtomically(path, text)`.

Learned while building it:

- An ObjC method's object parameter must be given `$()` for nil: JavaScript `null` arrives as `NSNull`, which crashed `replaceItemAtURL` (as its backup name). `null` is fine for `NSError **` and other out parameters.
- `list()` of 300 notes took about 115 ms, on top of `osascript`'s startup, and about 270 ms the first time, when it writes their sidecars.
- The Trash test confirms Finder moves the note to the Trash; that Finder's "Put Back" then works isn't checked automatically, since the Trash's records can't be read without Full Disk Access.

### The note window bundle

Each note opens from its own generated bundle, `$alfred_workflow_cache/windows/<note id>.alfredui`, whose `ui.json` `open.js` writes every time the note opens, quick or pinned. This replaces the tested arrangement of a symlink per note to one shared bundle, with the note passed in variables:

- Some window settings need real JSON types (the font size is a number), and variables reach a UI only as strings, which Alfred ignores in those places (see Now Playing's `DEVELOPMENT.md`). A `{file:…}` placeholder could insert typed JSON, but its path can't contain a placeholder, so it can't be per note.
- Each note still has its own bundle path, so each pinned window still keeps its own saved position: the frame is saved under a hash of the path, whether the path is a symlink or a folder.
- `open.js` fills in the note's text (the `textarea`'s or `markdownarea`'s `text`), the window `title`, the tint, the font size and the starting mode.
- The bundle's actions run `scripts/window.js` by its absolute path, with the note ID as an argument.
- Both Alfred UI objects take the bundle path as `{var:uipath}` (tested).

Each window's state is in `$alfred_workflow_cache/state/<note id>.json`: its form (`quick` or `pinned`), PID and mode (`edit` or `view`). `launched` writes it, the toggle updates the mode, and `quit` removes it. A note counts as pinned only when the form is `pinned` and the PID is alive; the quick view's PID is Alfred's own, which is always alive.

### Steps

1. **Storage core.** **Done.** `lib.js`'s storage functions (see [lib.js](#libjs)): notes folder (created if missing), IDs with collision suffixes, metadata sidecars (keeping unknown keys), title and preview, atomic save, delete if empty, Trash through Finder, and the way scripts load `lib.js`. `dev/test-storage.sh` tests them against a temporary folder from `mktemp`, and takes about 8 seconds: loading `lib.js` from other folders, configuration, IDs and collisions, saves (birth time, Finder tags and modification time), sidecar round trips and unknown keys, notes without sidecars, titles and previews, Unicode (emoji, flags, combining accents, truncation, decomposed filenames), empty notes, listing, separate processes saving at once, and the Trash (`SKIP_TRASH=1` skips it; it trashes only a note it created, then deletes that file from the Trash). No Alfred objects yet.
2. **Results list.** **Built**, tested directly (`dev/test-list.sh`); to check in Alfred. `list.js` and a Script Filter on `{var:keyword}`, with the `keyword` and `notes_folder` fields. ⌥↩ trashes (Run Script `trash.js`, which prints the notification's text, then Post Notification), ⌃↩ reveals in Finder (Reveal in Finder on the path, the ⌃ modifier's `arg`), ⇧ / ⌘Y Quick Looks; ↩ and ⌘↩ are connected in step 3. Results have no icon until step 4. Moving notes when `notes_folder` changes is on hold (see [Notes folder](#notes-folder)). To check in Alfred:
   - The `notes_folder` field's picker chooses folders: its `filtermode` is 1, which is a guess (the repo's only other file picker, Now Playing's, picks an app with 0).
   - The Reveal in Finder object (`alfred.workflow.action.revealfile`, `path` set to `{query}`) and the notification object show correctly in the workflow editor.
   - Whether Alfred's learning moves notes above the New note result, which has no `uid`.
   - The first ⌥↩ asks for permission for Alfred to control Finder.

   For step 3: a note result's `arg` is its ID, and the New note result's is the text to start with (empty for a blank note), so step 3 needs a way to tell them apart before `open.js`, such as a variable on the New note result.
3. **Note window.** The `ui/` templates, `open.js` and `window.js`. Objects: the Script Filter's ↩ → Run Script `open.js quick` → Alfred UI (open within Alfred); ⌘↩ and an External Trigger `pin` → Run Script `open.js pin` → Conditional (stop when it brought an open window to the front) → Alfred UI (launch externally). Covers:
   - Edit / View with ⌘E and a button, opening in the mode `open_mode` sets (new notes in Edit).
   - Saving on `typingstopped` and on `quit` (skipped in View mode), and deleting an empty note on close.
   - Pin (background `run trigger`, then `finish`), Esc, and the guard that brings an already pinned note to the front.
   - ⌥↩ on a pinned note killing its window's process before trashing it: a killed process doesn't fire `quit`, so nothing writes the note back.
   - The window title, the `font_size` and `open_mode` fields, and an app icon for pinned windows (`iconpath`).

   Test at the start of this step: root view `appearance: "light"` (see [Colour](#colour)), and whether Alfred expands placeholders such as `{var:x}` or `{file:…}` that appear in a note's own text, in `ui.json` and in `update` actions. If it does, the text has to be escaped or loaded another way.
4. **Colour.** The palette (names and tints) in `lib.js`, `dev/make-icons.js` and the icons, the colour control in the top row (a `picker`, or a button with a `menu`) writing the sidecar (`updateMeta`) and updating the tint, per-colour icons in the results list, and the `default_colour` field.
5. **Creating notes.** `new.js`: the `{var:keyword_new}` keyword with optional text, the "New ScratchNote" Universal Action, from the clipboard, and an optional hotkey (unset). A quick view only works while Alfred's window is showing (tested), so routes from outside Alfred, such as the hotkey, open the new note pinned. Test the Universal Action on a selection in another app and on a clipboard history item.
6. **Docs and polish.** Move the developer notes into `DEVELOPMENT.md` (how it's built, from this document and what was learned), write the user guide in `README.md` and run `bin/wf sync-readme scratchnotes`, and make the workflow icon.

After the first version: reloading a window when its note changes on disk, and closing it when the note is deleted by something else (the pulse in [Changes made elsewhere](#changes-made-elsewhere)), and dark-appearance variants of the palette.
