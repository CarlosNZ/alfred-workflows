# Scratch'n'Stick

Developer notes. Quick scratch notes, each a Markdown file, listed in Alfred and opened in a small window: inside Alfred for a quick look or edit, or stuck to the desktop as a sticky note.

This file is the overview: what the workflow does, how its parts fit together, and how to test it. The details are in topic files in [`dev/docs/`](dev/docs/), listed under [Detailed notes](#detailed-notes). The user guide, [README.md](README.md), is still to be written.

## What it does

- **Notes are plain `.md` files** in a notes folder: the workflow's data folder by default, or one the user chooses. Moving the setting moves the notes.
- **The results list** (`scratch`) lists the notes, last edited first, with a title, a preview and when each was edited, and searches their whole text. ↩ opens a note in a **quick view** inside Alfred's window; ⌘↩ **sticks it to the desktop** as its own window; ⌥↩ trashes it; ⌃↩ reveals it.
- **Example notes**, `example-1-…` onwards, are added to the notes folder the first time the workflow runs, to show what notes can do. They're never replaced, and come back only if the workflow's data folder is deleted.
- **New notes** come from New note in the list, the `newscratch` and `newsticky` keywords (with typed text or the clipboard), the "New scratch note" and "New sticky note" Universal Actions, and an optional hotkey. Text that reads as a heading starts the note as `# <text>`.
- **The sticky notes list** (`sticky`) lists the notes stuck to the desktop, to bring one to the front or close it, or show or close them all.
- **A note's window** has an editor (Edit) and a rendered view (Preview, with task boxes that can be ticked), switched with ↩ (to Edit) and ⌘↩ (to Preview). Its top row sets the note's colour (six slots, customisable), icon (44 Lucide icons) and font size, and its actions menu (⌘K) has Stick, Close, Move to Trash, Share and Copy. Sticky windows collapse to their top strip with a double-click, and reopen where they were left.

## Names

The workflow is **Scratch'n'Stick** (straight apostrophes, as people type them), described as "Scratchpad and sticky notes" so a search for either finds it. Notes stuck to the desktop are **sticky notes** everywhere the user sees them, and the action is **Stick to the desktop** (⌘D; the button's short name is Stick, its accessibility label "Make sticky"). A sticky note's result says "📌 Sticky • …". The rendered mode is **Preview** to the user and View in the code. The quick view is never called anything in the UI.

Keywords: `scratch` (the list), `newscratch` (a new note), `sticky` (the sticky notes list), `newsticky` (a new sticky note). The new-note Script Filter is "New Scratch'n'Stick note", and notifications are titled Scratch'n'Stick.

In code, `sticky` names the form and anything about a sticky note (`"@form": "sticky"`, `stickyNoteIds`) and `stick` the action and its route (`open.js stick`, `window.js stick`, `stick_note`). Names nobody sees follow the bundle ID, `net.smithnz.carl.scratchnstick`: the `.scratchnstick` sidecar folder, the `.scratchnstick-save-…` and `.scratchnstick-move-…` temporary files, and the `scratchnstick_*` variables.

Sticky notes don't float above other windows (Alfred UI can't), so the user guide mustn't promise that.

## How it fits together

### Alfred objects

| Input | Runs | Leads to |
|---|---|---|
| Keyword `{var:keyword}` (Script Filter), optional hotkey | `list.js` | ↩: the quick view's Alfred UI object (Open within Alfred), or for a sticky note a Conditional on `sticky` to the stick route. ⌘↩: the stick route. ⌥↩: `trash.js` → Post Notification. ⌃↩: Reveal in Finder. |
| Keyword `{var:keyword_new}` (Script Filter) | `new.js` | ↩: the quick view. ⌘↩: the stick route. |
| Keyword `{var:keyword_new_sticky}` (Script Filter) | `new.js "$1" sticky` | ↩: the stick route. ⌘↩: the quick view. |
| Keyword `{var:keyword_sticky}` (Script Filter), optional hotkey | `list.js "$1" stickies` | A Conditional on `sticky_action`: `show` / `close` to `stickies.js`; otherwise the stick route. |
| Universal Action "New scratch note" | `open.js quick` with `new=1` | The quick view |
| Universal Action "New sticky note" | `open.js stick` with `new=1` | The stick route's Conditional |
| Optional hotkey, new note | Arg and Vars (`new` = 1) | The stick route |
| External Trigger `notify` | | Post Notification (notifications from scripts) |

**The stick route** is the Run Script `./scripts/open.js stick "$1"`, then a Conditional on `open_window`, then the sticky Alfred UI object (Launch Externally). The quick view's Alfred UI object connects on to the stick route, so a quick view that finishes with `stick_note` set (Stick to the desktop) opens the sticky window. See [Note windows](dev/docs/windows.md#the-routes).

Alfred UI objects are given the path of a bundle generated for each note (`{query}`). A note window's actions run `scripts/window.js` (and two small zsh scripts) by absolute path.

### Scripts

All JXA unless noted.

| Script | Does |
|---|---|
| `scripts/lib.js` | Shared code, loaded by every script: configuration, the notes folder and its move, the note store, sidecars, titles and previews, the palette, icons and images, building and writing window bundles, the page, window state, and sticky windows. Fuller notes are in its comments. |
| `scripts/text-rules.js` | The hand-tuned rules about a note's text, loaded beside `lib.js`: a new note's heading (`newNoteText`), a new sticky note's size (`fittedNoteSize`), and splitting a one-line note into title and preview (`splitTitleLine`), with their tuning as constants at the top. Uses nothing from `lib.js`. |
| `scripts/list.js` | The results list's Script Filter; writes each note's quick bundle when out of date, and the theme stylesheet. With `stickies`, the sticky notes list. |
| `scripts/new.js` | The new-note keywords' Script Filter (`sticky` for `newsticky`), writing each result's quick bundle first. |
| `scripts/open.js` | `stick`: sticks a note (writes its sticky bundle, or brings its live window to the front). `quick`: writes a quick bundle. |
| `scripts/window.js` | A note window's actions: `launched`, `save`, `quit`, `toggle` / `edit` / `view`, `stick`, `colour`, `icon`, `fontsize`, `collapse`, `menu`, `trash`, `share`, `copyrich`, `copytext`, `tick`. |
| `scripts/changed.sh` | zsh. The web view's `changed` action: shows the page once drawn, passes task ticks to `window.js tick`. |
| `scripts/picker.sh` | zsh. Opens and closes the icon and colour pickers. |
| `scripts/stickies.js` | The sticky notes list's actions: `close [<id>]`, `show`. |
| `scripts/trash.js` | ⌥↩: closes a note's sticky window and moves the note to the Trash. |
| `scripts/move.js` | Moves the notes to a newly configured folder, in the background. |
| `scripts/place.js` | Moves a sticky window that opened on the wrong screen back where it was left, in the background. Doesn't load `lib.js`. |

`examples/` holds the example notes and their sidecars, laid out as a notes folder. `ui/` holds the templates a window's `ui.json` is built from (`window.json`, `content.json`, `customise.json`, `actions.json`, `menubutton.json`, `windowbuttons.json`, `titlestrip.json`, `collapsedtitle.json`, `keyhints.json`), Preview's page (`view.html`, `view.js`) and `appicon.png`, sticky windows' app icon. `vendor/markdown-it/` is markdown-it 15.0.3. `icons/` holds the images that ship: button icons, drop-down shadows, and New note's icons.

### Where things are kept

| Path | What |
|---|---|
| Notes folder (`$alfred_workflow_data/notes/` by default) | `<id>.md`, one per note |
| `<notes folder>/.scratchnstick/<id>.json` | Each note's metadata sidecar: created, colour, icon, font size, mode, collapsed, and once the note is gone, when it went (kept 30 days) |
| `$alfred_workflow_data/state.json` | `lastNotesFolder`, the folder the notes were last in, to notice a change of setting, `lastSidecarSweep`, when sidecars were last swept, and `examplesInstalled`, when the example notes were added |
| `$alfred_workflow_cache/quick/<id>.alfredui` | Each note's quick view bundle, and `quick/.index.json`, their fingerprints |
| `$alfred_workflow_cache/windows/<id>.alfredui` | Each stuck note's sticky window bundle, kept so its saved position stays |
| `$alfred_workflow_cache/state/<id>.json` | An open window's state: form, PID, mode, collapsed; `<id>.picker` while a drop-down is open |
| `$alfred_workflow_cache/icons/` | Badges and dots, made when needed |
| `$alfred_workflow_cache/theme.css` | The quick view's colours from Alfred's theme |
| `$alfred_workflow_cache/move.lock/`, `move-failure.json` | A notes folder move in progress, and the last failed one |
| `com.runningwithcrayons.Alfred-UI` defaults | Sticky windows' saved frames, one per bundle path |

A bundle holds `ui.json`, `context.json` (what the window's scripts need from the settings, as Alfred UI scripts don't get User Configuration), and Preview's `view.html` and `note.js`.

### Language

Everything is JavaScript for Automation (JXA), as external script files with an `osascript -l JavaScript` shebang: JSON is native (Script Filter output, Alfred UI actions), string handling is Unicode-safe, Cocoa is there through the ObjC bridge (atomic writes, file dates, the Trash through Finder), and it ships with every macOS that Alfred 6 supports. It costs about 70 ms to start `osascript`. zsh is used only where Alfred waits on every event and start-up time shows (`changed.sh`, `picker.sh`). zsh with `jq` was rejected for this much text handling (and `/usr/bin/jq` only ships from macOS 15); Swift would need signed, notarised binaries; Python no longer ships with macOS.

### Loading lib.js

JXA has no `require`, and `Library()` only loads from `~/Library/Script Libraries`, which a workflow can't ship in. So each script ends with this function, and calls `loadLib(argv, "lib.js")` and then `loadLib(argv, "text-rules.js")` first thing in `run` (a script that loads only `lib.js` fails when it reaches titles or new notes):

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

- It finds `lib.js` from the script's own path (in `osascript`'s arguments, just before `argv`), not the working directory, so it works from Alfred, from an Alfred UI action running a script by absolute path, through a symlinked workflow folder, and from a terminal anywhere.
- The indirect `eval` runs the file in the global scope: its function declarations become globals, while its top-level `const` and `let` stay private to it, so a value a script needs (the palette, say) comes from a function. It mustn't have `"use strict"`, which would keep the functions private too.
- All functions share one namespace, so `lib.js` names them for what they do (`noteSummary`, not `summary`), and a script mustn't define a function with the same name.
- `lib.js` and `text-rules.js` mustn't use regular expression lookbehind (`(?<=…)`, `(?<!…)`): macOS 12's JavaScriptCore can't parse it, and the whole file fails to load.

