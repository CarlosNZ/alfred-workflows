# Now Playing

Developer notes. A small Alfred 6 panel showing the current track (artwork, title, artist, album) with playback and volume controls.

## How it works

The `nowplaying` keyword and the ⌃N hotkey both open an Alfred UI object, which loads the `nowplaying.alfredui` bundle:

- `nowplaying.alfredui/ui.json` defines the window (340×480, not resizeable): an artwork image view in the centre, then title/artist/album labels and a row of five buttons (volume down, previous, play/pause, next, volume up). Components that get updated have `id`s: `art`, `title`, `artist`, `album`, `playpause`.
- The `pulse` runs `scripts/poll.sh` every second (`intervalmode: delay`, so the next run waits for the previous one to finish), and immediately on open (`now: true`).
- `scripts/poll.sh` reads the player state with `media-control` and prints a JSON `{update: {ids: {…}}}` object that sets each component's text or image. With nothing playing it resets the panel to "Nothing playing" and a placeholder symbol.
- Each button runs `scripts/control.sh <action>` asynchronously (`playpause`, `next`, `prev`, `volup`, `voldown`). It performs the action, waits 0.25s for the player to publish its new state, then runs `poll.sh` so the panel updates without waiting for the next pulse. Volume changes the system output volume via `osascript`, 6 steps on the 0–100 scale.

### Artwork

Fetching artwork is expensive (`media-control get` returns it base64-encoded), so each pulse calls `get --no-artwork` and only does the full call when there is no cached artwork for the current track. Artwork is cached as `art-<hash>.<ext>` in `$alfred_workflow_cache`, keyed on a hash of player bundle ID, title, artist and album, so the image view never shows a stale image. The previous track's file is deleted when a new one is written. Artwork often arrives a moment after the track metadata, so a missing image is retried on every pulse until it appears.

## Dependencies

- [`media-control`](https://github.com/ungive/media-control) (Homebrew: `brew install media-control`). Override the binary with the `MEDIA_CONTROL` environment variable. It is not installed on this Mac at the moment, so the panel will always show "Nothing playing" until it is. For a Gallery release, Homebrew dependencies have to be declared for Alfred to handle; the workflow must not install them itself.
- `jq`, which ships with macOS (`/usr/bin/jq`).

The scripts prepend `/opt/homebrew/bin` and `/usr/local/bin` to `PATH`, because Alfred doesn't run scripts with your shell's `PATH`.

## Notes

- `ui.json` has its own `bundleid` (`nz.carl.nowplaying`), different from `info.plist` (`carlosnz.nowplaying`). `poll.sh` also falls back to `~/Library/Caches/nz.carl.nowplaying` when `$alfred_workflow_cache` isn't set (i.e. when run outside Alfred). Worth making these consistent before release.
- `description` and the user-facing readme in `info.plist` are empty, and there is no `version` yet.
- The `.alfredui` bundle lives inside the workflow folder. A stray copy at the top level of Alfred's workflows directory was removed; Alfred doesn't need it there.

## Testing

Run the scripts directly with something playing:

```zsh
./nowplaying.alfredui/scripts/poll.sh | jq
./nowplaying.alfredui/scripts/control.sh playpause | jq
```

Outside Alfred, artwork is cached in `~/Library/Caches/nz.carl.nowplaying`.
