#!/bin/bash
# Pulse script: reads now-playing state and prints Alfred UI JSON Actions
# that update the panel. Runs every second (see "pulse" in ui.json).
# Test it on its own:  ./scripts/poll.sh | jq

# Alfred scripts don't get your shell's PATH, so add Homebrew explicitly.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
MC="${MEDIA_CONTROL:-media-control}"
CACHE="${alfred_workflow_cache:-$HOME/Library/Caches/nz.carl.nowplaying}"
mkdir -p "$CACHE"

# Cheap call every pulse: metadata only, no base64 artwork.
info="$("$MC" get --no-artwork 2>/dev/null)"

if [ -z "$info" ] || [ "$info" = "null" ]; then
  jq -nc '{update: {ids: {
    art:       {image: {type: "symbol", src: "music.note", size: {width: 96}}},
    title:     {text: "Nothing playing"},
    artist:    {text: ""},
    album:     {text: ""},
    playpause: {image: {type: "symbol", src: "play.fill"}}
  }}}'
  exit 0
fi

# One artwork file per track, so the image view never shows a stale cached image.
key="$(jq -r '[.bundleIdentifier, .title, .artist // "", .album // ""] | join("|")' <<<"$info" | shasum | cut -c1-16)"

art=""
for f in "$CACHE"/art-"$key".*; do
  [ -s "$f" ] && art="$f"
done

# Only pay for the full (artwork-carrying) call when the track has changed.
# Artwork often arrives a beat after the title, so this retries until it shows up.
if [ -z "$art" ]; then
  full="$("$MC" get 2>/dev/null)"
  data="$(jq -r '.artworkData // empty' <<<"$full")"
  if [ -n "$data" ]; then
    mime="$(jq -r '.artworkMimeType // "image/jpeg"' <<<"$full")"
    ext="${mime#image/}"; [ "$ext" = "jpeg" ] && ext="jpg"
    rm -f "$CACHE"/art-*                       # drop the previous track's art
    art="$CACHE/art-$key.$ext"
    printf '%s' "$data" | base64 --decode > "$art" 2>/dev/null || art=""
  fi
fi

jq -nc --argjson i "$info" --arg art "$art" '
  {update: {ids: {
    art: {image: (if $art == "" then {type: "symbol", src: "music.note", size: {width: 96}}
                  else {type: "file", src: $art} end)},
    title:     {text: $i.title},
    artist:    {text: ($i.artist // "")},
    album:     {text: ($i.album // "")},
    playpause: {image: {type: "symbol", src: (if $i.playing then "pause.fill" else "play.fill" end)}}
  }}}'
