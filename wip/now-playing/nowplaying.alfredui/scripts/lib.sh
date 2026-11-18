# Shared helpers, sourced by poll.sh, control.sh and results.sh.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor"
export PATH="/usr/bin:/bin:$PATH"

# The panel and the Script Filter both run with the workflow's cache folder,
# so they share artwork and app lookups.
CACHE="${alfred_workflow_cache:-$HOME/Library/Caches/nz.carl.nowplaying}"
mkdir -p "$CACHE"

# Run the vendored adapter. The adapter requires absolute paths, hence $ROOT.
# Set ADAPTER=/path/to/mock to test without the real thing.
adapter() {
  if [ -n "${ADAPTER:-}" ]; then
    "$ADAPTER" "$@"
  else
    /usr/bin/perl "$VENDOR/mediaremote-adapter.pl" "$VENDOR/MediaRemoteAdapter.framework" "$@"
  fi
}

adapter_installed() {
  [ -n "${ADAPTER:-}" ] || [ -f "$VENDOR/mediaremote-adapter.pl" -a -d "$VENDOR/MediaRemoteAdapter.framework" ]
}

# Print an update that shows a status message instead of a track.
show_message() {
  jq -nc --arg t "$1" --arg s "${2:-}" --arg sym "${3:-music.note}" '{update: {ids: {
    art:       {image: {type: "symbol", src: $sym, size: {width: 96}}},
    appicon:   {hidden: true},
    appname:   {text: ""},
    title:     {text: $t},
    artist:    {text: $s},
    album:     {text: ""},
    progress:  {progress: 0, hidden: true},
    elapsed:   {text: "", hidden: true},
    duration:  {text: "", hidden: true},
    playpause: {image: {type: "symbol", src: "play.fill"}}
  }}}'
}

# Pulse intervals in seconds: fast while playing (the elapsed time ticks),
# slower otherwise. PULSE_PLAYING must match "interval" in ui.json.
PULSE_PLAYING=1
PULSE_IDLE=3

# Read JSON Actions on stdin and add a "pulse" reconfiguration when the wanted
# interval ($1) differs from the current one. The current interval is tracked
# in $CACHE/pulse; a file older than 10s means the window has been closed and
# reopened since (pulses are never that far apart), so the pulse is back at
# the ui.json default.
with_pulse() {
  local want="$1" state="$CACHE/pulse" have="$PULSE_PLAYING"
  if [ -n "$(find "$state" -mtime -10s 2>/dev/null)" ]; then
    have="$(cat "$state")"
  fi
  echo "$want" > "$state"
  if [ "$want" = "$have" ]; then
    cat
  else
    jq -c --argjson i "$want" '. + {pulse: {src: "./scripts/poll.sh", interval: $i, intervalmode: "delay"}}'
  fi
}

# jq definitions for formatting times: `clock` turns seconds into m:ss, or
# h:mm:ss from an hour. `position` is the playback position clamped to
# 0…duration, from the adapter's JSON.
JQ_TIME='
  def pad: tostring | if length < 2 then "0" + . else . end;
  def clock: floor as $s
    | if $s >= 3600 then "\($s / 3600 | floor):\($s % 3600 / 60 | floor | pad):\($s % 60 | pad)"
      else "\($s / 60 | floor):\($s % 60 | pad)" end;
  def position: [.elapsedTimeNow // .elapsedTime // 0, .duration // 0] | min | [., 0] | max;
'

# Read the player state into these variables:
#   state  "missing" (adapter not installed), "error", "idle" (nothing
#          playing) or "playing" (a track is loaded, playing or paused)
#   rc     the adapter's exit code, when state is "error"; its first
#          stderr line is in $CACHE/last-error
#   info   the adapter's JSON (metadata only, with elapsedTimeNow)
#   art    the cached artwork file, or empty
#   app    the player's app path, or empty
load_track() {
  info="" art="" app="" rc=0

  if ! adapter_installed; then
    state="missing"
    return
  fi

  # Cheap call every time: metadata only, no base64 artwork. --now adds
  # elapsedTimeNow, the current playback position.
  local errfile="$CACHE/last-error"
  info="$(adapter get --no-artwork --now 2>"$errfile")"
  rc=$?

  # Non-zero exit is fatal (stderr lines with exit 0 are documented as harmless).
  if [ $rc -ne 0 ]; then
    state="error"
    return
  fi

  if [ -z "$info" ] || [ "$info" = "null" ]; then
    state="idle"
    return
  fi
  state="playing"

  # One artwork file per track, so an image view never shows a stale cached image.
  local key f
  key="$(jq -r '[.bundleIdentifier, .title, .artist // "", .album // ""] | join("|")' <<<"$info" | shasum | cut -c1-16)"
  for f in "$CACHE"/art-"$key".*; do
    [ -s "$f" ] && art="$f"
  done

  # Only pay for the full (artwork-carrying) call when the track has changed.
  # Artwork often arrives a beat after the title, so this retries until it shows up.
  if [ -z "$art" ]; then
    local full data mime ext
    full="$(adapter get 2>/dev/null)"
    data="$(jq -r '.artworkData // empty' <<<"$full" 2>/dev/null)"
    if [ -n "$data" ]; then
      mime="$(jq -r '.artworkMimeType // "image/jpeg"' <<<"$full")"
      ext="${mime#image/}"; [ "$ext" = "jpeg" ] && ext="jpg"
      rm -f "$CACHE"/art-*                       # drop the previous track's art
      art="$CACHE/art-$key.$ext"
      printf '%s' "$data" | base64 --decode > "$art" 2>/dev/null || art=""
    fi
  fi

  # The player's app path, cached per bundle ID (an empty file means no app was
  # found), so the lookup only runs when the player changes.
  local bundle appfile
  bundle="$(jq -r '.bundleIdentifier // empty' <<<"$info")"
  if [ -n "$bundle" ]; then
    appfile="$CACHE/app-$(printf '%s' "$bundle" | tr -c 'A-Za-z0-9.-' '_')"
    if [ ! -f "$appfile" ]; then
      osascript -l JavaScript "$ROOT/scripts/apppath.js" "$bundle" > "$appfile" 2>/dev/null || : > "$appfile"
    fi
    app="$(cat "$appfile")"
  fi
}
