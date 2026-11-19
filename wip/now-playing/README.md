# Now Playing

Developer notes. A small Alfred 6 panel showing the current track (artwork, title, artist, album, playing app, elapsed time) with playback controls.

For user docs, see the [Now Playing page on the Alfred forum](https://www.alfredforum.com/) (TO-DO: link the workflow's own page once it's posted).

## How it works

The ⌃N hotkey runs `scripts/window.sh` (a Run Script object), which builds the window definition from the preferences, then opens an Alfred UI object, which loads the `nowplaying.alfredui` bundle. The keywords (`nowplaying` and `np` by default) show the current track as an Alfred result first (see [Alfred result](#alfred-result)); actioning it opens the same panel, through the same Run Script. The keywords are set in the workflow's configuration; see [Preferences](#preferences).

- `ui.json` holds the pulse and the app icon (`iconpath`), and loads the window from the file `window.sh` writes; see [Window](#window) and [App icon and name](#app-icon-and-name).
- `window.json` is the template for the window (a resizeable dark panel, at least 280×240): a `{ "id": "toprow" }` placeholder that `window.sh` fills with `parts/toprow.json`, then a `{ "id": "content" }` placeholder that it fills with the artwork and track details for the current layout; see [Layouts](#layouts).
- `parts/toprow.json` is the top row: the playing app's icon (26pt) and name (14pt) in an `app` view, right-aligned, then the rotate button (14pt); see [Playing app](#playing-app) and [Layouts](#layouts). `parts/art.json` is the artwork image view, stacked with the `defaultapp` view (the default app's icon and the transparent `opendefault` button over it; see [Default app](#default-app)), `parts/text.json` the title (21pt bold), artist (19pt) and album (17pt) labels, 6pt apart (`parts/idle.json` takes its place when nothing is playing; see [Default app](#default-app)), and `parts/controls.json` a progress bar with elapsed time and duration above a row of five buttons (back 15 seconds, previous, play/pause, next, forward 15 seconds). The buttons' symbols are enlarged with `font` (size 19; a button's symbol size follows its font size), and the buttons made taller to fit with a `size` constraint (`{ "height": 31 }`), which Alfred applies to the button's frame, stretching the bezel to fill it. They measure 30pt tall in a screenshot, leaving at least 4.5pt above and below the tallest symbols (the 15-second arrows, which sit slightly low); without the constraint a bordered button is 19pt tall at the default font, and a larger font alone grows it only a little. Alfred UI has no control size setting. Change the font and height together, and check the padding in a screenshot. Components that get updated have `id`s: `art`, `defaultapp`, `defaulticon`, `opendefault`, `title`, `artist`, `album`, `progress`, `elapsed`, `duration`, `playpause`.
- The `pulse` runs `scripts/poll.sh` every second (`intervalmode: delay`, so the next run waits for the previous one to finish), and immediately on open (`now: true`). `poll.sh` slows it down when nothing is playing; see [Pulse interval](#pulse-interval).
- `scripts/poll.sh` reads the player state (`load_track`) and prints a JSON `{update: {ids: {…}}}` object that sets each component's text, image, progress or visibility, plus a `replace` of the content view when it switches between the track details and the "No media playing" view (`with_content`), and of the app view when the playing app changes (`with_toprow`).
- Each button runs `scripts/control.sh <action>` asynchronously (`playpause`, `next`, `prev`, `back`, `forward`). Play/pause, next and previous send MediaRemote command (MRCommand) IDs through the adapter: `send 2` toggle play/pause, `4` next track, `5` previous track (`0` play, `1` pause and `3` stop are also available). It then waits 0.25s for the player to publish its new state and runs `poll.sh`, so the panel updates without waiting for the next pulse. Back and forward jump 15 seconds (`JUMP`); see [Jumping back and forward](#jumping-back-and-forward).
- `scripts/lib.sh` is sourced by all the scripts: it locates the bundle and sets `CACHE` and `DATA`, and defines the layout helpers `current_layout`, `layout_size` and `content_view` (see [Layouts](#layouts)), the idle helpers `default_app`, `idle_update`, `text_view`, `with_content` and `content_kind` (see [Default app](#default-app)), the top row helpers `app_view`, `toprow_view` and `with_toprow` (see [Playing app](#playing-app)), `adapter` (runs the vendored adapter), `adapter_installed`, `app_path` (an app's path from its bundle ID, cached; see [Playing app](#playing-app)), `load_track` (reads the player state, artwork and app into variables; see [Status messages](#status-messages), [Artwork](#artwork) and [Playing app](#playing-app)), `JQ_TIME` (jq `clock` and `position` definitions), `show_message` (puts a status message and SF Symbol in the panel instead of a track, hiding the app and timeline) and `with_pulse` (see below).
- `scripts/apppath.js` (JXA) turns a bundle ID into an app path with `NSWorkspace`.
- `scripts/openapp.sh` opens the playing app, or brings it to the front, when its icon or name is clicked; see [Playing app](#playing-app).
- `scripts/opendefault.sh` opens the default app when its icon is clicked while nothing is playing; see [Default app](#default-app).
- `scripts/window.sh` builds the window from `window.json`, the parts, the preferences and the saved layout; see [Window](#window).
- `scripts/layout.sh` switches the open panel's layout; see [Layouts](#layouts).

### Window

The window is forced to the `dark` appearance and dragged from anywhere on its background (`movablebybackground`). Its translucency comes from two layers: the window's `blur`, and a dark tint, the root view's (`panel`) `background`. The padding sits on the root view rather than the window so the tint reaches the edges.

With the window buttons preference on (the default), the window has a title bar with no title (`titlevisibility: false`), made transparent (`titlebarappearstransparent`) with the content extending up behind it (`fullsizecontentview`), so only the window buttons show, over the panel at top left, and the corners have the system's standard window rounding. The app icon and name sit at the top right to keep clear of the buttons. Minimise is disabled (`minimisable: false`) but still drawn as a grey dot, and zoom is enabled, since the window is resizeable: it grows the window as far as the screen and the layout's maximum size allow (see [Layouts](#layouts); `fullscreenable: false` stops it going full screen). Alfred UI has no option to hide either button or disable zoom, and no hover event that could show the buttons only while the pointer is over the window. With the preference off, the window is `borderless` (the title bar options are then ignored) and its `cornerradius` comes from the corner radius preference.

#### App icon and name

Alfred runs each open Alfred UI as its own process of a helper app, `Alfred UI.app` (inside `Alfred 6.app/Contents/Alfred UI/`), launched with the path of the `.alfredui` package. The helper has no icon of its own, so without one from the UI, ⌘-Tab, the Dock and window switchers such as AltTab show a blank placeholder. `ui.json`'s top-level `iconpath` sets the helper's application icon when the UI launches. A path starting with `/` or `~` is used as given, and any other path is relative to the `.alfredui` package. It's set to `appicon.png`, described below. The key isn't in Alfred's docs; it's read by `-[AlfredUI loadJSONAndConfigureUI:]` in Alfred's framework and applied by the helper's `setupIcon`, so check it after Alfred updates. A missing or unreadable file leaves the placeholder.

`icon.png` is `audio-waveform` from the [with icons](https://github.com/withevergrow/withicons) Soft 3D set (MIT, © with icons contributors; the licence ships in the workflow as `icon-LICENSE`, which covers `appicon.png` too), rendered from its SVG at 512×512 with `rsvg-convert -a -w 512 -h 512`. The SVG is available from Iconify as `withicons-soft3d:audio-waveform` (`https://api.iconify.design/withicons-soft3d/audio-waveform.svg`), and is kept as `icon-src/waveform.svg`.

The app icon is the same waveform on a squircle tile, so it sits with other apps' icons in switchers and the Dock; Alfred shows the bare `icon.png` for the workflow itself. `icon-src/make-appicon.py` builds `nowplaying.alfredui/appicon.png` from `waveform.svg` (run it after changing either; it needs `rsvg-convert` from Homebrew's librsvg). It follows the macOS icon grid: a 1024px canvas with an 824px superellipse tile (exponent 5, close to Apple's continuous-corner shape), a dark vertical gradient matching the panel, a faint top sheen and edge highlight, and a drop shadow, with the waveform 68% of the tile's width and its ground-shadow ellipses removed. `icon-src/` is development-only and listed in `.wfignore`, so it isn't in builds.

The window's title is `Now Playing` (`title` in `window.json`), hidden by `titlevisibility` but still reported to the accessibility API, which is what window switchers read. The helper also names its menu-bar app menu after the window title. The app's own name, `Alfred UI`, comes from the helper's bundle, so ⌘-Tab and the Dock (and window switchers set to show app names) label the panel `Alfred UI`. A workflow can't change that: only a process can change its own display name, and setting it from outside with LaunchServices' private `_LSSetApplicationInformationItem` reports success but has no effect. See [Alfred requests](../../Alfred%20requests.md#alfred-ui-an-app-name-for-the-uis-process).

#### Building the window from the preferences

Preferences reach an Alfred UI only as strings (through `variablesconfig`, `src: "variable"`), and the window's settings ignore a string where they expect a boolean or a number: a `"{var:…}"` placeholder for `borderless` or `cornerradius` has no effect, and an unquoted placeholder is invalid JSON, so Alfred can't load the UI at all. The update action can't change window properties once the window is open, so a script in the UI can't set them either.

A `{file:…}` placeholder, though, inserts a file's contents as JSON with their real types (for an object; a file holding a bare `true` arrives as the string `"true"`). So `ui.json`'s whole `window` is one placeholder:

```json
"window": "{file:~/Library/Caches/com.runningwithcrayons.Alfred/Workflow Data/net.smithnz.carl.nowplaying/window.json}"
```

`scripts/window.sh` writes that file: it takes `window.json` (the template, with the title bar settings), adds `borderless` and `cornerradius` when the window buttons are off, fills in the content view and window size for the saved layout, sets the tint to `rgb(18, 18, 20, (100 − transparency) ÷ 100)`, and moves the result into place atomically. A Run Script object runs it on every route into the Alfred UI object (the hotkey and both keyword results), so the panel opens with the current preferences and the file always exists when Alfred loads `ui.json`; if it doesn't, Alfred falls back to a default 800×600 window titled "Alfred UI".

The path is spelled out because `{file:…}` doesn't resolve a placeholder in its path (`{file:{const:alfred_workflow_cache}/window.json}` fails), though it does expand `~`. It must match `$alfred_workflow_cache`, so it changes with the workflow's bundle ID. Absolute and `~` paths in `{file:…}` aren't in Alfred's docs, so check this after Alfred updates.

At 100 transparency the tint is gone but the panel is still dark grey: that is the blur's own material, which the dark appearance darkens and the UI JSON can't adjust.

The thin black outline around the panel is the outline macOS draws around dark-appearance windows, and Alfred UI has no option to remove it. Turning `blur` off doesn't help: the window then gets an opaque black background, so the tint can't show anything through.

The panel closes with the window's close button, or with Esc (a `⎋` entry in the root view's `shortcuts`, running a `finish` action). The space bar toggles play/pause while the panel is in front: a `␣` entry (U+2423, open box) runs `control.sh playpause`, like the button. Alfred UI's docs don't name the space key; `␣` is the spelling it matches, tested against `space`, `Space`, a literal space, `⎵` and `spacebar`, none of which fire.

After a layout's starting size is set (on first open, or by a layout switch), the window reopens 32pt shorter (540 becomes 508, 300 becomes 268), then stays at that size: restoring the saved frame (`frameautosave`) seems to lose the title bar's height. Not yet investigated.

### Layouts

The rotate button (top right) switches between the two layouts: it runs `scripts/layout.sh toggle`. It shows the current layout's shape with a rotate arrow (the SF Symbols `rectangle.portrait.rotate` and `rectangle.landscape.rotate`, available from macOS 12) and a tooltip naming the layout it switches to; `rotate_button` in `lib.sh` gives these for a layout, `window.sh` sets them when building the window, and `layout.sh` updates them after a switch. (A Portrait / Landscape `popupmenu` was tried first, but it always opened with the first item under the pointer, whichever layout was current, and offered the current layout too.) The two layouts arrange the same components, so poll.sh and control.sh work with either:

- **Portrait** (starts at 340×540): the artwork fills the space between the top row and the details below it (the whole content is inset `PORTRAIT_GAP`, 6pt, below the top row): the text, then, after a wider gap (24pt), the controls.
- **Landscape** (starts at 620×348, where the artwork's cell is square): two equal columns, the artwork on the left and a details column on the right, inset 16pt (`LANDSCAPE_INSET`) from the top and bottom so the artwork clears the window buttons at the top left. The artwork is centred between the window's top and bottom edges. The inset applies in borderless mode too: `layout.sh` can't see the preferences (the UI's scripts only get variables listed in `variablesconfig`), and it's symmetric, so it costs only a little space. The details column is inset below the top row, with the controls at its bottom and the text vertically centred in the space above (`region: centre` with `position: centre`, `stretch: horizontal`). When the artwork fills its cell's height (a square image in a cell at least as wide as it is tall, as at the starting size), the controls are flush with the bottom of the artwork; when the window is taller than that, the artwork is centred with space above and below, and no longer lines up.

The root view is a `stack`: the content fills it and the top row (`parts/toprow.json`, `position: top`, `stretch: horizontal`) is laid over it, so the top row takes no space from the content. What must stay clear of it is inset by the row's height, `TOPROW_HEIGHT` (28, set by the 26pt app icon, which measures 2pt more as laid out), plus a gap: `PORTRAIT_GAP` (6) above the portrait artwork, `LANDSCAPE_GAP` (14) above the landscape details column. This keeps the landscape artwork centred in the window rather than in the space below the top row.

The artwork view fills its space either way, and `resize: fit` scales the image to fit it, keeping its aspect ratio and centring it, so it grows and shrinks with the window. Text and controls keep the same styles in both.

The window is resizeable. A layout switch sets the new layout's starting size; within a layout, `frameautosave` keeps the size the user chooses across reopens. The minimum, 280×240 (`minsize` in `window.json`), is shared by both layouts: a `window` JSON Action resizes the open window but ignores `minsize`, so the minimum set when the window opens stays in force after a switch, and separate minimums (portrait taller, landscape wider) would block one layout's shape. At the minimum, portrait shrinks the artwork to a thumbnail with all the details still showing, and landscape is cramped (two 116pt columns, the title truncated, 20pt buttons).

Each layout has its own maximum size (`layout_maxsize` in `lib.sh`, which `window.sh` sets as `maxsize`), mainly so the zoom button doesn't fill the screen: portrait 640×960, landscape 1000×560, where the landscape artwork's cell is about square. Alfred sets the window's minimum and maximum sizes only when it opens it (the `window` action's `resize` only sets the content size), so after a layout switch the previous layout's maximum stays until the panel is reopened. Each maximum is at least the other layout's starting size, so a switch never sets a size beyond it.

`content_view` in `lib.sh` builds the `content` view for a layout from `parts/art.json`, `parts/text.json` and `parts/controls.json`, adding the layout's container and constraints, and `layout_size` gives its starting size. `layout.sh` saves the choice to `$alfred_workflow_data/layout` (read back by `current_layout`, default portrait) and prints JSON Actions for the open panel: `replace` swaps the `content` view for the new layout's (Alfred then re-lays out the whole UI), `window` → `resize` sets the layout's starting size, and poll.sh's `update` is merged in so the new components show the track straight away. `window.sh` builds the panel in the saved layout when it next opens.

Both layouts can't live in the window with one hidden: Alfred's docs say a hidden component "will still take up space". Nothing documents changing a view's `layout` or a component's constraints with `update`, so `replace` is the way to rearrange.

The rotate button only responds to a real click: an accessibility `click` (AXPress) doesn't trigger its `actioned` event, which matters when scripting tests. Like most macOS buttons, its first click on an inactive panel only activates the window.

### Status messages

`load_track` sets `state` to `missing`, `error`, `idle` or `playing`. For the first three, `poll.sh` and `results.sh` show these in place of a track:

| Message                | When                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter not installed  | `vendor/` is missing the adapter script or framework                                                                                                           |
| Adapter error (*code*) | the adapter exits non-zero; the subtitle is the first line of its stderr, also saved to `$CACHE/last-error`. Stderr output with exit 0 is treated as harmless. |
| Nothing playing        | the adapter returns nothing or `null`                                                                                                                          |

The panel shows each message in the title and artist labels, with an SF Symbol in place of the artwork, except "Nothing playing": the panel shows the default app's icon instead, and its own "No media playing" view in place of the labels; see [Default app](#default-app). The Alfred result shows all three as listed.

### Default app

When nothing is playing, the panel has no controls (progress bar and buttons), as there's nothing to control. The text takes their space, raised by eye so it doesn't sit at the bottom: `IDLE_LIFT_PORTRAIT` (40pt above the bottom of the panel) and `IDLE_LIFT_LANDSCAPE` (18pt above the middle of the details column, which centres it on the artwork at the starting size), both in `lib.sh`. The panel shows the icon of the default app (the `default_app` preference, Music unless changed) in place of the artwork, and clicking it opens the app. Below it, in place of the track details, is `parts/idle.json`: Alfred's app icon, 88pt at 75% opacity, with "No media playing" (in the title's style, italic, at 80% opacity) stacked over the lower part of the icon (pinned to its bottom with `position: bottom` and raised by `insets.bottom`, 15pt, adjusted by eye), leaving the hat clear, and below that a hint, "Click <app> icon to launch" (15pt, secondary colour; empty when there's no default app).

`idle.json` is a border layout, with the icon and its text in the centre region and the hint in the bottom region, so that in a short space (a small landscape window) the icon shrinks and the hint keeps its full height. In an inline (stacked) layout the icon stops shrinking at about 47pt and the hint is cut through the middle of its line. The hint is 15pt, so it fits on one line in a landscape details column about 200pt wide (17pt needs about 215pt), and `truncatetail` ends it with an ellipsis in narrower windows rather than cutting off mid-letter. `text_view` in `lib.sh` fills in Alfred's icon (found by bundle ID with `app_path`) and the hint.

A hidden component still takes up space, so the idle view and the track labels can't both be in the panel with one hidden. Instead `with_content` replaces the whole `content` view, built by `content_view` with the idle or track text (and, for the idle kind, without `parts/controls.json`, so the text takes its space), when the kind of text changes. The kind last drawn is in `$CACHE/content-kind`, and `window.sh` and `layout.sh` build the content with that kind, so reopening the panel or switching layout while idle doesn't swap it back and forth. Error messages use the track labels. `with_content` and `with_toprow` set their `replace` entries by path, so both can be in one output. Alfred UI's fonts have no italic option, so the words are Unicode's Mathematical Sans-Serif Bold Italic letters (U+1D63C onwards), which macOS draws in a matching italic. The label's accessibility label is the plain text, so VoiceOver reads it normally. To change the words, regenerate the letters rather than typing them.

The icon is at most 256pt (`DEFAULT_APP_SIZE` in `lib.sh`), unlike album art, which fills the space. It has its own image view, `defaulticon`, in the `defaultapp` view in `parts/art.json`, stacked over the artwork view. The artwork view stretches to fill its space, and `resize: fit` scales the image both up and down; no `resize` mode only scales down, and constraints have no maximum size. `defaultapp` is centred without stretching, so it takes the icon's own size (the `size` of its `fileicon` image) and shrinks only when the space is smaller. `idle_update` in `lib.sh` hides the artwork view and shows `defaultapp`, or shows the `music.note` symbol as the artwork when the preference is empty or the app doesn't exist; track and status updates do the reverse.

The click goes to `opendefault`, a borderless button with no text or image, stacked over `defaulticon` and stretched to cover it, so only the icon is clickable. `idle_update` gives it an "Open <app>" tooltip. It's hidden with `defaultapp`, so clicking a track's artwork does nothing (and drags the window, as the background does). Its `actioned` event runs `scripts/opendefault.sh`. A `clicked` event on the artwork never fires, whether it's on the image view itself or on a view wrapped around it (tested with real clicks, which the control buttons received), unlike the top row's `app` view; the image view presumably takes the mouse-down to drag the window (`movablebybackground`).

The panel's scripts don't see the workflow's preferences, so `window.sh` saves the app's path to `$CACHE/default-app` when it builds the window, and `default_app` in `lib.sh` reads it back. Passing the preference to the UI through `ui.json`'s `variablesconfig` (`src: "variable"`, `scriptenv: true`) was tried first, but the pulse script didn't get it in its environment. A changed preference takes effect when the panel is next opened.

### Artwork

Fetching artwork is expensive (`get` returns it base64-encoded), so each pulse calls `get --no-artwork` and only does the full call when there is no cached artwork for the current track. Artwork is cached as `art-<hash>.<ext>` in `$alfred_workflow_cache` (shared by the panel and the Alfred result), keyed on a hash of player bundle ID, title, artist and album, so the image view never shows a stale image. The previous track's file is deleted when a new one is written. Artwork often arrives a moment after the track metadata, so a missing image is retried on every pulse until it appears.

### Playing app

`get` returns the player's `bundleIdentifier`. `load_track` resolves it to an app path with `apppath.js` and caches the result per bundle ID as `app-<bundle id>` in the cache folder (an empty file means no app was found), so the lookup only runs for a new player. The cache is never refreshed, so clear it if an app is installed or moved while the cache exists. The icon is an image view with `type: "fileicon"` and the app path as `src`; the name is the app bundle's file name without `.app`. Both are hidden when there's no bundle ID or app. Media playing in a browser shows the browser, not the site.

`apppath.js` is the one script in JXA rather than shell because the lookup needs a Cocoa API: `NSWorkspace`'s `URLForApplicationWithBundleIdentifier` gives Launch Services' own answer, the same app macOS would open for that bundle ID, and returns nil when there is none. The shell alternatives each have a catch: `mdfind "kMDItemCFBundleIdentifier == '…'"` depends on the Spotlight index and can return several copies (backups, mounted disk images, Xcode build folders) or none; AppleScript's `path to application id` errors or shows a "Where is …?" dialog for a missing app, and on some macOS versions launches it; `lsregister -dump` is slow to parse. Swift would need a compiled binary, and Python no longer ships with macOS. The rest of the scripts are glue (running the adapter, reshaping JSON with `jq`, managing cache files), which shell does well and starts fast enough for a one-second pulse; `osascript` costs roughly 70ms per run, which the per-bundle-ID cache keeps off the pulse.

The icon and name aren't set with `update`. Alfred sizes a component when it's laid out and doesn't re-measure it when an update changes its text, so the name (which starts empty) could keep a width of a few points and be truncated, depending on whether the first pulse beat the first layout. `relayout: true` doesn't fix it: views keep the space they were given and squeeze their contents. Instead `with_toprow` adds a `replace` of the `app` view, built by `app_view` with the icon and name in place, so it's measured with them. The `app` view sits in the top row's centre region (all the width the rotate button leaves) with `position: right`, so its new size has room. It's replaced only when the app changes: the app last drawn is in `$CACHE/toprow-app`, which `window.sh` removes, so a newly opened panel gets its app on the first pulse. The rotate button is outside the replaced view, as it doesn't change with the app.

Clicking the icon or name opens the app, or brings it to the front: `app_view` gives the `app` view a `clicked` event that runs `scripts/openapp.sh` with the app's path as its argument, so the path stays current as the view is replaced (there's no event when no app is showing). Alfred's docs list click events only for buttons, but a view's `clicked` trigger works.

The name is vertically centred on the icon with `position: centre`, raised 1.5pt with a 3pt bottom inset, because centred on its frame the lowercase letters sit about 2pt below the icon's centre. The icon and name are 5pt apart (`spacing`), though the visible gap is larger, as the icon's image has transparent margins. The rotate button is vertically centred too, and raised the same way to line up with the name; its symbol size follows its `font` size (an `image` `size` has no effect on a button).

### Time and progress

`load_track` calls `get --no-artwork --now`, which adds `elapsedTimeNow`, the adapter's estimate of the current position (up to a second off). The position is clamped to 0…`duration` (`position` in `JQ_TIME`), the bar is position ÷ duration, and times are formatted `m:ss`, or `h:mm:ss` from an hour (`clock`). The time labels use monospaced digits so they don't jitter as they change. With no `duration` (e.g. live streams) the bar and times are hidden; `hidden` keeps their space, so the layout doesn't jump.

### Jumping back and forward

`jump` in `control.sh` seeks with the adapter's `seek`, which takes an absolute position in microseconds, worked out from `get --now --micros` and clamped to the track. With no `duration` (e.g. live streams) it does nothing. MediaRemote also has skip forward and backward commands, but `send` can't pass them an interval, so the player would choose the distance.

The player takes a moment to report the new position after a seek (0.2–0.7s for Spotify, measured), and a jump that reads the position before then starts from the old one: two quick clicks would jump only once. So each jump waits, up to 1.5s, until the reported position is within a second of its target, and jumps run one at a time under a lock (`$CACHE/jump.lock`, a directory; a jump waits up to 5s for it, then goes ahead anyway). The buttons run `control.sh` asynchronously, so clicks can overlap.

### Pulse interval

The pulse runs every `PULSE_PLAYING` seconds (1, matching `interval` in `ui.json`) while playing, so the elapsed time ticks, and every `PULSE_IDLE` seconds (3) when paused, when nothing is playing, or when showing an error. `with_pulse` adds a `pulse` JSON Action to the output only when the interval needs to change, because Alfred's docs don't say whether re-sending the pulse configuration restarts the timer. It records the current interval in `$CACHE/pulse`. A file more than 10 seconds old means the window was closed and reopened since, which resets the pulse to the `ui.json` default. Control buttons call `poll.sh` too, so pressing play speeds the pulse up straight away.

### Alfred result

The two keywords are two Script Filters (no argument) with the same settings, both running `scripts/results.sh`, which prints one result: the title and artist (`Title — Artist`), with a subtitle of `Paused` (when paused), album, elapsed / duration and the app name, skipping whatever is missing, then a `(↩ to open mini player)` hint. The hint is last so that Alfred truncates it, not the track details, when the line is too long. The icon is the cached artwork, falling back to the app's icon, then the workflow icon. When there is artwork, ⇧ or ⌘Y Quick Looks it. `rerun` refreshes the result every second while playing (so the time ticks) and every 3 seconds otherwise. Every result, track or status message, has the same `uid` (`nowplaying`): on a rerun Alfred keeps the selection on the item with the selected item's `uid`, so with other results matching the keyword, the selection stays on this one instead of jumping back to the top. Without a `uid` it does jump back. The `uid` also lets Alfred learn from the result being chosen, which may rank it higher among other matches over time. Actioning the result (or a status message result) opens the panel. Alfred only runs a Script Filter once its whole keyword is typed (a partial match shows the fixed title and subtext), which is why there's a short keyword as well. Keep the two objects' settings in step.

Fetching artwork for a new track makes the first result slower to appear, as it does for the panel's first pulse.

### Preferences

The workflow's User Configuration (defined in `info.plist`; values the user saves go to the gitignored `prefs.plist`) has:

| Variable         | Type          | Default                          | Used by                                                                           |
| ---------------- | ------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| `keyword`        | text          | `nowplaying`                     | the first Script Filter's keyword, as `{var:keyword}`                             |
| `keyword_short`  | text          | `np`                             | the second Script Filter's keyword, as `{var:keyword_short}`                      |
| `window_buttons` | checkbox      | on                               | `window.sh`: title bar with window buttons, or borderless                         |
| `corner_radius`  | slider, 0–32  | `16`                             | `window.sh`: the borderless window's `cornerradius`                               |
| `transparency`   | slider, 0–100 | `45`                             | `window.sh`: the panel's tint                                                     |
| `default_app`    | file picker   | `/System/Applications/Music.app` | the app shown and opened when nothing is playing; see [Default app](#default-app) |

Alfred passes them to the workflow's scripts as environment variables. The Alfred UI itself sees none of them (it would need each listed in `ui.json`'s `variablesconfig`), and doesn't need to: `window.sh` builds them into the window before the UI opens (see [Window](#window)), and saves `default_app` to the cache for the panel's scripts.

The file picker's `filtermode` is 0. Other workflows use 1 for folders only; 0 is presumably files only, which still allows apps, since an app bundle counts as a file in an open panel. The value is the app's full path. The picker has no setting for its starting folder.

## The vendored adapter

Recent macOS versions only let entitled processes use the private MediaRemote framework, which holds now-playing information. [ungive/mediaremote-adapter](https://github.com/ungive/mediaremote-adapter) works around this by loading its own framework into the system's `/usr/bin/perl`; its `test` command checks that this still works on the current macOS. It's vendored into `nowplaying.alfredui/vendor/` so the workflow has no runtime dependencies:

- `mediaremote-adapter.pl`: the entry point, run as `/usr/bin/perl mediaremote-adapter.pl <absolute path to framework> <command>`. The framework path must be absolute, which is why `lib.sh` resolves the bundle root.
- `MediaRemoteAdapter.framework`: the compiled framework (keep its internal symlinks intact; `wf build` does).
- `MediaRemoteAdapterTestClient`: used only by `vendor.sh`'s post-build test. It and `vendor.sh` are listed in `.wfignore`, so they aren't in builds.
- `LICENSE` and `VERSION` (the upstream commit that was built). The vendored build is release `v0.7.7` (commit `e3ff502`).

`vendor.sh` rebuilds it: it clones the adapter (default `master`, or pass a tag/branch, e.g. `./vendor.sh v0.5.0`), builds it with cmake, replaces `vendor/`, and runs the adapter's `test` command. It needs Xcode command line tools, cmake and git, at build time only. Prefer passing a tag so rebuilds are reproducible; `vendor/VERSION` records what was built.

The build targets macOS 12.0, Alfred 6's minimum (override with `MIN_MACOS=…`). Without an explicit target cmake uses the build machine's macOS version, and the framework then refuses to load on any older macOS. `vendor.sh` checks the built framework's minimum version (`otool -l`, the `minos` field) and stops before replacing `vendor/` if it doesn't match. Compiler availability warnings in the build output point at APIs newer than the target. The `test` command only proves the adapter works on the Mac that built it; test on an older macOS (e.g. in a VM) before relying on the target.

### Signing and notarising

The framework is a compiled binary, so it must be signed with a Developer ID certificate and notarised. A browser marks a downloaded `.alfredworkflow` as quarantined, Alfred can carry that flag onto the imported files, and Gatekeeper then refuses to load a framework that isn't notarised: `dl_load_file` fails ("Failed to load framework"), after a security dialog that blocks the adapter until it's dismissed. The Gallery also requires it. A local build only gets an ad-hoc signature, which works on the Mac that built it because nothing there is quarantined.

`vendor.sh` signs the framework (`codesign` with the hardened runtime and a secure timestamp), notarises it with `notarytool`, and checks that `spctl` reports `source=Notarized Developer ID`, all before replacing `vendor/`, so a failure leaves the existing adapter in place. A framework can't have its notarisation ticket stapled, so Gatekeeper looks it up online. The test client isn't shipped and keeps its ad-hoc signature.

One-time setup, with a paid Apple Developer Program membership:

1. Create a Developer ID Application certificate: Xcode → Settings → Accounts → (team) → Manage Certificates → + → Developer ID Application. `security find-identity -v -p codesigning` should then list it.
2. Store notarisation credentials in the keychain as the profile `vendor.sh` uses: `xcrun notarytool store-credentials alfred-workflows --apple-id <Apple ID> --team-id <team ID>`, entering an app-specific password from account.apple.com when asked.

`vendor.sh` finds the certificate itself when the keychain has exactly one Developer ID Application identity; otherwise set `SIGN_IDENTITY` to its full name. `NOTARY_PROFILE` overrides the profile name. It checks both before building. `SIGN=0 ./vendor.sh …` skips signing for a local test build, and warns that the result mustn't be released.

To check a signed framework by hand: `codesign -dv --verbose=4 vendor/MediaRemoteAdapter.framework` shows `Authority=Developer ID Application: …` and a `TeamIdentifier`, and `spctl -a -vv -t open --context context:primary-signature vendor/MediaRemoteAdapter.framework/Versions/A/MediaRemoteAdapter` shows `accepted` and `source=Notarized Developer ID`. For an end-to-end check, download a release with a browser and import it on another Mac (or another user account). `wf build` and `wf release` run the same `spctl` check and refuse to build an unnotarised framework; `wf build --allow-unsigned now-playing` makes a local test build.

Other runtime requirements ship with macOS: `/usr/bin/perl`, `/usr/bin/jq`, `osascript`. `lib.sh` sets `PATH` to the system directories only.

Run `/usr/bin/perl vendor/mediaremote-adapter.pl` with no arguments for the adapter's full usage. Besides `get` and `send` it has `stream`, which emits changes as they happen and could replace the one-second polling.

## To-do

- [x] Overall icon
- [ ] Volume controls: perhaps a slider showing the current level (`output volume of (get volume settings)` via `osascript`).
- [ ] Notifications on track change, with a preference to turn them on.
- [ ] Always-on-top option, with a toggle button. Blocked: Alfred UI has no window level setting; see [Alfred requests](../../Alfred%20requests.md#alfred-ui-always-on-top-windows).
- [ ] Show "Now Playing" rather than "Alfred UI" as the app name in ⌘-Tab and the Dock. Blocked: only Alfred's helper can rename itself; see [Alfred requests](../../Alfred%20requests.md#alfred-ui-an-app-name-for-the-uis-process).
- [x] When "Nothing playing", there should be a default app to open
- [ ] A pointing-hand cursor over the default app's icon and the top row's app. Blocked: Alfred UI has no cursor setting, and no hover event to change one; see [Alfred requests](../../Alfred%20requests.md#alfred-ui-a-pointer-cursor-for-clickable-components).
- [ ] Scrolling for long titles?
- [ ] Actions from the Result -- back/forward/play/pause, etc
- [ ] Keyboard for back/forward (arrows?)

## Before a release

- **Signing.** The vendored framework is ad-hoc signed, and Gatekeeper blocks it when quarantined. Once the Developer ID certificate and notarisation profile are set up, re-vendor with `./vendor.sh v0.7.7` to sign and notarise it; see [Signing and notarising](#signing-and-notarising).
- `description` and the user-facing readme in `info.plist` are empty, and there is no `version` yet.

## Testing

Run the scripts directly with something playing (`control.sh` really controls playback):

```zsh
cd nowplaying.alfredui
./scripts/poll.sh | jq
./scripts/results.sh | jq
./scripts/control.sh playpause | jq
window_buttons=0 corner_radius=24 transparency=30 default_app=/System/Applications/Music.app ./scripts/window.sh
./scripts/layout.sh landscape | jq 'del(.replace)'   # also saves the layout
```

Alfred doesn't notice `info.plist` edits made through the symlinked folder; reload the workflow with `osascript -e 'tell application id "com.runningwithcrayons.Alfred" to reload workflow "net.smithnz.carl.nowplaying"'`.

Set `ADAPTER=/path/to/mock` to replace the adapter with a script of your own, e.g. to test the error and "Nothing playing" states. Outside Alfred, artwork, `last-error` and `window.json` go to `~/Library/Caches/net.smithnz.carl.nowplaying`, and the saved layout to `~/Library/Application Support/net.smithnz.carl.nowplaying`.

The `.alfredui` bundle lives inside the workflow folder; Alfred doesn't need a copy at the top level of its workflows directory.
