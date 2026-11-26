# Alfred UI and Alfred behaviour

What Alfred and Alfred UI do that the workflow depends on, found by testing (macOS 27.2, Alfred 6) and by reading Alfred's framework, and mostly not in Alfred's docs. Check these after Alfred updates. Part of Scratch'n'Stick's [developer notes](../../DEVELOPMENT.md).

Class names (`AUIView`, `AUIWebKitView`, `AUIMenu`…) are in Alfred's framework, where undocumented keys can be found.

## Processes and launching

- **Each externally launched UI is its own process** of `Alfred UI.app` (inside `Alfred 6.app/Contents/Alfred UI/`), started with `open -n` and the bundle path as its argument; each process has exactly one window. Two launches of one bundle give two independent windows. The stream's argument is passed as a further launch argument.
- **"Open within Alfred" runs in Alfred's own process**: the UI shows in Alfred's window, no helper starts, and its scripts run as children of Alfred, synchronously. It only works while Alfred's window is showing: opened while Alfred is hidden, it closes at once (firing `quit`).
- **A script in a quick view must never wait on Alfred.** One that calls Alfred over AppleScript (`run trigger`) and waits for the reply deadlocks Alfred until the AppleEvent times out (2 minutes), with no way to quit Alfred normally. Send it in the background and return; killing the stuck `osascript` releases Alfred.
- **An Apple event from a process that has quit is refused**: a sticky window's background `run trigger` that reached Alfred after the helper had quit got -1743 ("Not authorised to send Apple events to Alfred 6"), as macOS checks events against the app responsible for the sending process. Wait for the call before closing.
- **The Alfred UI object's path takes placeholders** (`{query}`, `{var:…}`), resolved per run.
- **Variables**: a UI's scripts get the `alfred_*` variables (`alfred_workflow_cache` and so on), and the workflow's variables only if declared in `ui.json`'s `variablesconfig` (`{ "note": { "src": "variable", "scriptenv": true } }`), which the helper reads from the `__alfredui_variables` environment variable. They don't get User Configuration. Variable persistence (`persist`) is keyed on the UI's `bundleid`, so all windows of one UI share it.
- **A window's PID**: its scripts' parent PID is the helper's (or Alfred's, in a quick view).
- **A new window takes keyboard focus**: the helper activates on launch. Keystrokes meant for another app land in a window as it opens, which matters if windows are ever reopened in bulk.
- **Launching the helper directly** (`open -n … --args <bundle>`, even with Alfred's `__alfredui_*` variables) doesn't reliably show a window; go through an Alfred UI object (a temporary External Trigger works for tests).
- **Accessibility**: scripts Alfred runs, and background processes they start, have Alfred's Accessibility permission. A window's own scripts are run by Alfred UI, which doesn't (`AXIsProcessTrusted` false, -25204).
- **The process's name** is "Alfred UI", from the helper's bundle, and a workflow can't change it (`_LSSetApplicationInformationItem` reports success and does nothing). `ui.json`'s `iconpath` sets its app icon, once, as it finishes launching (`setupIcon`); see Now Playing's developer notes.

## Window lifecycle and events

- `root` goes inside `window` in `ui.json`; at the top level the helper creates a window and never shows it.
- The root view's `events` take `launched` and `quit`; a top-level `events` key doesn't fire.
- **`quit` fires however a window closes**: its close button, ⌘W, an Esc shortcut followed by `finish`, a `finish`, `NSRunningApplication`'s `terminate` (the process exits after the `quit` script's writes, about 100 ms later), and for a quick view Alfred's window closing for any reason. It doesn't fire when the process is killed. `{value:<id>.text}` still holds the final text then.
- **`typingstopped`** on a `textarea` fires about a second after typing stops; `{value:editor.text}` gives the whole text, newlines included. It still fires for a `textarea` that has just been removed from the window, and `{value:editor.text}` is then empty.
- **Esc in a quick view** is handled by Alfred, which closes; a `⎋` shortcut doesn't run there, but `quit` does.
- A quick view's `finish` carries on down the Alfred UI object's output connection, with the variables it set.

## Windows

