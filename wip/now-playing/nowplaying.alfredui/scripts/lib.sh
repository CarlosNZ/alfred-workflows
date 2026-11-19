# Shared helpers, sourced by all the scripts.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor"
export PATH="/usr/bin:/bin:$PATH"

# The panel and the Script Filter both run with the workflow's cache folder,
# so they share artwork and app lookups.
CACHE="${alfred_workflow_cache:-$HOME/Library/Caches/nz.carl.nowplaying}"
mkdir -p "$CACHE"

# Settings chosen in the panel itself (the layout) persist in the workflow's
# data folder.
DATA="${alfred_workflow_data:-$HOME/Library/Application Support/nz.carl.nowplaying}"

# Print the saved layout: "portrait" (the default) or "landscape".
current_layout() {
  local layout
  layout=$(cat "$DATA/layout" 2>/dev/null)
  case "$layout" in
    landscape) echo landscape ;;
    *) echo portrait ;;
  esac
}

# Print the window's starting size for layout $1, as JSON. The window is
# resizeable from there. Its minimum size (`minsize` in window.json) is shared
# by both layouts, because a `window` JSON Action can resize the open window
# but ignores `minsize`, so the minimum set when the window opens stays in
# force after a layout switch.
layout_size() {
  case "$1" in
    landscape) echo '{"width": 620, "height": 348}' ;;
    *) echo '{"width": 340, "height": 540}' ;;
  esac
}

# Print the window's maximum size for layout $1, as JSON, which also limits
# how far the zoom button grows it (Alfred UI can't disable zoom on a
# resizeable window). Alfred sets the maximum only when the window opens, so
# after a layout switch the previous layout's maximum stays in force until
# the panel is reopened. Each layout's maximum is therefore at least the
# other's starting size, so a switch never resizes the window past it.
layout_maxsize() {
  case "$1" in
    landscape) echo '{"width": 1000, "height": 560}' ;;
    *) echo '{"width": 640, "height": 960}' ;;
  esac
}

# Print the `content` view for layout $1, as JSON: the artwork, the track
# text (title, artist, album) and the controls (progress and buttons), from
# parts/art.json, parts/text.json and parts/controls.json, arranged for that
# layout.
#
# The root view is a stack: the content fills it, and the top row (app and
# settings) is laid over it, pinned to the top. Whatever must stay clear of
# the top row is inset from the top by its height, TOPROW_HEIGHT (the 26pt
# app icon, as laid out), plus a gap.
#
# Portrait stacks them below the top row, PORTRAIT_GAP under it: artwork,
# then the text, then the controls, with a wider gap between text and
# controls than within either.
#
# Landscape puts the artwork and a details column side by side in two equal
# grid cells, inset LANDSCAPE_INSET from the top and bottom so the artwork
# clears the window buttons at the top left, and is still centred between
# the window's top and bottom edges, unaffected by the top row. The details
# column is inset the rest of the way to LANDSCAPE_GAP below the top row: a
# border layout with the controls in its bottom region and the text
# vertically centred in the space above. When the artwork fills its cell's height (a square image in a cell
# at least as wide as it is tall, as at the starting size), the controls sit
# flush with the bottom of the artwork.
#
# Either way the artwork view fills its space and `resize: fit` scales the
# image to fit it, keeping its aspect ratio and centring it.
TOPROW_HEIGHT=28
PORTRAIT_GAP=6
LANDSCAPE_GAP=14
LANDSCAPE_INSET=16
content_view() {
  jq -n --arg layout "$1" --argjson row "$TOPROW_HEIGHT" --argjson pgap "$PORTRAIT_GAP" \
     --argjson lgap "$LANDSCAPE_GAP" --argjson inset "$LANDSCAPE_INSET" --slurpfile art "$ROOT/parts/art.json" \
     --slurpfile text "$ROOT/parts/text.json" --slurpfile controls "$ROOT/parts/controls.json" '
    $art[0] as $art | $text[0] as $text | $controls[0] as $controls
    | {id: "content", type: "view"}
    + if $layout == "landscape" then {
        layout: "grid", rows: 1, cols: 2, spacing: 20,
        constraints: {insets: {top: $inset, bottom: $inset}},
        components: [$art, {
          type: "view", layout: "border", spacing: 14,
          constraints: {insets: {top: ($row + $lgap - $inset)}},
          components: [
            $text + {constraints: {region: "centre", position: "centre", stretch: "horizontal"}},
            $controls + {constraints: {region: "bottom"}}
          ]
        }]
      } else {
        layout: "border", spacing: 14,
        constraints: {insets: {top: ($row + $pgap)}},
        components: [$art + {constraints: {region: "centre"}}, {
          type: "view", layout: "inline", direction: "vertical", spacing: 24,
          constraints: {region: "bottom"},
          components: [$text, $controls]
        }]
      } end'
}

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

