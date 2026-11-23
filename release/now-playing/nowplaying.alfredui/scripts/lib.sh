# Shared helpers, sourced by all the scripts.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor"
# The vendored jq comes first, so every macOS runs the same jq (/usr/bin/jq
# only ships from macOS 15, and its version follows the OS).
export PATH="$VENDOR/jq/bin:/usr/bin:/bin:$PATH"

# The panel and the Script Filter both run with the workflow's cache folder,
# so they share artwork and app lookups.
CACHE="${alfred_workflow_cache:-$HOME/Library/Caches/net.smithnz.carl.nowplaying}"
mkdir -p "$CACHE"

# Settings chosen in the panel itself (the layout) persist in the workflow's
# data folder.
DATA="${alfred_workflow_data:-$HOME/Library/Application Support/net.smithnz.carl.nowplaying}"

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

# Print the `content` view for layout $1, as JSON: the artwork, the text
# (text_view, for kind $2: "track", the default, or "idle") and the controls
# (progress and buttons), from parts/art.json and parts/controls.json,
# arranged for that layout. The idle kind has no controls, as there's
# nothing to control; the text takes their space, raised IDLE_LIFT_PORTRAIT
# or IDLE_LIFT_LANDSCAPE points from where it would otherwise sit (the
# bottom of the panel in portrait, the middle of the details column in
# landscape). Both are set by eye.
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
#
# The workflow's icon (icon.png in the workflow folder), shown in place of
# the artwork when nothing is playing (`idleart`; see idle_update), is put in its image view here, at
# IDLE_ART_SIZE, rather than by an update, so the view is laid out at that
# size from the start. Alfred doesn't always lay the window out again when
# an update changes an image's size, so an image sent later could stay at
# the size of the one it replaced until the window was resized.
TOPROW_HEIGHT=28
PORTRAIT_GAP=6
LANDSCAPE_GAP=14
LANDSCAPE_INSET=16
IDLE_LIFT_PORTRAIT=40
IDLE_LIFT_LANDSCAPE=18
content_view() {
  jq -n --arg layout "$1" --argjson row "$TOPROW_HEIGHT" --argjson pgap "$PORTRAIT_GAP" \
     --argjson lgap "$LANDSCAPE_GAP" --argjson inset "$LANDSCAPE_INSET" --slurpfile art "$ROOT/parts/art.json" \
     --argjson text "$(text_view "${2:-track}")" --slurpfile controls "$ROOT/parts/controls.json" \
     --arg kind "${2:-track}" --argjson plift "$IDLE_LIFT_PORTRAIT" --argjson llift "$IDLE_LIFT_LANDSCAPE" \
     --arg icon "$(dirname "$ROOT")/icon.png" --argjson iconsize "$IDLE_ART_SIZE" '
    ($art[0] | (.components[] | select(.id == "idleart") | .components[]
                | select(.id == "idleartimage") | .image)
                 = {type: "file", src: $icon, size: {width: $iconsize, height: $iconsize}}) as $art
    | ($kind == "idle") as $idle
    | (if $idle then [] else $controls end) as $controls
    | {id: "content", type: "view"}
    + if $layout == "landscape" then {
        layout: "grid", rows: 1, cols: 2, spacing: 20,
        constraints: {insets: {top: $inset, bottom: $inset}},
        components: [$art, {
          type: "view", layout: "border", spacing: 14,
          constraints: {insets: {top: ($row + $lgap - $inset)}},
          components: ([
            $text + {constraints: ({region: "centre", position: "centre", stretch: "horizontal"}
              + if $idle then {insets: {bottom: (2 * $llift)}} else {} end)}
          ] + [$controls[] + {constraints: {region: "bottom"}}])
        }]
      } else {
        layout: "border", spacing: 14,
        constraints: {insets: {top: ($row + $pgap)}},
        components: [$art + {constraints: {region: "centre"}}, {
          type: "view", layout: "inline", direction: "vertical", spacing: 24,
          constraints: ({region: "bottom"} + if $idle then {insets: {bottom: $plift}} else {} end),
          components: ([$text] + $controls)
        }]
      } end'
}

