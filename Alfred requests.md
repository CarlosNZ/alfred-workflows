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

## Alfred UI: several windows in one UI process

**Request:** a way for one running Alfred UI to show several windows. For example, an option on the Alfred UI workflow object (or in `ui.json`) so that launching a `.alfredui` that's already running, with the same `bundleid`, opens a new window in the running process instead of starting another process. Each window would keep its own variables, events and `frameautosave` name. Or a JSON Action that opens a new window from a window definition, with its own variables.

**Use case:** ScratchNotes ([`wip/scratchnotes`](wip/scratchnotes/DESIGN.md)) keeps quick notes as Markdown files and opens each in its own small window, like sticky notes, so several can be open around the desktop at once. Each window is a separate process, so each note is its own entry in ⌘-Tab and the Dock, instead of one ScratchNotes app with several windows. ⌘-\` can't cycle between the notes, ⌘H and ⌘Q act on one note rather than all of them, and every open note costs its own process (about 50 MB each, measured).

**Why it can't be worked around:** every launch of an Alfred UI, from the workflow object or otherwise, starts a new process of `Alfred UI.app`, and each process has exactly one window. Nothing in the UI JSON or the JSON Actions creates a second window: `sheet` is a modal overlay on the same window. Only a process can change how it's grouped and shown in ⌘-Tab and the Dock, and the helper is Alfred's signed app.

## Alfred UI: keep a UI out of ⌘-Tab and the Dock

**Request:** a top-level `ui.json` setting for the UI process's activation policy, for example `"activationpolicy": "accessory"` (`NSApplicationActivationPolicyAccessory`), so its windows can still be shown, clicked and typed in, but the process has no Dock icon and no ⌘-Tab entry. Standard editing shortcuts (⌘C, ⌘V, ⌘Z, ⌘A) in text components would need to keep working.

**Use case:** ScratchNotes ([`wip/scratchnotes`](wip/scratchnotes/DESIGN.md)) opens each note in its own window, and the notes are reached through the workflow's Alfred results, which bring an open note's window to the front. With several notes open, each one adds an entry to ⌘-Tab and an icon to the Dock (see the request above), so it would be better for them to have neither. It would also suit any small utility panel that isn't meant to be switched to like an app.

**Why it can't be worked around:** the activation policy can only be set by the process itself (`-[NSApplication setActivationPolicy:]`), and Alfred UI has no setting for it. Adding `LSUIElement` to the helper's `Info.plist` would break Alfred's code signature and affect every Alfred UI.

## Alfred UI: ⎋ back to the Script Filter results from a stacked view

**Request:** when an Alfred UI opened within Alfred with Stacking on comes from a Script Filter result (directly, or through objects such as a Run Script), ⎋ returns to that Script Filter's results, with the query and the selected item as they were. Failing that, let a view inside Alfred bind ⎋ in its `shortcuts`, or add a JSON Action that does the same, so the UI can go back itself.

**Use case:** World Clock ([`wip/world-clock-cities`](wip/world-clock-cities/README.md)) lists cities from a Script Filter, and ↩ on one opens its detail view inside Alfred, an Alfred UI with Stacking on. Looking at a city and going back to the list to look at the next is the natural way to use it, and ⎋ is the key people press to go back.

**Why it can't be worked around:** Stacking doesn't return to the results. With a Run Script between the Script Filter and the Alfred UI (which builds the UI's package), Alfred has closed the results by the time the view opens, and ⎋ hides Alfred. With the Alfred UI connected straight to the Script Filter, ⎋ does nothing. A `⎋` entry in the view's `shortcuts` never runs inside Alfred, which takes the key first. The workflow binds ⌫ instead, to a script that searches Alfred for the keyword and query again, but that's not the key people expect, and a new search selects the first result rather than the city they were on. The script also has to start the search in a process of its own: a `script` action that asks Alfred to search directly deadlocks, because Alfred waits for the action to end.

## Alfred UI: a transparent background for a web view

**Request:** let a `webkitview` have no background of its own, so that a page with a transparent background shows the window behind it, for example with `"background": null`, as for a `textarea` or `markdownarea`. The usual way is to turn off the web view's `drawsBackground` (`[webView setValue:@NO forKey:@"drawsBackground"]`).

**Use case:** ScratchNotes ([`wip/scratchnotes`](wip/scratchnotes/DESIGN.md#view-mode-in-a-web-view)) shows a note's View mode in a web view, so that Markdown renders fully and task boxes can be ticked. Its quick view opens inside Alfred's window and should look like the rest of Alfred, in the user's theme. A solid theme can be matched, by painting the page in the theme's colour (`alfred_theme_background`), but a translucent theme can only be imitated: the page is painted in the theme's colour over a dark or light base, and the whole web view faded to between 80% and 100% opacity, which fades its text too, while Alfred's blurred background barely shows through. A transparent web view would also have nothing to show before its page first draws, where it shows a dark or white fill for 130–200 ms, which the workflow has to hide by starting the web view at opacity 0 and showing it once the page has drawn.

**Why it can't be worked around:** WebKit paints an opaque fill under every page unless the web view's `drawsBackground` is turned off, which only the process that owns it can do. `AUIWebKitView` reads only `src`, `text` and `openlinksexternally`, and never turns it off: a transparent CSS background shows the fill, and `background` isn't read for a web view. A component's `opacity` makes the whole view translucent, text included.