- **Window keys** (`AlfredUIWindow`): `borderless`, `cornerradius` (borderless only), `closeable`, `minimizable` / `minimisable`, `resizeable`, `fullscreenable`, `movablebybackground`, `frameautosave`, `minsize`, and the title bar's. None hides a single traffic light.
- **Height**: a window asked for a height comes out 32 pt shorter, borderless or not.
- **The corner radius** (`cornerradius`) is set when the window opens, on its content view (`AlfredUIWindowMagicContentView`, an `NSVisualEffectView`), and nothing changes it while it's open. It isn't limited to half the window's height: a radius larger than that makes the window's short ends pointed rather than round.
- **The title** is set when the window opens and can't change while it's open: neither an `update` of the window nor a `window` action with a `title` changes it. It's read by ⌘-Tab, the Dock and window switchers even when hidden.
- **The `window` action** can only `resize` (`resizeWindow:`, the content size). It can go below `minsize`, which only limits resizing by hand; a `resize` with only a `height` keeps the width; it keeps the window's top edge where it is. `minimise`, `zoom` and `deminiaturise`, as `window` actions or through the `functions` action, do nothing on a borderless window, and ⌘M beeps.
- **Dragging**: an `AUIView` drags its window when `movablebybackground` is on (`mouseDownCanMoveWindow`, `performWindowDragWithEvent:`), even with `mousedown` and `doubleclicked` events, unless its JSON sets `vetomovablebybackground`. Alfred's container for a view in its own window allows it unless the window's `movablebybackground` is false. A web view refuses, and the area under it can't drag the window even through views laid over it. Labels don't stop a drag. Posted mouse events can't test dragging.

### Window frames

- With `frameautosave: true`, AppKit saves the frame as `NSWindow Frame <bundle file name>-<SHA-1 of the bundle's path>` in the `com.runningwithcrayons.Alfred-UI` defaults. The path is standardised (`/private/tmp/…` as `/tmp/…`) but symlinks aren't resolved. The window's `id` and `title` don't affect it, and a string `frameautosave` isn't used as a name. So windows of one bundle path share one position, and a per-note path (a folder or a symlink) gives each its own.
- The value is the window's x, y, width and height, then those of the visible frame of the screen it was on, in AppKit's coordinates (`4504 -868 360 279 3440 -944 1440 2530`).
- `AlfredUIWindow` calls `setFrameUsingName:` (falling back to `center`), then `setFrameAutosaveName:`; it moves a window onto the main screen only if it's larger than the screen. It chooses no screen itself.
- **AppKit restores a frame only on the active screen.** A frame saved on another screen comes up at the same relative place on the active screen (scaled by the space each screen leaves beside the window), and the moved frame is then saved. A faked frame is pulled back onto a visible screen. With no saved frame, Alfred places new windows at different uncentred positions.
- A window can be moved to another screen through Accessibility (`AXPosition`), given the permission.

## Layout and components

- A view's `padding` is a single number; per-side spacing is `insets` in a child's `constraints`.
- A vertical `inline` root doesn't fill the window: it centres its contents. A `border` root fills it, but a `top` region needs an explicit `size: { height }` or it collapses.
- A `stack` layout layers its components, the last on top; a hidden component elsewhere still takes up space.
- An empty view stretched horizontally with a `size` of only a `height` fills the whole window. Placed at the top (`position: top`) with an empty fixed-size view inside, it takes that view's height.
- Every component takes `opacity` (0–1, `AUIFactory`). An opacity set before a web view first draws is lost (though 0 still hides it until then); an `update` after it has drawn holds.
- A view's `border` is `{ "width", "colour" }` (`AUIView`). Its `background` as `rgba(…)` didn't show in one test, where a hex colour with `opacity` did.
- A view's `appearance` applies to everything inside it, menus included; only the title bar follows the window's.
- Only macOS's named colours adapt to the appearance; hex, `rgb()`, `hsv()` and `ui.json`'s `colours` constants are fixed. Inside Alfred's window, a named colour such as `secondaryLabelColor` can resolve to different appearances for different labels, so set colours explicitly there.
- **Labels**: an `update` of a label's text doesn't re-measure it, so text that changes length needs a `replace` of the label or its view. `linebreak: "truncatetail"` cuts a long label with "…".
- An `update` naming an id the window doesn't have ignores it, and applies the rest.
- An empty view laid over content gets mouse events (`mousedown`, `doubleclicked`), and scrolling still reaches what's under it, but it blocks selecting text and clicking links there. `doubleclicked` fires only when the view also handles `mousedown` (an empty `json` action).
- There's no popover component, no shadow (`blur` is the window's, `effect: glass` a button's), and no event for a click outside a view. The framework has an untested `grid` layout (`AUIGridLayout`).