## Configuration

User Configuration (saved in the gitignored `prefs.plist`):

| Variable | Type | Default | Notes |
|---|---|---|---|
| `keyword` | text | `scratch` | The results list |
| `keyword_new` | text | `newscratch` | New note keyword |
| `keyword_sticky` | text | `sticky` | Sticky notes keyword |
| `keyword_new_sticky` | text | `newsticky` | New sticky note keyword |
| `show_new_note` | checkbox | on | "New note in list". Off hides New note with no query; a query that matches nothing still offers New note: \<query>. |
| `notes_folder` | folder picker | blank: `$alfred_workflow_data/notes/` | Changing it moves the notes and closes sticky notes, as its description says. |
| `font_size` | slider, 11–20 | `14` | "Default font size", for notes without a size of their own |
| `sticky_corner_radius` | slider, 0–16 | `10` | "Sticky note corners": a sticky window's `cornerradius`, set when it opens. At most half a collapsed window's height (32 pt), as the radius can't change when the window collapses (see [Alfred UI](dev/docs/alfred-ui.md#windows)). Its own option, not the shared `corner_radius`, whose wording is about window buttons this workflow doesn't have. |
| `default_colour` | popup, Colour 1–6 | `1` | |
| `colour_1`–`colour_6` | text | the default palette, e.g. `Yellow #FEF49C #DBC503` | A slot's name and one or two hex colours; see [Colours and icons](dev/docs/colours-and-icons.md#custom-colours) |

