#!/bin/bash
# Button handler: performs the action, then re-polls so the panel updates
# immediately instead of waiting for the next pulse.
# Test it on its own:  ./scripts/control.sh playpause | jq

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
MC="${MEDIA_CONTROL:-media-control}"
here="$(cd "$(dirname "$0")" && pwd)"
STEP=6   # system volume step, 0-100 scale

case "$1" in
  playpause) "$MC" toggle-play-pause ;;
  next)      "$MC" next-track ;;
  prev)      "$MC" previous-track ;;
  volup)     osascript -e "set volume output volume ((output volume of (get volume settings)) + $STEP)" ;;
  voldown)   osascript -e "set volume output volume ((output volume of (get volume settings)) - $STEP)" ;;
esac >/dev/null 2>&1

# Give the player a moment to publish its new state.
sleep 0.25
exec "$here/poll.sh"
