#!/bin/bash
# Button handler: performs the action, then re-polls so the panel updates
# immediately instead of waiting for the next pulse.
# Test it on its own:  ./scripts/control.sh playpause | jq

. "$(dirname "$0")/lib.sh"
STEP=6   # system volume step, 0-100 scale

# MediaRemote command IDs (see the adapter README's `send` table)
case "$1" in
  playpause) adapter send 2 ;;   # kMRTogglePlayPause
  next)      adapter send 4 ;;   # kMRNextTrack
  prev)      adapter send 5 ;;   # kMRPreviousTrack
  volup)     osascript -e "set volume output volume ((output volume of (get volume settings)) + $STEP)" ;;
  voldown)   osascript -e "set volume output volume ((output volume of (get volume settings)) - $STEP)" ;;
esac >/dev/null 2>&1

# Give the player a moment to publish its new state.
sleep 0.25
exec "$(dirname "$0")/poll.sh"