# Print the top row's `app` view (icon and name) as JSON, from
# parts/toprow.json, showing app $1 (an app path; empty hides both).
app_view() {
  jq -c --arg app "$1" '
    .components[] | select(.id == "app")
    | .components |= map(
        if .id == "appicon" then
          . + (if $app == "" then {hidden: true}
               else {hidden: false, image: {type: "fileicon", src: $app, size: {width: 26, height: 26}}} end)
        elif .id == "appname" then
          .text = ($app | split("/") | last // "" | rtrimstr(".app"))
        else . end)' "$ROOT/parts/toprow.json"
}

# Print the properties of the top row's `rotate` button for layout $1, as
# JSON: it shows the current layout's shape with a rotate arrow, and switches
# to the other layout when clicked (layout.sh toggle).
rotate_button() {
  case "$1" in
    landscape) jq -nc '{image: {type: "symbol", src: "rectangle.landscape.rotate"},
                        tooltip: "Switch to portrait", accessibility: {label: "Switch to portrait"}}' ;;
    *) jq -nc '{image: {type: "symbol", src: "rectangle.portrait.rotate"},
                tooltip: "Switch to landscape", accessibility: {label: "Switch to landscape"}}' ;;
  esac
}

# Print the top row (parts/toprow.json) as JSON, with the `app` view showing
# app $1 and the `rotate` button set for layout $2.
toprow_view() {
  jq -c --argjson app "$(app_view "$1")" --argjson rotate "$(rotate_button "$2")" '
    .components |= map(
      if .id == "app" then $app
      elif .id == "rotate" then . + $rotate
      else . end)' "$ROOT/parts/toprow.json"
}

# Read JSON Actions on stdin and add a `replace` of the top row's `app` view
# when the app it shows should change to $1 (an app path, or empty for none).
#
# The app's icon and name aren't changed with `update`: Alfred sizes a
# component when it's laid out and doesn't re-measure it when an update
# changes its text, so the name would keep the width it had before (a few
# points, as it starts empty, which truncates it). `relayout: true` doesn't
# help either: views keep the space they were given and squeeze their
# contents into it. A replaced view is measured afresh, with the name in
# place, and the `app` view sits in the top row's centre region (all the
# width the rotate button leaves), aligned right (`position: right`), so its
# new size has room. The rotate button is outside it: it doesn't change with
# the app, so there's nothing to gain from rebuilding it.
#
# The app last drawn is recorded in $CACHE/toprow-app, and the view is only
# replaced when that changes. window.sh removes the file when building the
# window, so a newly opened panel gets its app on the first pulse.
with_toprow() {
  local state="$CACHE/toprow-app"
  if [ -f "$state" ] && [ "$(cat "$state")" = "$1" ]; then
    cat
  else
    printf '%s' "$1" > "$state"
    jq -c --argjson view "$(app_view "$1")" '. + {replace: {ids: {app: $view}}}'
  fi
}

# Print an update that shows a status message instead of a track. Pass it
# through with_toprow "" to hide the app.
show_message() {
  jq -nc --arg t "$1" --arg s "${2:-}" --arg sym "${3:-music.note}" '{update: {ids: {
    art:       {image: {type: "symbol", src: $sym, size: {width: 96}}},
    title:     {text: $t},
    artist:    {text: $s},
    album:     {text: ""},
    progress:  {progress: 0, hidden: true},
    elapsed:   {text: "", hidden: true},
    duration:  {text: "", hidden: true},
    playpause: {image: {type: "symbol", src: "play.fill"}}
  }}}'
}

# Pulse intervals in seconds: fast while playing (the elapsed time ticks),
# slower otherwise. PULSE_PLAYING must match "interval" in ui.json.
PULSE_PLAYING=1
PULSE_IDLE=3