Window scripts don't get these, so `list.js`, `new.js` and `open.js` write what a window needs into its bundle's `context.json`; a changed setting reaches a window the next time it opens.

## Detailed notes

- [Storage](dev/docs/storage.md): the notes folder, IDs, sidecars, titles and previews, saving, empty notes, the Trash, sweeping sidecars, the example notes, and moving the notes folder.
- [Results and new notes](dev/docs/results.md): the results list, the sticky notes list, creating notes and text as a heading.
- [Note windows](dev/docs/windows.md): quick views and sticky notes, the routes, generated bundles and templates, window state, seamless quick views, saving, escaping Alfred's placeholders, and window positions.
- [Window layout and controls](dev/docs/window-ui.md): the top row, keys, key hints, drop-downs, collapsing, the actions menu, font sizes, and a new sticky note's size.
- [Preview](dev/docs/view-mode.md): the web view, markdown-it, task boxes, and showing the page without a flash.
- [Colours and icons](dev/docs/colours-and-icons.md): the palette and custom colours, note icons, the images and how they're made, macOS 12, and the workflow's own icons.
- [Alfred UI and Alfred behaviour](dev/docs/alfred-ui.md): undocumented behaviour of Alfred and Alfred UI that the workflow relies on.
- [Planned](dev/docs/planned.md): features planned for after the first release, with what's known about each.

