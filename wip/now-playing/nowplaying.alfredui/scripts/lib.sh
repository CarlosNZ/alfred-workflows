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
    title:     {text: $t},
    artist:    {text: $s},
    album:     {text: ""},
    playpause: {image: {type: "symbol", src: "play.fill"}}
  }}}'
}
