# ScratchNotes design

Working design for ScratchNotes: quick scratch notes, each a Markdown file, listed in Alfred and opened in their own small Alfred UI windows, like sticky notes on the desktop.

Every item is marked with its status:

- **Decided**: agreed, build to it.
- **Proposed**: the current idea, not agreed yet.
- **Open**: a question still to answer, possibly with options.
- **To test**: depends on Alfred behaviour that isn't documented; needs an experiment.

## Goals

- Any number of notes, each a plain `.md` file in a folder the user chooses. **Decided**
- An Alfred results list of the notes, with a preview and when each was last edited; actioning one opens it in its own window. **Decided**
- One window per note, so several notes can be open at once, arranged around the desktop like sticky notes. **Decided** (highly desirable; feasibility **To test**, see [Multiple windows](#multiple-windows))
- Notes are edited as Markdown, with a toggle between editing the source and viewing it rendered. **Decided**
- Each note has its own colour, shown in its window and in the results list. **Decided**
- New notes from a keyword, from the results list, and from a Universal Action on text. **Decided**

## Storage

### Notes folder

- One `.md` file per note, in the folder set in the workflow's configuration. **Decided**
- Default folder `~/Documents/ScratchNotes`, so notes are ordinary visible files that can be synced or opened in other apps, rather than hidden in `$alfred_workflow_data`. Created on first use if missing. **Proposed**
- Only `*.md` files directly in the folder are notes; subfolders and other files are ignored. **Proposed**

### Filenames

- Filenames are stable IDs, never derived from the content, so a file isn't renamed while a window has it open. **Decided**
- Format: creation time, `YYYYMMDD-HHMMSS.md` (e.g. `20261120-153012.md`), with `-2`, `-3`… added if the name is taken. Sorts by creation in Finder. **Proposed**

### Front matter

- Per-note metadata, such as the colour, is stored as YAML front matter at the top of the file, so it travels with the note through any sync or copy. **Decided**
- Only a small flat subset of YAML is read and written (`key: value` lines); unknown keys are preserved untouched on save. **Proposed**
- The editor shows the note without its front matter, and the save script puts it back. **Proposed**
- A note with no front matter is valid and gets the default colour; front matter is only written once there's something to store. **Proposed**

```markdown
---
colour: "#F6D365"
---
# Shopping
- milk
```

### Title, timestamps, empty notes

- The title is the note's first non-empty line, with leading `#`s and whitespace removed; "Untitled" if the note is empty. **Proposed**
- "Last edited" is the file's modification time; "created" (if shown) is its birth time. Nothing else records them. **Proposed**
- A new note isn't written to disk until it has content, and a note that is empty when its window closes is deleted, so abandoned new notes leave no files. **Proposed**

## Colour

- Each note has a colour, stored in its front matter. **Decided**
- Picking: a colour picker with some presets. Whether colours are free choice (hex) or a fixed palette is **Open**. Things that bear on it:
  - Alfred UI has no colour well component. Presets are easy (a `picker`, or a button with a `menu`); a free choice would need `opendialog`-style workarounds or a `webkitview`, which is unproven.
  - Results-list icons: a fixed palette can ship one pre-made dot icon per colour; free colours need icons generated on demand into `$alfred_workflow_cache`.
  - Whatever the picker offers, the front matter could still accept any hex value written by hand.
- Where the colour shows in the window (whole background tint, like a sticky note, or a strip/header) is **Open**. Text must stay readable on every colour in both light and dark appearance.

## Alfred results list

A Script Filter on a keyword (`sn` by default, configurable). **Proposed** throughout:

- One result per note, sorted by last edited, newest first.
- Title: the note's title. Subtitle: relative edit time and the start of the body, e.g. `Edited 3h ago · milk, eggs, flour…`.
- Icon: the note's colour.
- Typing filters on the whole content, not just the title (Alfred's `match` field holds the title and body).
- A **New note** result, at the top with no query. With a query that matches nothing, it becomes **New note: \<query>**, creating a note with that text.
- Modifiers on a note:
  - ↩ opens it in its window, or brings its window to the front if it's already open (tested possible). If notes open inside Alfred by default, ↩ opens the quick form and ⌘↩ pins it instead (see [Quick notes and pinned notes](#quick-notes-and-pinned-notes)).
  - ⌥↩ moves it to the Trash, through Finder so "Put Back" works. Whether to confirm first is **Open**.
  - ⌘↩ reveals it in Finder (or ⌃↩, if ⌘↩ is used for pinning).
  - ⇧ / ⌘Y Quick Looks it (`quicklookurl` is the file).
- Modifiers on New note: ⌘↩ creates the note from the clipboard. **Proposed**
- Each result's `uid` is the note's ID, so Alfred learns from use and keeps the selection steady.

## Creating notes

- A keyword for a new note (`snn` by default, configurable), with optional text: `snn` opens a blank note, `snn buy milk` creates one with that text and opens it. **Proposed**
- A Universal Action on text, "New ScratchNote", creating a note from the text and opening it. Covers the macOS selection (via Alfred's Universal Action hotkey) and items in Alfred's clipboard history. **Decided** (the action itself); naming **Proposed**
- From the clipboard: the ⌘ modifier on the New note result (see above), rather than its own keyword. **Proposed**
- An optional hotkey for a new blank note, unset by default. **Proposed**

## Note windows

### Components

- Edit mode is a `textarea`: `editable`, a monospaced `font`, `disableallsubstitutions: true` (no smart quotes or dashes in Markdown). **Proposed**
- View mode is a `markdownarea`, which renders with Alfred's own Markdown renderer (headings, lists, code blocks, tables, block quotes, images, links). It's display-only. Raw HTML and task-list checkboxes are probably not supported (**To test**). **Proposed**
- The two are stacked in the same space and the toggle hides one and shows the other. If a hidden component still takes space in a stack, swap them with `replace` instead, as Now Playing does. **Proposed**, **To test**
- `webkitview` was considered for rendering (full CommonMark via a vendored JS library) and for a richer editor, but Alfred documents no way for a page's JavaScript to call back to the workflow, so it couldn't save. Not used unless that changes.

### Layout and controls

- A slim top row with the colour control and the Edit / View toggle; the rest of the window is the note. **Proposed**
- ⌘E toggles Edit / View; Esc closes the window. **Proposed**
- New notes open in Edit mode with the caret in the text; existing notes open in View mode. Possibly a preference. **Proposed**
- The window title is the note's title (window switchers show it; it's hidden if the title bar is transparent). **Proposed**
- Alfred UI can't keep a window above other apps' windows (see [Alfred requests](../../Alfred%20requests.md#alfred-ui-always-on-top-windows)), so notes behave like normal windows, not floating stickies.

### Saving

- The `textarea`'s `typingstopped` event runs the save script with the text as an argument (`{value:editor.text}`), and the `quit` event saves once more. **Proposed**
- Saves are atomic (write a temporary file in the same folder, then rename), so a crash or sync never sees half a note. **Proposed**
- Whether closing the window with its close button fires `quit` is **To test**; if not, saving on `typingstopped` alone has to be enough.
- The View mode's `markdownarea` is refreshed from the saved text when switching to View. **Proposed**

### Changes made elsewhere

- If the file is changed on disk while its window is open (another editor, a sync), and the window has no unsaved typing, the window reloads it. Done with a slow pulse comparing the file's modification time. **Proposed**, possibly later.
- If the file is deleted or trashed while open (e.g. ⌥↩ in the results list), the window closes. **Open**

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

Each window is a separate process of Alfred's helper app, and a process has exactly one window: nothing in Alfred UI opens a second window in the same process, or sets how the process appears in ⌘-Tab and the Dock. So every open note is its own entry in ⌘-Tab, named after its window title, rather than one "ScratchNotes" app with several windows. A process can only change its own presentation, and the helper is Alfred's signed app, so a workflow can't change this. **Open**, with options:

1. Accept it, and make the entries recognisable: every note window uses the ScratchNotes icon (`iconpath`). The window title is either the note's title (distinguishable in window switchers) or a fixed "ScratchNotes" (consistent, but all alike).
2. One window holding many notes (tabs or a sidebar): one ⌘-Tab entry, but no sticky notes spread around the desktop.
3. A small native app (Swift) launched by the workflow: real multiple windows in one app, and room for things Alfred UI can't do (always on top, reopening notes at login, staying out of ⌘-Tab). Much more code, and a compiled app to build for both architectures, sign and notarise.
4. Ask Alfred for a UI to open several windows in one process, or for a setting that keeps a UI out of ⌘-Tab and the Dock (notes would then be reached through the ScratchNotes results, which can bring an open note to the front). Both are filed in [Alfred requests](../../Alfred%20requests.md#alfred-ui-several-windows-in-one-ui-process).
5. Open notes inside Alfred by default, and only "pin" them to the desktop as their own windows on request. See [Quick notes and pinned notes](#quick-notes-and-pinned-notes). This doesn't remove the limitation, but it keeps it to the notes deliberately kept on the desktop.

Suggested: 5 combined with 1 (pinned notes use the ScratchNotes icon), with 4 filed and 3 in reserve. **Proposed**

### Quick notes and pinned notes

Alfred's own displays (the Text View, "View in Alfred", Quick Look, Large Type) and Alfred UI's "Open within Alfred" mode all live in Alfred's window and process: one at a time, closing when Alfred closes. None stays on the desktop. But the same `.alfredui` bundle can be opened either way, so a note can have two forms. **Proposed**:

- **Quick:** ↩ on a note opens it inside Alfred's window, for a quick read or edit. No process, no ⌘-Tab entry; it goes when Alfred closes.
- **Pinned:** ⌘↩ on a note, or a pin button in the quick view, opens it as its own window on the desktop (its own process, per-note position, as in [Test results](#test-results)). Pinning from the quick view closes the quick view (`finish`) and launches the external window.
- If a note is already pinned, ↩ brings its window to the front rather than opening a quick view, so a note is never open in two places at once.

Tested so far for the quick form:

- **`quit` fires when Alfred's window closes.** A quick view opened while Alfred was hidden closed at once, and its `quit` event ran with the `textarea`'s text, so a last save on close works. Opening a quick view from outside Alfred (an External Trigger) needs Alfred's window showing first, or it closes straight away.
- **Pinning from the quick view works.** A Pin button whose script fires an External Trigger (→ Run Script → Alfred UI object set to launch externally) and prints `{"finish":{}}` opened the note as its own window.
- **A script running inside Alfred must never wait on Alfred.** The quick view's scripts run synchronously in Alfred's process, so a script that calls Alfred over AppleScript (`run trigger`) and waits for the reply deadlocks Alfred until the AppleEvent times out (2 minutes), with a beach ball and no way to quit Alfred normally. Send the AppleEvent in the background (`… &!`) and return straight away. Killing the stuck `osascript` releases Alfred.
- **A note needs a guard against a second window.** Two queued pins opened two windows for the same note; opening or pinning must check for a live window first (see [Proposed approach](#proposed-approach)).

**To test** for the quick form:

- How the bundle sizes and lays out in Alfred's window (the window settings, such as `frameautosave` and the title bar, presumably don't apply).
- Editing in a `textarea` inside Alfred: typing, ⌘Z, and that Alfred's own shortcuts don't take the keys.
- `quit` on Esc and on clicking elsewhere, by hand.
- Pinning with the background trigger (the fixed version of the Pin button).

### Still to test

- Esc closing the window (a `⎋` shortcut running `finish`) also fires `quit`.
- Per-window state: variable persistence (`persist`) is keyed on the UI's `bundleid`, so all windows would share it. Each window's own state (its note, mode, PID) must live elsewhere, e.g. in files keyed by note ID in `$alfred_workflow_cache`.

### Proposed approach

Given the results so far (**Proposed**):

- Each note window opens through its own symlink, `$alfred_workflow_cache/windows/<note id>.alfredui`, so it reopens where it was left.
- The note ID (and path) reach the window as a variable declared in `variablesconfig`.
- On `launched`, the window records its PID in `$alfred_workflow_cache/open/<note id>`; on `quit` it removes it. Opening a note with a live PID there brings that window to the front instead of opening a second one.

## Configuration

User Configuration fields (values saved in the gitignored `prefs.plist`). **Proposed**

| Variable | Type | Default |
|---|---|---|
| `notes_folder` | folder picker | `~/Documents/ScratchNotes` |
| `keyword` | text | `sn` |
| `keyword_new` | text | `snn` |
| `default_colour` | to match the colour decision | (**Open**) |
| `font_size` | slider | (**Open**) |
| `open_mode` | popup: View / Edit | View for existing notes |

## Language

**Proposed**: JavaScript for Automation (JXA) for all scripts, as one executable script per job (or one script with subcommands), run as external script files with an `osascript -l JavaScript` shebang.

- JSON is native, both for Script Filter output and for Alfred UI's `update` / `replace` actions.
- Unicode-safe string handling for titles, previews and truncation, and easy relative dates.
- Cocoa through the ObjC bridge where needed: atomic writes (`writeToFileAtomically`), file attributes (modification and birth dates), the Trash via Finder for "Put Back".
- Ships with macOS on every version Alfred 6 supports, with nothing to vendor or sign.
- Cost: about 70ms to start `osascript`, which is fine for a Script Filter, a save, or a pulse every few seconds. JXA has no `require`, so shared code is either one script with subcommands or a library file loaded and evaluated at startup.

Alternatives considered: zsh with `jq` (Now Playing's approach) is quick to start, but front matter parsing, Unicode truncation and JSON building are clumsier, and `/usr/bin/jq` only ships from macOS 15. Swift would need compiled, signed and notarised binaries. Python no longer ships with macOS.

## Order of work

1. Multiple-windows test (above), with a throwaway UI bundle.
2. Storage and the results list: folder, front matter, listing, new, trash.
3. Note window: edit, view, save.
4. Colour.
5. Universal Action, clipboard, configuration, user-facing readme.