Undocumented Alfred behaviour this workflow has hit is collected in the last; requests to Alfred's developer are in the repo's [Alfred requests](../../Alfred%20requests.md).

## Development and testing

### Tests

Run from anywhere; each uses temporary folders from `mktemp`, deleted afterwards, and opens no windows.

| Script | Tests |
|---|---|
| `dev/test-storage.sh` | `lib.js`'s storage functions (with `dev/test-storage.js`): loading `lib.js` from other folders and through symlinks, IDs, saves (birth time, tags, modification time, racing processes), sidecars and their daily sweep, the example notes (and the shipped ones' sidecars), titles and previews (Unicode, `text-rules.js`'s cases), empty notes, the Trash (`SKIP_TRASH=1` skips it; it trashes only a note it made), `fittedNoteSize`, and moving the notes folder, including to another volume on a disk image (`SKIP_VOLUME=1` skips it). About 8 s plus the move tests. |
| `dev/test-list.sh` | `list.js` and `new.js`: results and searching, result icons (badges, dots, the cache and its sweep), the quick bundles and when they're rebuilt, the theme stylesheet, the palette and its problems, macOS 12, the sticky notes list (sticky notes given in `scratchnstick_sticky_ids`), the example notes added on a first run, and the new-note keywords' results (from a private pasteboard, not the clipboard). |
| `dev/test-window.sh` | `open.js`, `window.js`, `changed.sh` and `picker.sh`: bundles and templates in both forms and modes, escaping, saving, the mode switch, ticks, colours, icons and the pickers, font sizes, collapsing, the actions menu and its actions, macOS 12's windows, a new sticky note's size, saved window frames, and the page's task rule run in JXA with the vendored markdown-it. |

Run the three after any change to `lib.js`, the templates or a script, with `alfred_workflow_data` set as well to cover the move checks. `dev/test-window.sh` checks the drop-downs' sizes, so update it with `NOTE_WINDOW_LAYOUT`.

### Testing in Alfred

The tests can't drive Alfred, open windows, or see what's drawn, so window behaviour and look are checked in Alfred, by hand or by scripts:

- Use a throwaway note (or the samples: `dev/install-samples.js` installs eight, `sample1`–`sample8`, into the notes folder, resetting their text, sidecars and dates) and delete only notes you made and confirmed. Ask before touching the user's own notes.
- To run something as Alfred does (with Alfred's permissions, or to open a sticky window from a test bundle), add a temporary External Trigger to the object you need and run it with AppleScript's `run trigger`; remove it afterwards and reload Alfred.
- `CGWindowListCopyWindowInfo` gives windows' bounds without any permission; `lsappinfo front` gives the active app (`NSWorkspace`'s `frontmostApplication` goes stale in a script without a run loop). Screenshots and 60 fps screen recordings show timing and flashes.
- Posted key events reach a window's process, but Alfred reads modifier keys live, so ⌘↩ in Alfred's results has to be pressed by hand; posted drags don't move windows. See [Alfred UI](dev/docs/alfred-ui.md#shortcuts-and-keys).
- `scratchnstick_macos_version` set to `12` in the workflow's variables shows macOS 12's window on a newer Mac (remove it afterwards). The build is also checked on macOS 12 and 13 in virtual machines.
- `dev/sticky-size-test-cases.txt` has sample texts with their expected sticky window sizes.

### Development files

Everything in `dev/` is development only (excluded from builds by `.wfignore`):

| Path | What |
|---|---|
| `dev/docs/` | These notes' topic files |
| `dev/test-*.sh`, `dev/test-storage.js` | The tests |
| `dev/install-samples.js` | Installs the sample notes; outside Alfred it reads `notes_folder` from `prefs.plist` |
| `dev/make-icons.js` | Draws the button icons and drop-down shadows that ship; `--review <folder>` draws every badge and dot to look at. See [Colours and icons](dev/docs/colours-and-icons.md#devmake-iconsjs). |
| `dev/lucide/` | Lucide's source SVGs (`lucide-static` 1.80.0), its `LICENSE` and `VERSION` |
| `dev/icons/` | The workflow's own button icons in Lucide's style (`close`, `text-size`) |
| `dev/icon.svg`, `dev/note.svg`, `dev/slate.svg` | Sources of `icon.png` and New note's icons. See [The workflow's own images](dev/docs/colours-and-icons.md#the-workflows-own-images). |
| `dev/appicon.icon` | Icon Composer document that `ui/appicon.png` is built from. See [The workflow's own images](dev/docs/colours-and-icons.md#the-workflows-own-images). |

## Still to do

Before the first release:

- The example notes' content, in `examples/` (placeholders so far).
- Check that `examples/.scratchnstick/` survives installing the built `.alfredworkflow`.
- The user guide in `README.md` (with the names above, how to collapse a sticky note, and that sticky notes don't float), then `bin/wf sync-readme scratch-n-stick`.
- Check by hand in Alfred:
  - Custom colours: the Configuration sheet's fields and description, a slot that can't be read (the results and the notification), and a renamed, recoloured slot in the results, quick view and a sticky window.
  - `newscratch`: blank, with text and from the clipboard; ↩ seamless and ⌘↩ sticky. `newsticky`: ↩ sticks each of its three results with its text, and ⌘↩ opens the quick view. The hotkeys, once assigned.
  - The sticky notes list: ↩ (Alfred closes and the window comes to the front, whether or not it was in front), ⌘↩ and Close all (notes saved, and reopening where and as they were), Show all, and its hotkey.
  - Window positions: a note left on another display, closed, and stuck again with ⌘↩ and from its quick view.
  - Preview's fades: scrolling, ↓ and Home after a click in the page, and a translucent theme.
  - The icon picker in a sticky window at its minimum width (220 pt), which it doesn't fit; perhaps raise the minimum.

Later: see [Planned](dev/docs/planned.md) (reloading windows on changes made elsewhere, dark appearance, the workflow's own Quick Look preview, and images in the example notes).