## Shortcuts and keys

- `shortcuts` on any view work, not only the root; a shortcut on an inner view runs only while the focus is inside it. Root shortcuts run on the first press whether or not a web view has focus.
- A shortcut's action can be an array of actions.
- `"⌘↩"` matches ⌘ with Return (key code 36), not the keypad's Enter. In a quick view Alfred doesn't act on ⌘↩ or ⌘1–⌘9 itself, and doesn't follow the UI object's connection on ⌘↩.
- `⌘=`, `⇧⌘=`, `⌘-` and `⌘0` each fire; a key fires only one shortcut; `⌘+` doesn't fire for ⇧⌘= on a US layout.
- The space key is `␣` (U+2423); see Now Playing's developer notes.
- For tests: System Events' `keystroke return` doesn't trigger a ↩ shortcut, while a posted Return key event does; ⌘↩ from System Events does.

## Menus

`popupmenu` and `menu` aren't documented (`AUIMenu`, `AUIActionJSONProcessorPopupMenu`):

- `{"popupmenu": {"src": "<component id>", "menu": [items]}}` is an action, which a script can print too, that pops up a menu over that component, at its top-left, with the first item under the pointer.
- An item is `{"text", "state", "action", "submenu"}`, or `{"type": "separator"}`. `"state": "on"` shows ✓ and `"mixed"` –. An item without an `action` is greyed out. Items take no image and no key equivalent; a `●` in the text takes the text colour.
- An item's `action` is any action (a `script`, `json`, or an array), and nothing says which item was chosen, so each carries its own.
- Every component's `menu` key is its right-click menu (`setMenu:`). A click on a child without a menu shows its parent's. A `textarea` or `markdownarea` keeps its standard text menu.
- A menu takes the appearance of the view it opens from. In a quick view a menu doesn't close Alfred; Esc closes only the menu.

## Images

- A button's or `imageview`'s `image` (`AUIImage`) reads only `type`, `src` and `size`. `{"type": "file", "src": "<path>", "size": {…}}` shows a file at that size; without `size` it's drawn at its own pixel size, so every file image needs one. A relative `src` is from the bundle's folder. On a symbol, `size` has no effect: its size follows the button's `font`.
- A file image can't be tinted: it's loaded with `initWithContentsOfFile:` and never made a template, so `template` and `contenttintcolour` do nothing, and a file named `…Template` isn't one either.
- A bordered button draws its bezel behind a file image, which can mark a choice; a bordered button doesn't tint its symbol (it's drawn in the label colour), so a bezel can't mark a coloured symbol.
- SVG works as a button's file image and as a Script Filter result's icon on macOS 13 and later. On macOS 12 NSImage can't read SVG, and an image that can't be read makes Alfred UI reject the window ("Invalid Alfred UI: The file you're trying to open does not exist or have valid json"); in a quick view it crashed Alfred. On newer macOS a missing or non-image file just shows a blank button, and a missing `iconpath` is ignored.
- An `imageview` gets no `clicked`, so clickable images are buttons.

## Web view

`webkitview` (`AUIWebKitView`):

- Keys: `src`, `openlinksexternally` (a boolean, or a regular expression of links to open in the browser) and `text`. A `src` naming a file in the bundle loads as a `file://` URL; any other `src` without a scheme gets `https://`. `text` loads HTML with `loadHTMLString:baseURL:`, but that page can't load local scripts and sends no `changed`. Action functions `back`, `forward`, `reload` exist, untested. It ignores `background`.
- Its value, `{value:<id>.src}`, is the current URL. It sends `changed` whenever that changes, including only the fragment (`location.hash`, `history.replaceState`), and as a page starts to load; `preload` and `launched` too.
- An `update` of `src` reloads the page. It must be an absolute `file://` URL: a relative one becomes `https://…`, fails, and the web view goes back to the previous URL and sends `changed` again, so a script answering every `changed` with an `update` loops.
- A page can load scripts and stylesheets by absolute `file://` URL from any folder, including through symlinks, but `fetch` and `XMLHttpRequest` fail, even for a file beside it.
- WebKit keeps a page's scripts: a reload runs the old script until the script's own URL changes. A new web view reads them afresh.
- It's opaque: WebKit paints `#1E1E1E` (dark) or white (light) under the page, never turned off (`drawsBackground`). A new web view shows only that for 130–200 ms before the page first draws, however little the page does; a hidden web view doesn't draw at all.
- The page takes the appearance Alfred gives its window (`prefers-color-scheme`, `-apple-system-label`).
- Selection, ⌘C, scroll wheel (overlay scroller), and links (`openlinksexternally` opens them in the browser and the page stays) all work. After a click in it, the page has the focus.

