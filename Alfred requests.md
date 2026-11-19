# Alfred requests

Features we'd like added to Alfred, each with the use case in our workflows that needs it. Checked against Alfred 6.

## Alfred UI: always-on-top windows

**Request:** a window setting that keeps an Alfred UI window above other apps' windows (for example `"level": "floating"`, matching `NSWindow.level`), which the `window` JSON Action can also change on an open window.

**Use case:** Now Playing ([`wip/now-playing`](wip/now-playing/README.md)) is a small panel with the current track and playback controls. Users want to keep it visible while working in other apps, and to turn that on and off with a button in the panel. A toggle needs the `window` action to change it; a window setting alone would allow only a fixed preference, applied when the panel opens.

**Why it can't be worked around:** the window settings Alfred 6 accepts (`blur`, `movablebybackground`, `minsize`, `maxsize`, `borderless`, `closeable`, `minimisable`, `resizeable`, `fullscreenable`, `fullsizecontentview`, `frameautosave`, `titlevisibility`, `titlebarappearstransparent`, `toolbar`, and so on) have no window level, and the `window` action only resizes, zooms, minimises and deminiaturises. A window's level can only be set by the process that owns it, Alfred here; AppleScript and accessibility can bring the window to the front but can't keep it there.

## Alfred UI: change the minimum and maximum size of an open window

**Request:** let the `window` JSON Action set `minsize` and `maxsize` on an open window, as well as `resize`.

**Use case:** Now Playing has a portrait and a landscape layout, switched with a button in the panel, which replaces the content view and resizes the window with the `window` action. Each layout suits a different minimum and maximum (portrait tall and narrow, landscape wide and short), but the window keeps the ones it opened with until it's reopened. So both layouts share one minimum, small enough for either shape, and after a switch the previous layout's maximum stays in force, limiting how far the new layout can be resized. The maximum also matters because zoom can't be disabled (see below): it's the only way to stop the zoom button filling the screen.

**Why it can't be worked around:** Alfred 6 sets the window's minimum and maximum sizes only when it opens the window, and the `window` action's `resize` only sets the content size. The UI could close and reopen itself on a layout switch, but the panel would visibly disappear and reappear.

## Alfred UI: disable or hide the zoom and minimise buttons

**Request:** window settings that disable the zoom button on a resizeable window (for example `zoomable: false`), and that hide the minimise and zoom buttons rather than only disabling them.

**Use case:** Now Playing is a small panel with a transparent title bar, so only the window buttons show, at its top left. It's resizeable, but zooming it to fill the screen isn't useful, and `minimisable: false` leaves a grey dot.

**Why it can't be worked around:** AppKit enables the zoom button on any resizeable window, and Alfred UI has no setting for it or for hiding the buttons. A per-layout `maxsize` limits how far zoom grows the window, but that also limits resizing by hand. A borderless window has no buttons, but then no close button either.

## Alfred UI: an app name for the UI's process

**Request:** a top-level `ui.json` setting for the name the UI's process shows in ⌘-Tab and the Dock (for example `"name": "Now Playing"`), alongside the existing `iconpath`. The helper could apply it to itself at launch, for example with LaunchServices' display name (as Chromium does for its helper processes).

**Use case:** Now Playing ([`wip/now-playing`](wip/now-playing/README.md)) is a panel people switch to and from with ⌘-Tab. `iconpath` gives it its own icon there, but it's still labelled "Alfred UI", and every open Alfred UI from any workflow shares that name, so they can't be told apart by name.

**Why it can't be worked around:** each Alfred UI runs as a process of `Alfred UI.app`, and ⌘-Tab and the Dock show that bundle's name. The window's `title` names the window (window switchers such as AltTab can show it) and the app menu, but not the app. Only a process can change its own display name: setting it from another process with `_LSSetApplicationInformationItem` reports success but leaves the name unchanged, and editing the helper's `Info.plist` would break Alfred's code signature.
