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

## Alfred UI: a pointer cursor for clickable components

**Request:** a component property that sets the mouse cursor shown over it (for example `"cursor": "pointinghand"`, matching `NSCursor.pointingHandCursor`), so clickable components can show the pointing hand, as links do in a browser.

**Use case:** Now Playing ([`wip/now-playing`](wip/now-playing/README.md)) shows the default media app's icon when nothing is playing, and clicking the icon opens the app. The playing app's icon and name in the panel's top row open it too. Nothing tells the user these are clickable: they look like plain images and text, and the cursor stays an arrow. A tooltip appears only after a pause.

**Why it can't be worked around:** Alfred UI has no cursor property and no hover event that could change the cursor or the component's look. In Alfred 6's framework the pointing-hand cursor is set only in Alfred's own windows (the workflow editor, the configuration sheet, the import window's website link); the only Alfred UI component that tracks the mouse is the data view, for its rows. A `webkitview` could set `cursor: pointer` in CSS, but replacing an image view with a web page just for the cursor is heavy and loses the native image view.

## Alfred UI: ⎋ back to the Script Filter results from a stacked view

**Request:** when an Alfred UI opened within Alfred with Stacking on comes from a Script Filter result (directly, or through objects such as a Run Script), ⎋ returns to that Script Filter's results, with the query and the selected item as they were. Failing that, let a view inside Alfred bind ⎋ in its `shortcuts`, or add a JSON Action that does the same, so the UI can go back itself.

**Use case:** World Clock ([`wip/world-clock-cities`](wip/world-clock-cities/README.md)) lists cities from a Script Filter, and ↩ on one opens its detail view inside Alfred, an Alfred UI with Stacking on. Looking at a city and going back to the list to look at the next is the natural way to use it, and ⎋ is the key people press to go back.

**Why it can't be worked around:** Stacking doesn't return to the results. With a Run Script between the Script Filter and the Alfred UI (which builds the UI's package), Alfred has closed the results by the time the view opens, and ⎋ hides Alfred. With the Alfred UI connected straight to the Script Filter, ⎋ does nothing. A `⎋` entry in the view's `shortcuts` never runs inside Alfred, which takes the key first. The workflow binds ⌫ instead, to a script that searches Alfred for the keyword and query again, but that's not the key people expect, and a new search selects the first result rather than the city they were on. The script also has to start the search in a process of its own: a `script` action that asks Alfred to search directly deadlocks, because Alfred waits for the action to end.