# Read JSON Actions on stdin and add a "pulse" reconfiguration when the wanted
# interval ($1) differs from the current one. The current interval is tracked
# in $CACHE/pulse; a file older than 10s means the window has been closed and
# reopened since (pulses are never that far apart), so the pulse is back at
# the ui.json default.
with_pulse() {
  local want="$1" state="$CACHE/pulse" have="$PULSE_PLAYING"
  if [ -n "$(find "$state" -mtime -10s 2>/dev/null)" ]; then
    have="$(cat "$state")"
  fi
  echo "$want" > "$state"
  if [ "$want" = "$have" ]; then
    cat
  else
    jq -c --argjson i "$want" '. + {pulse: {src: "./scripts/poll.sh", interval: $i, intervalmode: "delay"}}'
  fi
}

# jq definitions for formatting times: `clock` turns seconds into m:ss, or
# h:mm:ss from an hour. `position` is the playback position clamped to
# 0…duration, from the adapter's JSON.
JQ_TIME='
  def pad: tostring | if length < 2 then "0" + . else . end;
  def clock: floor as $s
    | if $s >= 3600 then "\($s / 3600 | floor):\($s % 3600 / 60 | floor | pad):\($s % 60 | pad)"
      else "\($s / 60 | floor):\($s % 60 | pad)" end;
  def position: [.elapsedTimeNow // .elapsedTime // 0, .duration // 0] | min | [., 0] | max;
'

# Read the player state into these variables:
#   state  "missing" (adapter not installed), "error", "idle" (nothing
#          playing) or "playing" (a track is loaded, playing or paused)
#   rc     the adapter's exit code, when state is "error"; its first
#          stderr line is in $CACHE/last-error
#   info   the adapter's JSON (metadata only, with elapsedTimeNow)
#   art    the cached artwork file, or empty
#   app    the player's app path, or empty
load_track() {
  info="" art="" app="" rc=0

  if ! adapter_installed; then
    state="missing"
    return
  fi

  # Cheap call every time: metadata only, no base64 artwork. --now adds
  # elapsedTimeNow, the current playback position.
  local errfile="$CACHE/last-error"
  info="$(adapter get --no-artwork --now 2>"$errfile")"
  rc=$?

  # Non-zero exit is fatal (stderr lines with exit 0 are documented as harmless).
  if [ $rc -ne 0 ]; then
    state="error"
    return
  fi

  if [ -z "$info" ] || [ "$info" = "null" ]; then
    state="idle"
    return
  fi
  state="playing"

  # One artwork file per track, so an image view never shows a stale cached image.
  local key f
  key="$(jq -r '[.bundleIdentifier, .title, .artist // "", .album // ""] | join("|")' <<<"$info" | shasum | cut -c1-16)"
  for f in "$CACHE"/art-"$key".*; do
    [ -s "$f" ] && art="$f"
  done

  # Only pay for the full (artwork-carrying) call when the track has changed.
  # Artwork often arrives a beat after the title, so this retries until it shows up.
  if [ -z "$art" ]; then
    local full data mime ext
    full="$(adapter get 2>/dev/null)"
    data="$(jq -r '.artworkData // empty' <<<"$full" 2>/dev/null)"
    if [ -n "$data" ]; then
      mime="$(jq -r '.artworkMimeType // "image/jpeg"' <<<"$full")"
      ext="${mime#image/}"; [ "$ext" = "jpeg" ] && ext="jpg"
      rm -f "$CACHE"/art-*                       # drop the previous track's art
      art="$CACHE/art-$key.$ext"
      printf '%s' "$data" | base64 --decode > "$art" 2>/dev/null || art=""
    fi
  fi

  # The player's app path, cached per bundle ID (an empty file means no app was
  # found), so the lookup only runs when the player changes.
  local bundle appfile
  bundle="$(jq -r '.bundleIdentifier // empty' <<<"$info")"
  if [ -n "$bundle" ]; then
    appfile="$CACHE/app-$(printf '%s' "$bundle" | tr -c 'A-Za-z0-9.-' '_')"
    if [ ! -f "$appfile" ]; then
      osascript -l JavaScript "$ROOT/scripts/apppath.js" "$bundle" > "$appfile" 2>/dev/null || : > "$appfile"
    fi
    app="$(cat "$appfile")"
  fi
}