# Print the text view for kind $1, as JSON: "track" is the title, artist
# and album labels (parts/text.json), which status messages use too; "idle"
# is for when nothing is playing (parts/idle.json): the default app's icon,
# with "No media playing" over it and the `opendefault` button over both, so
# a click opens the app, and below that a hint to click the icon. With no
# default app, the icon and button are hidden and the hint is empty.
#
# Alfred UI labels have no stroke or shadow, so "No media playing" (the
# `idletext` label) is given an outline by `stroked`: eight dark copies of
# the label behind it, each moved IDLE_STROKE points in one direction (less
# on the diagonals, to keep the outline round). A label is moved
# horizontally by stretching it across the stack and insetting one side by
# twice the distance, as the text is centred in what's left; a label that
# isn't stretched disappears when inset from the side. The copies have no
# accessibility label; Alfred UI has no documented way to hide a component
# from VoiceOver.
IDLE_STROKE=1.5
text_view() {
  if [ "$1" = idle ]; then
    jq -c --arg app "$(default_app)" --argjson r "$IDLE_STROKE" '
      def stroked($label):
        ([[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]][] as [$x, $y]
        | (if $x != 0 and $y != 0 then 0.7 else 1 end * $r) as $d
        | $label + {colour: "rgb(0, 0, 0, 1)", opacity: 0.75, constraints: ($label.constraints + {
            stretch: "horizontal",
            insets: {bottom: ($label.constraints.insets.bottom - $y * $d),
                     left: ([2 * $x * $d, 0] | max), right: ([-2 * $x * $d, 0] | max)}})}
        | del(.id, .accessibility)),
        $label;
      ($app | split("/") | last // "" | rtrimstr(".app")) as $name
      | ("Open \($name)") as $tip
      | .components |= map(
        if .id == "hint" then
          .text = (if $app == "" then "" else "Click \($name) icon to launch it" end)
        else .components |= (map(
          if .id == "idleicon" then
            if $app == "" then .hidden = true
            else .image = {type: "fileicon", src: $app, size: {width: 112, height: 112}} end
          elif .id == "idletext" then [stroked(.)]
          elif .id == "opendefault" then
            if $app == "" then .hidden = true
            else .tooltip = $tip | .accessibility = {label: $tip} end
          else . end) | flatten)
        end)' "$ROOT/parts/idle.json"
  else
    jq -c . "$ROOT/parts/text.json"
  fi
}

# Read JSON Actions on stdin and add a `replace` of the `content` view when
# the kind of text it shows should change to $1 ("track" or "idle"; see
# text_view). A hidden component still takes up space, so the two kinds
# can't both be in the panel with one hidden. The kind last drawn is in
# $CACHE/content-kind; window.sh and layout.sh build the content with the
# kind recorded there.
with_content() {
  local state="$CACHE/content-kind"
  if [ "$(cat "$state" 2>/dev/null || echo track)" = "$1" ]; then
    cat
  else
    printf '%s' "$1" > "$state"
    jq -c --argjson view "$(content_view "$(current_layout)" "$1")" '.replace.ids.content = $view'
  fi
}

# Print the kind of text the `content` view last drawn shows (see
# with_content).
content_kind() {
  [ "$(cat "$CACHE/content-kind" 2>/dev/null)" = idle ] && echo idle || echo track
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
# parts/toprow.json, showing app $1 (an app path; empty hides both). A click
# on the view opens or focuses the app (openapp.sh).
app_view() {
  jq -c --arg app "$1" '
    .components[] | select(.id == "app")
    | (if $app == "" then . else .events = [{triggers: "clicked",
        action: {type: "script", src: "./scripts/openapp.sh", args: [$app], async: true}}] end)
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
    jq -c --argjson view "$(app_view "$1")" '.replace.ids.app = $view'
  fi
}

# Print the artwork view's image for SF Symbol $1, as JSON.
symbol_image() {
  jq -nc --arg sym "$1" '{type: "symbol", src: $sym, size: {width: 96}}'
}

# Print the default app's path (the `default_app` preference), or nothing
# when it isn't set or doesn't exist. The panel's scripts don't see the
# workflow's preferences, so window.sh saves it to $CACHE/default-app.
default_app() {
  local app
  app="$(cat "$CACHE/default-app" 2>/dev/null)"
  [ -n "$app" ] && [ -e "$app" ] && printf '%s' "$app"
}

# Print an update that shows a status message instead of a track, with image
# $3 (JSON, default the music.note symbol) as the artwork. Pass it through
# with_content track and with_toprow "".
show_message() {
  jq -nc --arg t "$1" --arg s "${2:-}" --argjson img "${3:-$(symbol_image music.note)}" '{update: {ids: {
    art:       {image: $img, hidden: false},
    idleart:   {hidden: true},
    title:     {text: $t},
    artist:    {text: $s},
    album:     {text: ""},
    progress:  {progress: 0, hidden: true},
    elapsed:   {text: "", hidden: true},
    duration:  {text: "", hidden: true},
    playpause: {image: {type: "symbol", src: "play.fill"}}
  }}}'
}

# Print the update for when nothing is playing: the workflow's icon in
# place of the artwork. The text is the idle kind (with the default app's
# icon to click; see text_view), which needs no update, and has no controls.
# Pass it through with_content idle and with_toprow "".
#
# The icon is in its own image view, `idleart` in parts/art.json, rather
# than the artwork view, which stretches to fill its space and scales its
# image to fit, up as well as down. `idleart` is centred in that space
# without stretching, so it takes the icon's own size, IDLE_ART_SIZE points,
# and shrinks only when the space is smaller. content_view puts the icon in
# it.
IDLE_ART_SIZE=512
idle_update() {
  jq -nc '{update: {ids: {art: {hidden: true}, idleart: {hidden: false}}}}'
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

  app="$(app_path "$(jq -r '.bundleIdentifier // empty' <<<"$info")")"
}

# Print the path of the app with bundle ID $1, or nothing. Lookups are cached
# per bundle ID (an empty file means no app was found), so apppath.js only
# runs for a new one.
app_path() {
  [ -n "$1" ] || return 0
  local appfile="$CACHE/app-$(printf '%s' "$1" | tr -c 'A-Za-z0-9.-' '_')"
  if [ ! -f "$appfile" ]; then
    osascript -l JavaScript "$ROOT/scripts/apppath.js" "$1" > "$appfile" 2>/dev/null || : > "$appfile"
  fi
  cat "$appfile"
}
