#!/bin/bash
# Applies the transparency preference to the panel's background. Runs on the
# root view's `preload` event, before the window is shown.
# The tint's alpha is a fraction, which a ui.json placeholder can't compute
# from the slider's 0-100 value, hence a script.
# Test it on its own:  transparency=30 ./scripts/style.sh | jq

transparency="${transparency:-45}"
case "$transparency" in
  ''|*[!0-9]*) transparency=45 ;;
esac
[ "$transparency" -gt 100 ] && transparency=100

alpha=$(printf '%d.%02d' $(( (100 - transparency) / 100 )) $(( (100 - transparency) % 100 )))
printf '{"update":{"ids":{"panel":{"background":"rgb(18, 18, 20, %s)"}}}}\n' "$alpha"