## markdownarea

Alfred's own Markdown renderer: headings, lists, code blocks, tables, quotes, images, links, bold, italic and inline code; no raw HTML and no task boxes (`- [ ]` shows its brackets). Display-only, and it takes every click itself, sending no `mousedown`, `clicked` or `doubleclicked`; `selectable: false` and `focusable: false` don't apply; the first ↩ after a click in it only moves the focus. Its `urischemes` only sets which link schemes are clickable. Four undocumented spacing keys: `linespacing`, `paragraphspacing`, `listspacing` and `lineheightmultiple` (below 1 misplaces bullets); `0`, `6` and `2` for the first three suit notes. Heading sizes and bullet style can't be changed.

## Share

`{"share": {"src": "<path>"}}` opens macOS's share menu for one file. `src` must be a file's path (not a `file://` URL); any other string is taken as a file named after its last path component, which doesn't exist. Its other keys are ignored (`text`, `items`, `path`, `file`, `files`, `paths`, `url`). The menu opens at the top centre of the window, or under it when there's no room above. There's no sharing text.

## Placeholders

Alfred UI expands `{var:…}` and `{const:…}` in every string it's given: `ui.json` text, the window title, and text in `update` and `replace` actions. An unknown name becomes empty, a match can span lines, and matching is case-sensitive (`{VAR:x}` is left alone). Action arguments also expand `{value:…}` and `{data:…}`. `{file:…}`, `{fileraw:…}`, `{query}` and `{date}` aren't expanded in component text. Text typed into a window reaches a script through `{value:…}` as typed.

`{file:…}` inserts a file's contents as typed JSON, but its path can't contain a placeholder (see Now Playing's developer notes).

## Script Filters and Alfred's flow

- **Seamless quick views**: only a Script Filter connected straight to an Alfred UI object replaces the results with the view from one frame to the next. Anything between (a Run Script, even one that only echoes, or a Conditional) makes Alfred hide its whole window on ↩ and fade the view in over about 170 ms.
- **`queuemode` 2** stops the run in progress on each keystroke by sending SIGTERM to its whole process group, so background children die too, even disowned with `&!`. A JXA script that calls `setsid()` (`ObjC.import("unistd")`) survives. AppleScript's `search` with a new query doesn't stop the previous run, so it can't test this.
- **`uid` and learning**: with `uid`s, Alfred's knowledge reorders results; `skipknowledge: true` stops new learning but still sorts by old entries (rows of `knowledge` in `~/Library/Application Support/Alfred/Databases/knowledge.alfdb` with `item` `<Script Filter object uid>.<item uid>`).
- **`mods`** can change a result's subtitle, icon, arg and variables, but not its title.
- **Universal Actions**: Alfred offers every Keyword and Script Filter that takes an argument as an action on text unless "Treat Input as Universal Action" is off (`skipuniversalaction` in its config).
- **A Conditional's else output** is a connection with no `sourceoutputuid`, with `hideelse` off; Alfred keeps it when it saves.
- **Object icons** in the workflow editor are read only from `<object UID>.png` in the workflow's folder; symlinks work.
- **Theme**: Script Filters get `alfred_theme_background` (`rgba(r,g,b,a)`) and `alfred_theme`; a theme's `theme.json` is at `$alfred_preferences/themes/$alfred_theme/theme.json`, and some have `appearanceMode` in their `alfredtheme` object.
- **Alfred's window opens without making Alfred the active app**: the app in front stays active. Alfred closes when it loses focus to an app being activated, so activating an app that's already active doesn't close it.
- `alfred://runtrigger/<bundle id>/<trigger>/?argument=…` runs an External Trigger (with `availableviaurlhandler`) without an AppleEvent.

### Quick Look

With a `quicklookurl` naming an `.html` file (a path or a `file://` URL), ⇧ shows it in macOS's Quick Look panel, titled with the file name, with "Open with" offering the default browser. Rendered Markdown, a background tint, inline SVG, `data:` images, and an image and stylesheet beside the page (relative paths) all work; an absolute `file://` image elsewhere doesn't load, and JavaScript is off. `prefers-color-scheme` reports light in light appearance; dark is untested.
