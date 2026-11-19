#!/bin/bash
# Opens the default app (the `default_app` preference), or brings it to the
# front. Run by the `opendefault` button, a transparent button over the
# default app's icon, which poll.sh shows in place of the artwork only while
# nothing is playing (idle_update in lib.sh).

. "$(dirname "$0")/lib.sh"

app="$(default_app)"
[ -n "$app" ] && exec /usr/bin/open "$app"
