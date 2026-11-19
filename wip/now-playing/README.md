# Now Playing

Developer notes. A small Alfred 6 panel showing the current track (artwork, title, artist, album, playing app, elapsed time) with playback and volume controls.

## How it works

The ⌃N hotkey runs `scripts/window.sh` (a Run Script object), which builds the window definition from the preferences, then opens an Alfred UI object, which loads the `nowplaying.alfredui` bundle. The keywords (`nowplaying` and `np` by default) show the current track as an Alfred result first (see [Alfred result](#alfred-result)); actioning it opens the same panel, through the same Run Script. The keywords are set in the workflow's configuration; see [Preferences](#preferences).

- `ui.json` holds the pulse, and loads the window from the file `window.sh` writes; see [Window](#window).
- `window.json` is the template for the window (a resizeable dark panel, at least 280×240): a `{ "id": "toprow" }` placeholder that `window.sh` fills with `parts/toprow.json`, then a `{ "id": "content" }` placeholder that it fills with the artwork and track details for the current layout; see [Layouts](#layouts).
- `parts/toprow.json` is the top row: the playing app's icon (32pt) and name (18pt) in an `app` view, right-aligned, then the rotate button; see [Playing app](#playing-app) and [Layouts](#layouts). `parts/art.json` is the artwork image view, `parts/text.json` the title (21pt bold), artist (19pt) and album (17pt) labels, 6pt apart, and `parts/controls.json` a progress bar with elapsed time and duration above a row of five buttons (volume down, previous, play/pause, next, volume up). Components that get updated have `id`s: `art`, `title`, `artist`, `album`, `progress`, `elapsed`, `duration`, `playpause`.
- The `pulse` runs `scripts/poll.sh` every second (`intervalmode: delay`, so the next run waits for the previous one to finish), and immediately on open (`now: true`). `poll.sh` slows it down when nothing is playing; see [Pulse interval](#pulse-interval).
- `scripts/poll.sh` reads the player state (`load_track`) and prints a JSON `{update: {ids: {…}}}` object that sets each component's text, image, progress or visibility, plus a `replace` of the app view when the playing app changes (`with_toprow`).
- Each button runs `scripts/control.sh <action>` asynchronously (`playpause`, `next`, `prev`, `volup`, `voldown`). Playback actions send MediaRemote command (MRCommand) IDs through the adapter: `send 2` toggle play/pause, `4` next track, `5` previous track (`0` play, `1` pause and `3` stop are also available). Volume changes the system output volume via `osascript`, 6 steps on the 0–100 scale. It then waits 0.25s for the player to publish its new state and runs `poll.sh`, so the panel updates without waiting for the next pulse.
- `scripts/lib.sh` is sourced by all the scripts: it locates the bundle and sets `CACHE` and `DATA`, and defines the layout helpers `current_layout`, `layout_size` and `content_view` (see [Layouts](#layouts)), the top row helpers `app_view`, `toprow_view` and `with_toprow` (see [Playing app](#playing-app)), `adapter` (runs the vendored adapter), `adapter_installed`, `load_track` (reads the player state, artwork and app into variables; see [Status messages](#status-messages), [Artwork](#artwork) and [Playing app](#playing-app)), `JQ_TIME` (jq `clock` and `position` definitions), `show_message` (puts a status message and SF Symbol in the panel instead of a track, hiding the app and timeline) and `with_pulse` (see below).
- `scripts/apppath.js` (JXA) turns a bundle ID into an app path with `NSWorkspace`.
- `scripts/window.sh` builds the window from `window.json`, the parts, the preferences and the saved layout; see [Window](#window).
- `scripts/layout.sh` switches the open panel's layout; see [Layouts](#layouts).

### Window

The window is forced to the `dark` appearance and dragged from anywhere on its background (`movablebybackground`). Its translucency comes from two layers: the window's `blur`, and a dark tint, the root view's (`panel`) `background`. The padding sits on the root view rather than the window so the tint reaches the edges.

With the window buttons preference on (the default), the window has a title bar with no title (`titlevisibility: false`), made transparent (`titlebarappearstransparent`) with the content extending up behind it (`fullsizecontentview`), so only the window buttons show, over the panel at top left, and the corners have the system's standard window rounding. The app icon and name sit at the top right to keep clear of the buttons. Minimise is disabled (`minimisable: false`) but still drawn as a grey dot, and zoom maximises the window, since it's resizeable (`fullscreenable: false` stops it going full screen): Alfred UI has no option to hide either, and no hover event that could show the buttons only while the pointer is over the window. With the preference off, the window is `borderless` (the title bar options are then ignored) and its `cornerradius` comes from the corner radius preference.

#### Building the window from the preferences

Preferences reach an Alfred UI only as strings (through `variablesconfig`, `src: "variable"`), and the window's settings ignore a string where they expect a boolean or a number: a `"{var:…}"` placeholder for `borderless` or `cornerradius` has no effect, and an unquoted placeholder is invalid JSON, so Alfred can't load the UI at all. The update action can't change window properties once the window is open, so a script in the UI can't set them either.

A `{file:…}` placeholder, though, inserts a file's contents as JSON with their real types (for an object; a file holding a bare `true` arrives as the string `"true"`). So `ui.json`'s whole `window` is one placeholder:

```json
"window": "{file:~/Library/Caches/com.runningwithcrayons.Alfred/Workflow Data/carlosnz.nowplaying/window.json}"
```

`scripts/window.sh` writes that file: it takes `window.json` (the template, with the title bar settings), adds `borderless` and `cornerradius` when the window buttons are off, fills in the content view and window size for the saved layout, sets the tint to `rgb(18, 18, 20, (100 − transparency) ÷ 100)`, and moves the result into place atomically. A Run Script object runs it on every route into the Alfred UI object (the hotkey and both keyword results), so the panel opens with the current preferences and the file always exists when Alfred loads `ui.json`; if it doesn't, Alfred falls back to a default 800×600 window titled "Alfred UI".

The path is spelled out because `{file:…}` doesn't resolve a placeholder in its path (`{file:{const:alfred_workflow_cache}/window.json}` fails), though it does expand `~`. It must match `$alfred_workflow_cache`, so it changes with the workflow's bundle ID. Absolute and `~` paths in `{file:…}` aren't in Alfred's docs, so check this after Alfred updates.

At 100 transparency the tint is gone but the panel is still dark grey: that is the blur's own material, which the dark appearance darkens and the UI JSON can't adjust.

The thin black outline around the panel is the outline macOS draws around dark-appearance windows, and Alfred UI has no option to remove it. Turning `blur` off doesn't help: the window then gets an opaque black background, so the tint can't show anything through.

The panel closes with the window's close button, or with Esc (a `⎋` entry in the root view's `shortcuts`, running a `finish` action).

After a layout's starting size is set (on first open, or by a layout switch), the window reopens 32pt shorter (540 becomes 508, 300 becomes 268), then stays at that size: restoring the saved frame (`frameautosave`) seems to lose the title bar's height. Not yet investigated.

### Layouts

The rotate button (top right) switches between the two layouts: it runs `scripts/layout.sh toggle`. It shows the current layout's shape with a rotate arrow (the SF Symbols `rectangle.portrait.rotate` and `rectangle.landscape.rotate`, available from macOS 12) and a tooltip naming the layout it switches to; `rotate_button` in `lib.sh` gives these for a layout, `window.sh` sets them when building the window, and `layout.sh` updates them after a switch. (A Portrait / Landscape `popupmenu` was tried first, but it always opened with the first item under the pointer, whichever layout was current, and offered the current layout too.) The two layouts arrange the same components, so poll.sh and control.sh work with either:

- **Portrait** (starts at 340×540): the artwork fills the space between the top row and the details below it (the whole content is inset `PORTRAIT_GAP`, 6pt, below the top row): the text, then, after a wider gap (24pt), the controls.
- **Landscape** (starts at 620×348, where the artwork's cell is square): two equal columns, the artwork on the left and a details column on the right, inset 16pt (`LANDSCAPE_INSET`) from the top and bottom so the artwork clears the window buttons at the top left. The artwork is centred between the window's top and bottom edges. The inset applies in borderless mode too: `layout.sh` can't see the preferences (the UI's scripts only get variables listed in `variablesconfig`), and it's symmetric, so it costs only a little space. The details column is inset below the top row, with the controls at its bottom and the text vertically centred in the space above (`region: centre` with `position: centre`, `stretch: horizontal`). When the artwork fills its cell's height (a square image in a cell at least as wide as it is tall, as at the starting size), the controls are flush with the bottom of the artwork; when the window is taller than that, the artwork is centred with space above and below, and no longer lines up.

The root view is a `stack`: the content fills it and the top row (`parts/toprow.json`, `position: top`, `stretch: horizontal`) is laid over it, so the top row takes no space from the content. What must stay clear of it is inset by the row's height, `TOPROW_HEIGHT` (34, set by the 32pt app icon), plus a gap: `PORTRAIT_GAP` (6) above the portrait artwork, `LANDSCAPE_GAP` (14) above the landscape details column. This keeps the landscape artwork centred in the window rather than in the space below the top row.

The artwork view fills its space either way, and `resize: fit` scales the image to fit it, keeping its aspect ratio and centring it, so it grows and shrinks with the window. Text and controls keep the same styles in both.

The window is resizeable. A layout switch sets the new layout's starting size; within a layout, `frameautosave` keeps the size the user chooses across reopens. The minimum, 280×240 (`minsize` in `window.json`), is shared by both layouts: a `window` JSON Action resizes the open window but ignores `minsize`, so the minimum set when the window opens stays in force after a switch, and separate minimums (portrait taller, landscape wider) would block one layout's shape. At the minimum, portrait shrinks the artwork to a thumbnail with all the details still showing, and landscape is cramped (two 116pt columns, the title truncated, 20pt buttons).

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

### Artwork

Fetching artwork is expensive (`get` returns it base64-encoded), so each pulse calls `get --no-artwork` and only does the full call when there is no cached artwork for the current track. Artwork is cached as `art-<hash>.<ext>` in `$alfred_workflow_cache` (shared by the panel and the Alfred result), keyed on a hash of player bundle ID, title, artist and album, so the image view never shows a stale image. The previous track's file is deleted when a new one is written. Artwork often arrives a moment after the track metadata, so a missing image is retried on every pulse until it appears.

### Playing app

`get` returns the player's `bundleIdentifier`. `load_track` resolves it to an app path with `apppath.js` and caches the result per bundle ID as `app-<bundle id>` in the cache folder (an empty file means no app was found), so the lookup only runs for a new player. The cache is never refreshed, so clear it if an app is installed or moved while the cache exists. The icon is an image view with `type: "fileicon"` and the app path as `src`; the name is the app bundle's file name without `.app`. Both are hidden when there's no bundle ID or app. Media playing in a browser shows the browser, not the site.

The icon and name aren't set with `update`. Alfred sizes a component when it's laid out and doesn't re-measure it when an update changes its text, so the name (which starts empty) could keep a width of a few points and be truncated, depending on whether the first pulse beat the first layout. `relayout: true` doesn't fix it: views keep the space they were given and squeeze their contents. Instead `with_toprow` adds a `replace` of the `app` view, built by `app_view` with the icon and name in place, so it's measured with them. The `app` view sits in the top row's centre region (all the width the rotate button leaves) with `position: right`, so its new size has room. It's replaced only when the app changes: the app last drawn is in `$CACHE/toprow-app`, which `window.sh` removes, so a newly opened panel gets its app on the first pulse. The rotate button is outside the replaced view, as it doesn't change with the app. The name is vertically centred on the icon with `position: centre`, and so is the rotate button, whose symbol size follows its `font` size (an `image` `size` has no effect on a button).

### Time and progress

`load_track` calls `get --no-artwork --now`, which adds `elapsedTimeNow`, the adapter's estimate of the current position (up to a second off). The position is clamped to 0…`duration` (`position` in `JQ_TIME`), the bar is position ÷ duration, and times are formatted `m:ss`, or `h:mm:ss` from an hour (`clock`). The time labels use monospaced digits so they don't jitter as they change. With no `duration` (e.g. live streams) the bar and times are hidden; `hidden` keeps their space, so the layout doesn't jump.

### Pulse interval

The pulse runs every `PULSE_PLAYING` seconds (1, matching `interval` in `ui.json`) while playing, so the elapsed time ticks, and every `PULSE_IDLE` seconds (3) when paused, when nothing is playing, or when showing an error. `with_pulse` adds a `pulse` JSON Action to the output only when the interval needs to change, because Alfred's docs don't say whether re-sending the pulse configuration restarts the timer. It records the current interval in `$CACHE/pulse`. A file more than 10 seconds old means the window was closed and reopened since, which resets the pulse to the `ui.json` default. Control buttons call `poll.sh` too, so pressing play speeds the pulse up straight away.

### Alfred result

The two keywords are two Script Filters (no argument) with the same settings, both running `scripts/results.sh`, which prints one result: the title and artist (`Title — Artist`), with a subtitle of `Paused` (when paused), album, elapsed / duration and the app name, skipping whatever is missing, then a `(↩ to open mini player)` hint. The hint is last so that Alfred truncates it, not the track details, when the line is too long. The icon is the cached artwork, falling back to the app's icon, then the workflow icon. When there is artwork, ⇧ or ⌘Y Quick Looks it. `rerun` refreshes the result every second while playing (so the time ticks) and every 3 seconds otherwise. Every result, track or status message, has the same `uid` (`nowplaying`): on a rerun Alfred keeps the selection on the item with the selected item's `uid`, so with other results matching the keyword, the selection stays on this one instead of jumping back to the top. Without a `uid` it does jump back. The `uid` also lets Alfred learn from the result being chosen, which may rank it higher among other matches over time. Actioning the result (or a status message result) opens the panel. Alfred only runs a Script Filter once its whole keyword is typed (a partial match shows the fixed title and subtext), which is why there's a short keyword as well. Keep the two objects' settings in step.

Fetching artwork for a new track makes the first result slower to appear, as it does for the panel's first pulse.

### Preferences

The workflow's User Configuration (defined in `info.plist`; values the user saves go to the gitignored `prefs.plist`) has:

| Variable         | Type          | Default      | Used by                                                      |
| ---------------- | ------------- | ------------ | ------------------------------------------------------------ |
| `keyword`        | text          | `nowplaying` | the first Script Filter's keyword, as `{var:keyword}`        |
| `keyword_short`  | text          | `np`         | the second Script Filter's keyword, as `{var:keyword_short}` |
| `window_buttons` | checkbox      | on           | `window.sh`: title bar with window buttons, or borderless    |
| `corner_radius`  | slider, 0–32  | `16`         | `window.sh`: the borderless window's `cornerradius`          |
| `transparency`   | slider, 0–100 | `45`         | `window.sh`: the panel's tint                                |

Alfred passes them to the workflow's scripts as environment variables. The Alfred UI itself sees none of them (it would need each listed in `ui.json`'s `variablesconfig`), and doesn't need to: `window.sh` builds them into the window before the UI opens; see [Window](#window).

## The vendored adapter

Recent macOS versions only let entitled processes use the private MediaRemote framework, which holds now-playing information. [ungive/mediaremote-adapter](https://github.com/ungive/mediaremote-adapter) works around this by loading its own framework into the system's `/usr/bin/perl`; its `test` command checks that this still works on the current macOS. It's vendored into `nowplaying.alfredui/vendor/` so the workflow has no runtime dependencies:

- `mediaremote-adapter.pl`: the entry point, run as `/usr/bin/perl mediaremote-adapter.pl <absolute path to framework> <command>`. The framework path must be absolute, which is why `lib.sh` resolves the bundle root.
- `MediaRemoteAdapter.framework`: the compiled framework (keep its internal symlinks intact; `wf build` does).
- `MediaRemoteAdapterTestClient`: used only by `vendor.sh`'s post-build test.
- `LICENSE` and `VERSION` (the upstream commit that was built).

`vendor.sh` rebuilds it: it clones the adapter (default `master`, or pass a tag/branch, e.g. `./vendor.sh v0.5.0`), builds it with cmake, replaces `vendor/`, and runs the adapter's `test` command. It needs Xcode command line tools, cmake and git, at build time only. Prefer passing a tag so rebuilds are reproducible; `vendor/VERSION` records what was built.

The build targets macOS 12.0, Alfred 6's minimum (override with `MIN_MACOS=…`). Without an explicit target cmake uses the build machine's macOS version, and the framework then refuses to load on any older macOS. `vendor.sh` checks the built framework's minimum version (`otool -l`, the `minos` field) and stops before replacing `vendor/` if it doesn't match. Compiler availability warnings in the build output point at APIs newer than the target. The `test` command only proves the adapter works on the Mac that built it; test on an older macOS (e.g. in a VM) before relying on the target.

Other runtime requirements ship with macOS: `/usr/bin/perl`, `/usr/bin/jq`, `osascript`. `lib.sh` sets `PATH` to the system directories only.

Run `/usr/bin/perl vendor/mediaremote-adapter.pl` with no arguments for the adapter's full usage. Besides `get` and `send` it has `stream`, which emits changes as they happen and could replace the one-second polling.

## To-do

- [ ] Read and show the current volume level (`output volume of (get volume settings)` via `osascript`).
- [ ] UI improvements.
- [ ] Multiple layouts (compact, full, etc.).
- [ ] Click the app icon to bring that app to the front (`open -b <bundle id>`). Alfred's docs list no click event for image views, but buttons have `actioned` and accept an image, so the icon could be a borderless button with a `fileicon` image.
- [ ] Jump back/forward buttons
- [ ] Notifications on track change, with a preference to turn them on.
- [ ] Always-on-top option
- [ ] WHen "Nothing playing", there should be a default app to open
- [ ] Scrolling for long titles?

## Before a release

- **Signing.** The framework (and test client) are ad-hoc signed, which is all a local build gets. The Gallery requires compiled binaries to be signed and notarised, so a Gallery release needs a Developer ID signature and notarisation for the framework. A forum release should be tested on another Mac first, in case Gatekeeper or quarantine blocks the ad-hoc-signed framework there.
- **Build contents.** Builds currently include `vendor.sh` and `vendor/MediaRemoteAdapterTestClient`, which are only needed when vendoring. Adding them to a `.wfignore` keeps them out of the `.alfredworkflow` while keeping them in the repo.
- **Bundle IDs.** `ui.json` has its own `bundleid` (`nz.carl.nowplaying`), different from `info.plist` (`carlosnz.nowplaying`); `lib.sh` also uses `~/Library/Caches/nz.carl.nowplaying` as the cache when run outside Alfred, and `ui.json`'s `window` path contains the `info.plist` bundle ID. Make these consistent before release.
- `description` and the user-facing readme in `info.plist` are empty, and there is no `version` yet.

## Testing

Run the scripts directly with something playing (`control.sh` really controls playback):

```zsh
cd nowplaying.alfredui
./scripts/poll.sh | jq
./scripts/results.sh | jq
./scripts/control.sh playpause | jq
window_buttons=0 corner_radius=24 transparency=30 ./scripts/window.sh
./scripts/layout.sh landscape | jq 'del(.replace)'   # also saves the layout
```

Alfred doesn't notice `info.plist` edits made through the symlinked folder; reload the workflow with `osascript -e 'tell application id "com.runningwithcrayons.Alfred" to reload workflow "carlosnz.nowplaying"'`.

Set `ADAPTER=/path/to/mock` to replace the adapter with a script of your own, e.g. to test the error and "Nothing playing" states. Outside Alfred, artwork, `last-error` and `window.json` go to `~/Library/Caches/nz.carl.nowplaying`, and the saved layout to `~/Library/Application Support/nz.carl.nowplaying`.

The `.alfredui` bundle lives inside the workflow folder; Alfred doesn't need a copy at the top level of its workflows directory.
