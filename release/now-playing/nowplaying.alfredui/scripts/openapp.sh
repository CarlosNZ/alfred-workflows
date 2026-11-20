#!/bin/bash
# Opens the playing app, or brings it to the front if it's running. Run by a
# click on the top row's app icon or name, with the app's path, which
# app_view in lib.sh puts in the click event's arguments.

[ -n "$1" ] && exec /usr/bin/open "$1"
