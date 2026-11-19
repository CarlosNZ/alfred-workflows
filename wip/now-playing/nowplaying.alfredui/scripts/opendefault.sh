#!/bin/bash
# Opens the default app (the `default_app` preference), or brings it to the
# front. Run by the `opendefault` button, a transparent button over the
# artwork, which poll.sh shows only while nothing is playing, when the
# artwork is the default app's icon.

. "$(dirname "$0")/lib.sh"

app="$(default_app)"
[ -n "$app" ] && exec /usr/bin/open "$app"
