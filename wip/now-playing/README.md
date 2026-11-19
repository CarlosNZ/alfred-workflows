# Now Playing

Developer notes. A small Alfred 6 panel showing the current track (artwork, title, artist, album, playing app, elapsed time) with playback and volume controls.

## How it works

The ⌃N hotkey opens an Alfred UI object, which loads the `nowplaying.alfredui` bundle. The keywords (`nowplaying` and `np` by default) show the current track as an Alfred result first (see [Alfred result](#alfred-result)); actioning it opens the same panel. The keywords are set in the workflow's configuration; see [Preferences](#preferences).

- `ui.json` defines the window (340×540, not resizeable, a borderless dark panel; see [Window](#window)): the playing app's icon and name across the top with a close button on the right, an artwork image view in the centre, then title/artist/album labels, a progress bar with elapsed time and duration, and a row of five buttons (volume down, previous, play/pause, next, volume up). Components that get updated have `id`s: `appicon`, `appname`, `art`, `title`, `artist`, `album`, `progress`, `elapsed`, `duration`, `playpause`.
- The `pulse` runs `scripts/poll.sh` every second (`intervalmode: delay`, so the next run waits for the previous one to finish), and immediately on open (`now: true`). `poll.sh` slows it down when nothing is playing; see [Pulse interval](#pulse-interval).
- `scripts/poll.sh` reads the player state (`load_track`) and prints a JSON `{update: {ids: {…}}}` object that sets each component's text, image, progress or visibility.
- Each button runs `scripts/control.sh <action>` asynchronously (`playpause`, `next`, `prev`, `volup`, `voldown`). Playback actions send MediaRemote command (MRCommand) IDs through the adapter: `send 2` toggle play/pause, `4` next track, `5` previous track (`0` play, `1` pause and `3` stop are also available). Volume changes the system output volume via `osascript`, 6 steps on the 0–100 scale. It then waits 0.25s for the player to publish its new state and runs `poll.sh`, so the panel updates without waiting for the next pulse.
- `scripts/lib.sh` is sourced by all the scripts: it locates the bundle and sets `CACHE`, and defines `adapter` (runs the vendored adapter), `adapter_installed`, `load_track` (reads the player state, artwork and app into variables; see [Status messages](#status-messages), [Artwork](#artwork) and [Playing app](#playing-app)), `JQ_TIME` (jq `clock` and `position` definitions), `show_message` (puts a status message and SF Symbol in the panel instead of a track, hiding the app and timeline) and `with_pulse` (see below).
- `scripts/apppath.js` (JXA) turns a bundle ID into an app path with `NSWorkspace`.

### Window

The window is `borderless` (no title bar or traffic lights) with rounded corners, forced to the `dark` appearance, and dragged from anywhere on its background (`movablebybackground`). Its translucency comes from two layers: the window's `blur`, and a dark tint, the root view's (`panel`) `background`. The padding sits on the root view rather than the window so the tint reaches the edges.

The corner radius is a fixed 16, the radius of a standard titled window on macOS 27 (`_cornerRadius` of an `NSWindow`). It can't be a preference: preferences reach the UI as strings (through `variablesconfig`, `src: "variable"`), and the window's `cornerradius` ignores a string, so a placeholder `"{var:…}"` leaves the corners square. An unquoted placeholder is invalid JSON, so Alfred can't load the UI at all, and the update action can't change window properties, so a script can't set it either.

The tint follows the `transparency` preference. Its alpha is a fraction, which a placeholder can't compute from the slider's 0–100 value. Instead `transparency` is passed to scripts (`scriptenv`), and `scripts/style.sh`, run on the root view's `preload` event, prints an update setting the tint to `rgb(18, 18, 20, (100 − transparency) ÷ 100)`. `ui.json` holds the same colour for the default, 45. At 100 the tint is gone but the panel is still dark grey: that is the blur's own material, which the dark appearance darkens and the UI JSON can't adjust.

The thin black outline around the panel is the outline macOS draws around dark-appearance windows, and Alfred UI has no option to remove it. Turning `blur` off doesn't help: the window then gets an opaque black background, so the tint can't show anything through.

There is no title bar close button, so the panel closes with Esc (a `⎋` entry in the root view's `shortcuts`) or the ⓧ button at the right of the top row. Both run a `finish` action.

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

### Time and progress

`load_track` calls `get --no-artwork --now`, which adds `elapsedTimeNow`, the adapter's estimate of the current position (up to a second off). The position is clamped to 0…`duration` (`position` in `JQ_TIME`), the bar is position ÷ duration, and times are formatted `m:ss`, or `h:mm:ss` from an hour (`clock`). The time labels use monospaced digits so they don't jitter as they change. With no `duration` (e.g. live streams) the bar and times are hidden; `hidden` keeps their space, so the layout doesn't jump.

### Pulse interval

The pulse runs every `PULSE_PLAYING` seconds (1, matching `interval` in `ui.json`) while playing, so the elapsed time ticks, and every `PULSE_IDLE` seconds (3) when paused, when nothing is playing, or when showing an error. `with_pulse` adds a `pulse` JSON Action to the output only when the interval needs to change, because Alfred's docs don't say whether re-sending the pulse configuration restarts the timer. It records the current interval in `$CACHE/pulse`. A file more than 10 seconds old means the window was closed and reopened since, which resets the pulse to the `ui.json` default. Control buttons call `poll.sh` too, so pressing play speeds the pulse up straight away.

### Alfred result

The two keywords are two Script Filters (no argument) with the same settings, both running `scripts/results.sh`, which prints one result: the track title, with a subtitle of `Paused` (when paused), artist, album, elapsed / duration and the app name, skipping whatever is missing. The icon is the cached artwork, falling back to the app's icon, then the workflow icon. When there is artwork, ⇧ or ⌘Y Quick Looks it. `rerun` refreshes the result every second while playing (so the time ticks) and every 3 seconds otherwise. Actioning the result (or a status message result) opens the panel. Alfred only runs a Script Filter once its whole keyword is typed (a partial match shows the fixed title and subtext), which is why there's a short keyword as well. Keep the two objects' settings in step.

Fetching artwork for a new track makes the first result slower to appear, as it does for the panel's first pulse.

### Preferences

The workflow's User Configuration (defined in `info.plist`; values the user saves go to the gitignored `prefs.plist`) has:

| Variable        | Type          | Default      | Used by                                                      |
| --------------- | ------------- | ------------ | ------------------------------------------------------------ |
| `keyword`       | text          | `nowplaying` | the first Script Filter's keyword, as `{var:keyword}`        |
| `keyword_short` | text          | `np`         | the second Script Filter's keyword, as `{var:keyword_short}` |
| `transparency`  | slider, 0–100 | `45`         | the panel's tint, via `style.sh`; see [Window](#window)      |

Alfred also passes them to the Script Filters' scripts as environment variables. The panel only sees the ones listed in `ui.json`'s `variablesconfig`, and only passes those marked `scriptenv` to its scripts.

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

## Before a release

- **Signing.** The framework (and test client) are ad-hoc signed, which is all a local build gets. The Gallery requires compiled binaries to be signed and notarised, so a Gallery release needs a Developer ID signature and notarisation for the framework. A forum release should be tested on another Mac first, in case Gatekeeper or quarantine blocks the ad-hoc-signed framework there.
- **Build contents.** Builds currently include `vendor.sh` and `vendor/MediaRemoteAdapterTestClient`, which are only needed when vendoring. Adding them to a `.wfignore` keeps them out of the `.alfredworkflow` while keeping them in the repo.
- **Bundle IDs.** `ui.json` has its own `bundleid` (`nz.carl.nowplaying`), different from `info.plist` (`carlosnz.nowplaying`); `lib.sh` also uses `~/Library/Caches/nz.carl.nowplaying` as the cache when run outside Alfred. Make these consistent before release.
- `description` and the user-facing readme in `info.plist` are empty, and there is no `version` yet.

## Testing

Run the scripts directly with something playing (`control.sh` really controls playback):

```zsh
cd nowplaying.alfredui
./scripts/poll.sh | jq
./scripts/results.sh | jq
./scripts/control.sh playpause | jq
```

Set `ADAPTER=/path/to/mock` to replace the adapter with a script of your own, e.g. to test the error and "Nothing playing" states. Outside Alfred, artwork and `last-error` go to `~/Library/Caches/nz.carl.nowplaying`.

The `.alfredui` bundle lives inside the workflow folder; Alfred doesn't need a copy at the top level of its workflows directory.
