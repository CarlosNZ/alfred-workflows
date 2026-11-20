#!/bin/bash
# Opens the default app (the `default_app` preference), or brings it to the
# front. Run by the `opendefault` button, a transparent button over the
# default app's icon in the "No media playing" view, which the panel shows
# only while nothing is playing (parts/idle.json, text_view in lib.sh).

. "$(dirname "$0")/lib.sh"

app="$(default_app)"
[ -n "$app" ] && exec /usr/bin/open "$app"
