#!/bin/bash
# Button handler: performs the action, then re-polls so the panel updates
# immediately instead of waiting for the next pulse.
# Test it on its own:  ./scripts/control.sh playpause | jq

. "$(dirname "$0")/lib.sh"
JUMP=15   # seconds jumped back or forward

# Seek $1 seconds from the current position (negative to go back), clamped
# to the track. The adapter's `seek` takes an absolute position in
# microseconds, so it's worked out from `get --now --micros`. Does nothing
# without a duration (e.g. live streams), as there's no timeline to seek in.
#
# The player takes a moment (up to about 0.7s for Spotify) to report the new
# position, and a jump started before then would start from the old one, so
# quick repeated clicks would jump only once. So each jump waits, up to 1.5s,
# until the reported position is within a second of where it seeked to, and
# jumps run one at a time, under a lock (a directory, as mkdir is atomic).
# The panel's buttons run their scripts asynchronously, so a click can start
# while a jump is still running.
jump() {
  local lock="$CACHE/jump.lock" to i
  for i in {1..50}; do mkdir "$lock" 2>/dev/null && break; sleep 0.1; done
  to=$(adapter get --no-artwork --now --micros | jq -r --argjson d "$1" '
    select(.durationMicros > 0)
    | [(.elapsedTimeNowMicros // .elapsedTimeMicros // 0) + $d * 1000000, .durationMicros]
    | min | [., 0] | max | floor')
  if [ -n "$to" ] && adapter seek "$to"; then
    for i in {1..15}; do
      adapter get --no-artwork --now --micros \
        | jq -e --argjson to "$to" '(.elapsedTimeNowMicros // 0) - $to | fabs < 1000000' && break
      sleep 0.1
    done
  fi
  rmdir "$lock" 2>/dev/null
}

# MediaRemote command IDs (see the adapter README's `send` table)
case "$1" in
  playpause) adapter send 2 ;;   # kMRTogglePlayPause
  next)      adapter send 4 ;;   # kMRNextTrack
  prev)      adapter send 5 ;;   # kMRPreviousTrack
  back)      jump "-$JUMP" ;;
  forward)   jump "$JUMP" ;;
esac >/dev/null 2>&1

# Give the player a moment to publish its new state (a jump has already
# waited for it).
case "$1" in back|forward) ;; *) sleep 0.25 ;; esac
exec "$(dirname "$0")/poll.sh"
