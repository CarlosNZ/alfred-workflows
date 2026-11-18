# Shared helpers, sourced by poll.sh and control.sh.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor"
export PATH="/usr/bin:/bin:$PATH"

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
