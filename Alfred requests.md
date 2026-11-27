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

## Alfred UI: an app icon that follows the icon style

**Request:** let `ui.json` give an app icon for each appearance, and have the helper apply the right one at launch and again whenever the effective appearance changes. For example, `iconpath` could also take an object, `"iconpath": { "light": "appicon.png", "dark": "appicon-dark.png" }`, with each path resolved as a plain `iconpath` is. The helper already has most of the code: it would observe `NSApp.effectiveAppearance` and run what `setupIcon` does (load the image and call `-[NSApplication setApplicationIconImage:]`) with the path for the new appearance. Better still, accept an asset catalog (a compiled `Assets.car`, or an Icon Composer `.icon` document) so the system draws the icon in every style, including Clear and Tinted, as it does for apps' own icons.

**Use case:** Now Playing ([`release/now-playing`](release/now-playing/DEVELOPMENT.md#app-icon-and-name)), World Clock ([`release/world-clock-cities`](release/world-clock-cities/DEVELOPMENT.md)) and Scratch'n'Stick ([`wip/scratch-n-stick`](wip/scratch-n-stick/dev/docs/colours-and-icons.md)) give their windows app icons with `iconpath`, so they can be told apart in ⌘-Tab and the Dock. With the icon style set to Dark (or to Automatic in Dark mode, which follows the Mac from light to dark at sunset), every app's icon is drawn dark except these, which stay light. These windows are long-lived (a panel, sticky notes), so even choosing the icon for the current appearance at launch would be wrong after the next switch.

**Why it can't be worked around:** the helper sets its app icon once, in `setupIcon`, which it calls only at launch, after building the window; nothing in the `update`, `replace` or `window` actions calls it again, and overwriting the file at `iconpath` changes nothing, as the image is already loaded. Tested on macOS 27 with Alfred 6.0.3: an `iconpath` SVG whose CSS uses `@media (prefers-color-scheme: dark)` shows its light version in Dark mode (macOS's SVG renderer ignores the query), and the icon in ⌘-Tab didn't change across switches between Light and Dark mode. A process's app icon can only be set by the process itself, and a UI's scripts run as separate processes. Apps' own icons follow the style because the Dock draws them from the app bundle's asset catalog, and the helper's bundle is Alfred's, which a workflow can't change without breaking its code signature.

## Alfred UI: a pointer cursor for clickable components

**Request:** a component property that sets the mouse cursor shown over it (for example `"cursor": "pointinghand"`, matching `NSCursor.pointingHandCursor`), so clickable components can show the pointing hand, as links do in a browser.

**Use case:** Now Playing ([`wip/now-playing`](wip/now-playing/README.md)) shows the default media app's icon when nothing is playing, and clicking the icon opens the app. The playing app's icon and name in the panel's top row open it too. Nothing tells the user these are clickable: they look like plain images and text, and the cursor stays an arrow. A tooltip appears only after a pause.

**Why it can't be worked around:** Alfred UI has no cursor property and no hover event that could change the cursor or the component's look. In Alfred 6's framework the pointing-hand cursor is set only in Alfred's own windows (the workflow editor, the configuration sheet, the import window's website link); the only Alfred UI component that tracks the mouse is the data view, for its rows. A `webkitview` could set `cursor: pointer` in CSS, but replacing an image view with a web page just for the cursor is heavy and loses the native image view.

## Alfred UI: several windows in one UI process

**Request:** a way for one running Alfred UI to show several windows. For example, an option on the Alfred UI workflow object (or in `ui.json`) so that launching a `.alfredui` that's already running, with the same `bundleid`, opens a new window in the running process instead of starting another process. Each window would keep its own variables, events and `frameautosave` name. Or a JSON Action that opens a new window from a window definition, with its own variables.

**Use case:** ScratchNotes ([`wip/scratch-n-stick`](wip/scratch-n-stick/DEVELOPMENT.md)) keeps quick notes as Markdown files and opens each in its own small window, like sticky notes, so several can be open around the desktop at once. Each window is a separate process, so each note is its own entry in ⌘-Tab and the Dock, instead of one ScratchNotes app with several windows. ⌘-\` can't cycle between the notes, ⌘H and ⌘Q act on one note rather than all of them, and every open note costs its own process (about 50 MB each, measured).

**Why it can't be worked around:** every launch of an Alfred UI, from the workflow object or otherwise, starts a new process of `Alfred UI.app`, and each process has exactly one window. Nothing in the UI JSON or the JSON Actions creates a second window: `sheet` is a modal overlay on the same window. Only a process can change how it's grouped and shown in ⌘-Tab and the Dock, and the helper is Alfred's signed app.

## Alfred UI: keep a UI out of ⌘-Tab and the Dock

**Request:** a top-level `ui.json` setting for the UI process's activation policy, for example `"activationpolicy": "accessory"` (`NSApplicationActivationPolicyAccessory`), so its windows can still be shown, clicked and typed in, but the process has no Dock icon and no ⌘-Tab entry. Standard editing shortcuts (⌘C, ⌘V, ⌘Z, ⌘A) in text components would need to keep working.

**Use case:** ScratchNotes ([`wip/scratch-n-stick`](wip/scratch-n-stick/DEVELOPMENT.md)) opens each note in its own window, and the notes are reached through the workflow's Alfred results, which bring an open note's window to the front. With several notes open, each one adds an entry to ⌘-Tab and an icon to the Dock (see the request above), so it would be better for them to have neither. It would also suit any small utility panel that isn't meant to be switched to like an app.

**Why it can't be worked around:** the activation policy can only be set by the process itself (`-[NSApplication setActivationPolicy:]`), and Alfred UI has no setting for it. Adding `LSUIElement` to the helper's `Info.plist` would break Alfred's code signature and affect every Alfred UI.

## Alfred UI: ⎋ back to the Script Filter results from a stacked view

**Request:** when an Alfred UI opened within Alfred with Stacking on comes from a Script Filter result (directly, or through objects such as a Run Script), ⎋ returns to that Script Filter's results, with the query and the selected item as they were. Failing that, let a view inside Alfred bind ⎋ in its `shortcuts`, or add a JSON Action that does the same, so the UI can go back itself.

**Use case:** World Clock ([`wip/world-clock-cities`](wip/world-clock-cities/README.md)) lists cities from a Script Filter, and ↩ on one opens its detail view inside Alfred, an Alfred UI with Stacking on. Looking at a city and going back to the list to look at the next is the natural way to use it, and ⎋ is the key people press to go back.

**Why it can't be worked around:** Stacking doesn't return to the results. With a Run Script between the Script Filter and the Alfred UI (which builds the UI's package), Alfred has closed the results by the time the view opens, and ⎋ hides Alfred. With the Alfred UI connected straight to the Script Filter, ⎋ does nothing. A `⎋` entry in the view's `shortcuts` never runs inside Alfred, which takes the key first. The workflow binds ⌫ instead, to a script that searches Alfred for the keyword and query again, but that's not the key people expect, and a new search selects the first result rather than the city they were on. The script also has to start the search in a process of its own: a `script` action that asks Alfred to search directly deadlocks, because Alfred waits for the action to end.

## Alfred UI: a transparent background for a web view

**Request:** let a `webkitview` have no background of its own, so that a page with a transparent background shows the window behind it, for example with `"background": null`, as for a `textarea` or `markdownarea`. The usual way is to turn off the web view's `drawsBackground` (`[webView setValue:@NO forKey:@"drawsBackground"]`).

**Use case:** ScratchNotes ([`wip/scratch-n-stick`](wip/scratch-n-stick/dev/docs/view-mode.md)) shows a note's View mode in a web view, so that Markdown renders fully and task boxes can be ticked. Its quick view opens inside Alfred's window and should look like the rest of Alfred, in the user's theme. A solid theme can be matched, by painting the page in the theme's colour (`alfred_theme_background`), but a translucent theme can only be imitated: the page is painted in the theme's colour over a dark or light base, and the whole web view faded to between 80% and 100% opacity, which fades its text too, while Alfred's blurred background barely shows through. A transparent web view would also have nothing to show before its page first draws, where it shows a dark or white fill for 130–200 ms, which the workflow has to hide by starting the web view at opacity 0 and showing it once the page has drawn.

**Why it can't be worked around:** WebKit paints an opaque fill under every page unless the web view's `drawsBackground` is turned off, which only the process that owns it can do. `AUIWebKitView` reads only `src`, `text` and `openlinksexternally`, and never turns it off: a transparent CSS background shows the fill, and `background` isn't read for a web view. A component's `opacity` makes the whole view translucent, text included.

## Alfred UI: reopen a window on the screen it was saved on

**Request:** when a window with `frameautosave` opens, put it back at its saved frame whenever the screen it was saved on is still connected, rather than leaving it to AppKit's `setFrameUsingName:`. Failing that, let the `window` JSON Action set an open window's position (for example `"move": { "x": …, "y": … }` beside `resize`), so a workflow can do it.

**Use case:** Scratch'n'Stick ([`wip/scratch-n-stick`](wip/scratch-n-stick/dev/docs/windows.md#window-positions)) opens each note as a sticky window, with its own bundle path so each note keeps its own saved position. On a Mac with several displays, a note left on one display reopens on whichever display is active, so notes kept on a side monitor keep turning up on the laptop.

**Why it can't be worked around:** AppKit saves the frame with the screen it was on, but `setFrameUsingName:` only restores the saved frame on the screen the window opens on, the active one; a frame saved on another screen is moved to the same relative place on the active screen, and saved over the old one. A saved frame that names the active screen but has coordinates on another is pulled back onto a visible screen too. Alfred UI has no position setting, and its `window` action can't move a window. Scratch'n'Stick moves the window back once it's open, through the Accessibility API, from a script Alfred starts (the window's own scripts don't have the permission): it works, but the window shows on the wrong screen for a moment first, and needs Alfred to have Accessibility permission. Alfred UI could do it with no jump, before showing the window.

## Alfred UI: don't show an error when macOS reopens a UI at login

**Request:** when macOS relaunches `Alfred UI.app` at login (with "Reopen windows when logging back in" on), have the helper reopen the UI it was showing, or else quit silently. To reopen it, the helper would save its bundle path, for example with AppKit's state restoration or in a file of Alfred's, and open that bundle when it's launched with no bundle argument. To quit silently, it would call `-[NSApplication disableRelaunchOnLogin]` at launch so macOS doesn't relaunch it at all, or quit without a message when it's launched with no bundle. Reopening could be a `ui.json` setting (for example `"reopenatlogin": true`), as not every UI should come back.

**Use case:** Scratch'n'Stick ([`wip/scratch-n-stick`](wip/scratch-n-stick/dev/docs/windows.md)) sticks notes to the desktop as externally launched Alfred UI windows, which people leave open the way they leave sticky notes up. After a restart, each one comes back as an Alfred UI error instead of the note. A note people stuck to the desktop should still be there after a restart; failing that, it should go without an error. The same happens with any externally launched UI that's open at logout, such as Now Playing's panel ([`wip/now-playing`](wip/now-playing/README.md)).

**Why it can't be worked around:** at logout macOS records each running app so it can relaunch it, but not the arguments it was launched with, so the helper comes back without its bundle. Only the helper's own process can stay off that list (`disableRelaunchOnLogin`). The workflow's scripts run as separate processes, and the helper is Alfred's signed app, so the workflow can't change it either. A window's `quit` script runs during logout, but removing the helper from macOS's relaunch list there would mean editing loginwindow's preferences (`TALAppsToRelaunchAtLogin`, in a file whose location varies between macOS versions) on undocumented timing. The workflow can record which notes were open and reopen them the next time it's used, but it can't stop the error, and Alfred has no trigger that runs at login to reopen them sooner.

## Alfred UI: forget the saved frames of bundles that are gone

**Request:** a way for saved window frames to be removed once they're no longer needed. Any one of these would do: Alfred UI removes the saved frame of a bundle path that no longer exists (when it next launches, say, or when Alfred removes a workflow); a `window` JSON Action that forgets the open window's saved frame (`-[NSWindow saveFrameUsingName:]`'s counterpart, `+[NSWindow removeFrameUsingName:]`); or a string `frameautosave` used as the autosave name, so a workflow can choose names it can reuse rather than one per path.

**Use case:** Scratch'n'Stick ([`wip/scratch-n-stick`](wip/scratch-n-stick/dev/docs/windows.md#window-positions)) opens each note's sticky window from a bundle of its own, so each note keeps its own saved position. Every note ever stuck leaves an `NSWindow Frame …` key in the `com.runningwithcrayons.Alfred-UI` defaults, which stays after the note and its bundle are deleted: about 140 on a development Mac after a few weeks. A note whose ID comes back (an example note added again) also opens at the old note's frame, not the size the workflow asks for. Now Playing ([`wip/now-playing`](wip/now-playing/README.md)) leaves one for each path its bundle has had.

**Why it can't be worked around:** `removeFrameUsingName:` only removes a frame from the calling process's own defaults, so only Alfred UI can call it. A string `frameautosave` isn't used as a name: the key is always the bundle's file name and the SHA-1 of its standardised path. Scratch'n'Stick removes its own leftover frames from outside, in a daily sweep that deletes the keys whose hash matches a bundle path it no longer has, through `NSUserDefaults` on Alfred UI's domain. That works, but it means a workflow writing to Alfred UI's preferences and relying on the undocumented key format, which could change in any release.
