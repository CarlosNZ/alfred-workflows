# Now Playing

Developer notes. A small Alfred 6 panel showing the current track (artwork, title, artist, album) with playback and volume controls.

## How it works

The `nowplaying` keyword and the ⌃N hotkey both open an Alfred UI object, which loads the `nowplaying.alfredui` bundle:

- `ui.json` defines the window (340×480, not resizeable): an artwork image view in the centre, then title/artist/album labels and a row of five buttons (volume down, previous, play/pause, next, volume up). Components that get updated have `id`s: `art`, `title`, `artist`, `album`, `playpause`.
- The `pulse` runs `scripts/poll.sh` every second (`intervalmode: delay`, so the next run waits for the previous one to finish), and immediately on open (`now: true`).
- `scripts/poll.sh` reads the player state through the vendored adapter and prints a JSON `{update: {ids: {…}}}` object that sets each component's text or image.
- Each button runs `scripts/control.sh <action>` asynchronously (`playpause`, `next`, `prev`, `volup`, `voldown`). Playback actions send MediaRemote command (MRCommand) IDs through the adapter: `send 2` toggle play/pause, `4` next track, `5` previous track (`0` play, `1` pause and `3` stop are also available). Volume changes the system output volume via `osascript`, 6 steps on the 0–100 scale. It then waits 0.25s for the player to publish its new state and runs `poll.sh`, so the panel updates without waiting for the next pulse.
- `scripts/lib.sh` is sourced by both scripts: it locates the bundle, defines `adapter` (runs the vendored adapter), `adapter_installed`, and `show_message` (puts a status message and SF Symbol in the panel instead of a track).

### Status messages

`poll.sh` shows these in place of a track:

| Message | When |
|---|---|
| Adapter not installed | `vendor/` is missing the adapter script or framework |
| Adapter error (*code*) | the adapter exits non-zero; the subtitle is the first line of its stderr, also saved to `$CACHE/last-error`. Stderr output with exit 0 is treated as harmless. |
| Nothing playing | the adapter returns nothing or `null` |

### Artwork

Fetching artwork is expensive (`get` returns it base64-encoded), so each pulse calls `get --no-artwork` and only does the full call when there is no cached artwork for the current track. Artwork is cached as `art-<hash>.<ext>` in `$alfred_workflow_cache`, keyed on a hash of player bundle ID, title, artist and album, so the image view never shows a stale image. The previous track's file is deleted when a new one is written. Artwork often arrives a moment after the track metadata, so a missing image is retried on every pulse until it appears.

## The vendored adapter

Recent macOS versions only let entitled processes use the private MediaRemote framework, which holds now-playing information. [ungive/mediaremote-adapter](https://github.com/ungive/mediaremote-adapter) works around this by loading its own framework into the system's `/usr/bin/perl`; its `test` command checks that this still works on the current macOS. It's vendored into `nowplaying.alfredui/vendor/` so the workflow has no runtime dependencies:

- `mediaremote-adapter.pl`: the entry point, run as `/usr/bin/perl mediaremote-adapter.pl <absolute path to framework> <command>`. The framework path must be absolute, which is why `lib.sh` resolves the bundle root.
- `MediaRemoteAdapter.framework`: the compiled framework (keep its internal symlinks intact; `wf build` does).
- `MediaRemoteAdapterTestClient`: used only by `vendor.sh`'s post-build test.
- `LICENSE` and `VERSION` (the upstream commit that was built).

`vendor.sh` rebuilds it: it clones the adapter (default `master`, or pass a tag/branch, e.g. `./vendor.sh v0.5.0`), builds it with cmake, replaces `vendor/`, and runs the adapter's `test` command. It needs Xcode command line tools, cmake and git, at build time only. Prefer passing a tag so rebuilds are reproducible; `vendor/VERSION` records what was built.

Other runtime requirements ship with macOS: `/usr/bin/perl`, `/usr/bin/jq`, `osascript`. `lib.sh` sets `PATH` to the system directories only.

Run `/usr/bin/perl vendor/mediaremote-adapter.pl` with no arguments for the adapter's full usage. Besides `get` and `send` it has `stream`, which emits changes as they happen and could replace the one-second polling.

## Before a release

- **Signing.** The framework (and test client) are ad-hoc signed, which is all a local build gets. The Gallery requires compiled binaries to be signed and notarised, so a Gallery release needs a Developer ID signature and notarisation for the framework. A forum release should be tested on another Mac first, in case Gatekeeper or quarantine blocks the ad-hoc-signed framework there.
- **Build contents.** Builds currently include `vendor.sh` and `vendor/MediaRemoteAdapterTestClient`, which are only needed when vendoring. Adding them to a `.wfignore` keeps them out of the `.alfredworkflow` while keeping them in the repo.
- **Bundle IDs.** `ui.json` has its own `bundleid` (`nz.carl.nowplaying`), different from `info.plist` (`carlosnz.nowplaying`); `poll.sh` also uses `~/Library/Caches/nz.carl.nowplaying` as its cache when run outside Alfred. Make these consistent before release.
- `description` and the user-facing readme in `info.plist` are empty, and there is no `version` yet.

## Testing

Run the scripts directly with something playing (`control.sh` really controls playback):

```zsh
cd nowplaying.alfredui
./scripts/poll.sh | jq
./scripts/control.sh playpause | jq
```

Set `ADAPTER=/path/to/mock` to replace the adapter with a script of your own, e.g. to test the error and "Nothing playing" states. Outside Alfred, artwork and `last-error` go to `~/Library/Caches/nz.carl.nowplaying`.

The `.alfredui` bundle lives inside the workflow folder; Alfred doesn't need a copy at the top level of its workflows directory.
