# Window layout and controls

What's in a note's window, and how its controls work: the editor, the top row, keys, the drop-downs, collapsing, the actions menu, font sizes and a new sticky note's size. Part of Scratch'n'Stick's [developer notes](../../DEVELOPMENT.md). Preview's web view is in [Preview](view-mode.md); the pickers' colours and icons are in [Colours and icons](colours-and-icons.md).

## The window

One full-window `stack` (`ui/content.json`) holds both modes all the time: the web view (in a view of its own, `page`), the editor over it, the drop-downs and their catcher (hidden until opened), and, laid over the top, the top row's groups. A `stack` layers its components, so hidden ones take no room. Switching mode is an `update`, not a rebuild (see [Preview](view-mode.md#switching-mode)).

**Edit** is a `textarea`: editable, monospaced (`font` with `monospaced: true`) at the note's font size, `disableallsubstitutions` (no smart quotes or dashes in Markdown), and `focus`, which puts the caret at the end of the text.

**Preview** (called View in the code) is a `webkitview` rendering the note with markdown-it, whose task boxes can be ticked. "Preview" is its name wherever the user sees it, as "View" read oddly as something to switch to while the note is already in view, and Preview is the usual name for rendered Markdown.

**Which mode a window opens in**: a new or blank note opens in Edit. Others open in the mode their window was last in (the sidecar's `mode`, recorded on every switch and on closing), so a quick note only ever used in Edit stays in Edit. A note with no `mode`, never opened in a window (from another app), opens in Preview. A note stuck from its quick view keeps the view's mode.

**The two forms differ**:

| | Quick view | Sticky window |
|---|---|---|
| Size | 640×400, which Alfred uses as given | Opens at 360×288 (asked for 360×320: Alfred UI windows come out 32 pt short), resizable down to 220×160. A new sticky note may open bigger (see [A new sticky note's size](#a-new-sticky-notes-size)); a saved frame wins. |
| Look | Alfred's theme: the root view has no `background` or `appearance`, so text, buttons and menus match Alfred. Its only accent of the note's colour is the colour button's swatch. | The note's tint, behind the editor too (`textarea` `background: null`); root view `appearance: "light"`, so text, buttons, caret and menus keep the light look on the pale tint in dark mode too. |
| Frame | Part of Alfred's window | Borderless (`borderless`), with a `cornerradius` from the `sticky_corner_radius` setting (`stickyCornerRadius`, 10 by default, like the drop-downs), dragged by its background (`movablebybackground`) |
| Extras | Stick to the desktop button and ⌘D, key hints | Close button, ⌘W, Esc shortcut, collapsing, app icon and title in ⌘-Tab |

A sticky window has no title bar: with a transparent one, the traffic lights over a pale tint were all but invisible while the window wasn't active. Alfred UI can't hide individual traffic lights (only the window's own process can), so the window is borderless with a close button of its own, the workflow's button icon `close` (`dev/icons/close.svg`: a filled circle with an X cut out, so the tint shows through), 15 pt, centred 20 pt in and 16 pt down where a window's close button would be. It's in a group of its own (`windowbuttons`), so the customise group's replace actions don't touch it. Its action is a `finish`; tooltip "Close (⌘W)". A borderless window can still be key, resized from its edges, and saves its frame. The window title is the note's title, not shown but read by ⌘-Tab, the Dock and window switchers; it's set when the window opens and can't change while it's open.

**Dragging.** A web view refuses to drag its window, and it seems macOS leaves out the area of any view that refuses, whatever lies over it. So in both forms the page starts below a strip along the top (`titlestrip`, 32 pt), which drags the window: a sticky window through its root view's background, a quick view through Alfred's own window. In Preview the quick view's strip takes the page's colour, so strip and page look like one panel (see [Preview](view-mode.md#the-look)). In Edit the hidden web view is still under the editor's margins, so only the strip drags.

## The top row

A slim row of borderless buttons over the top of the note, in separate groups rather than one full-width row, since a view laid over the note takes its clicks:

- **customise** (`ui/customise.json`), at the left: the colour button, the icon button (not on macOS 12) and the Font size button, the note's own look. 44 pt in when sticky (after the close button), 12 pt in a quick view.
- **actions** (`ui/actions.json`), at the right, 42 pt in: the Edit / Preview toggle (`eye` in Edit, tooltip "Preview (⌘↩)"; `pencil` in Preview, "Edit (↩)") and, in a quick view only, Stick to the desktop (`sticky-note-plus`, "Stick to the desktop (⌘D)").
- **menubutton** (`ui/menubutton.json`), 10 pt in from the right: the actions menu's button (…), in a group of its own so it stays in a collapsed window.

Every button is a 22 pt box with its image centred, so the groups are the same height whatever they show, 5 pt down, putting the buttons' centres 16 pt down, where a window's traffic lights would be. Button icons are 18 pt, except two glyphs that look small at that size: Aa (`text-size`) at 19 pt and the eye at 20 pt (`buttonIconSizes`). The colour button's swatch is 16 pt; being a symbol, it sits on its font's baseline about 1 pt low, so the colour button is 2 pt shorter than its box and at the top of it (`colourbox`, `swatchRaise`).

Every size and position of the top row, the drop-downs, the key hints and the collapsed window is in one constant, `NOTE_WINDOW_LAYOUT` at the top of the note window code in `lib.js`, with a comment on each, to tune by hand. The templates take them as tokens. After changing a drop-down's size or shadow, run `dev/make-icons.js` to redraw its shadow, and update the sizes `dev/test-window.sh` expects.

## Keys

| Key | Does | Where |
|---|---|---|
| ↩ | Switch to Edit (Preview only) | Both forms |
| ⌘↩ | Save and switch to Preview ("submit"; does nothing in Preview) | Both |
| ⌘1–⌘6 | Set the note's colour | Both |
| ⌘I | Open or close the icon picker | Both (not macOS 12) |
| ⌘+ / ⌘− / ⌘0 | Bigger / smaller / default font size | Both |
| ⌘K | Actions menu | Both |
| ⌘⌫ | Move to Trash | Both |
| ⌘D | Stick to the desktop | Quick |
| ⌘W | Close | Sticky |
| Esc | Close an open drop-down, or the window | Sticky; in a quick view Alfred handles Esc itself and closes |

↩ and ⌘↩ follow Jupyter's Markdown cells (↩ to edit, ⇧↩ or ⌃↩ to render), and are the only keys for switching mode: the toggle button's tooltip and the actions menu's Edit / Preview item name them. The ↩ shortcut is on the `page` view that holds the web view, not the root, so it only runs while the focus is in Preview; in Edit, ↩ in the editor types a new line. Root view shortcuts run on the first press whether or not the page has focus. Inside Alfred, ⌘↩ and the ⌘ number keys reach the quick view rather than Alfred.

⌘W needs a shortcut, as a borderless window has no File › Close in the helper's menu bar. ⌘+ is three shortcuts, `⌘=`, `⇧⌘=` and `⌘+` (`NOTE_FONT_SIZE_SHORTCUTS`): on a US keyboard ⌘+ is ⌘= with or without ⇧, and `⌘+` covers keyboards with a + key of its own.

## Key hints

A quick view shows key hints at its bottom right, in 12 pt text in the buttons' grey: **Edit ↵** in Preview or **Preview ⌘↵** in Edit, a bullet, then **Actions ⌘K**. Word first, then key, as in Raycast's action bar. ⌘D and Esc are left to the actions menu, which lists them. Sticky windows have none: by the time a note is stuck, its keys are known.

- They're three labels in a narrow view of their own (`keyhints`, `ui/keyhints.json`), 8 pt up and 12 pt in, 6 pt either side of the bullet (`keyHints` in `NOTE_WINDOW_LAYOUT`). The editor's bottom inset in a quick view is 28 pt, and the page keeps a clear band at the bottom, so the text stays clear of them.
- A mode switch replaces them rather than updating their text, as Alfred UI doesn't re-measure a label when an `update` changes its text.
- Return is shown as ↵ (U+21B5) rather than ↩: in the system font ↩'s arrow is centred on the height of + and =, so beside ⌘ and text it looks as if it floats; ↵ sits near the baseline.
- Their colour is set as a hex colour and `opacity` (`noteButtonColour` in `lib.js`, the same grey `dev/make-icons.js` draws button icons in), not named: inside Alfred's window with a dark theme, `"colour": "secondaryLabelColor"` drew one label in the light appearance's grey and another in the dark's.

## Drop-downs

The icon button and the colour button each open a drop-down, a box of buttons laid over the top left of the note: the icon picker and the colour picker (their contents are in [Colours and icons](colours-and-icons.md)). Alfred UI has no popover component (its only pop-up, `popupmenu`, takes text items only), so each is a view in the content `stack`, built whole by `noteDropdown` in `lib.js` (`ui/content.json` has the token `@dropdowns` in their place), hidden until opened.

- **Look**: a box with `windowBackgroundColor`, a 10 pt corner radius and a 1 pt `separatorColor` border, over a drop shadow. Alfred UI has no shadow, so each is an image (`icons/shadow-<icon or colour>-picker.png`) drawn by `dev/make-icons.js` with AppKit's `NSShadow` (black at 30%, 6 pt blur, 2 pt down) around the box's rounded rectangle, then cleared inside, at 2x, and shown in an `imageview` behind the box with 8 pt around it to spread into. It's drawn for the box's exact size, so every button in a box has a fixed size (`noteDropdownGeometry` gives the sizes to both). A dark-mode look is [planned](planned.md#dark-appearance).
- **Sizes**: the icon picker's box is 314×178 pt (five rows of nine 30 pt buttons 4 pt apart, 6 pt padding), the colour picker's 172×37 pt (six 25 pt buttons 2 pt apart); both 8 pt in from the left and 32 pt down in a sticky window (34 pt in a quick view). With the shadow margin the icon picker takes 330×194 pt, which fits the quick view and a sticky window's default size, but not a sticky window at its minimum width (220 pt).
- **One at a time**: opening one closes the other. One closes on choosing from it, a second click on its button (or ⌘I again), a click anywhere else in the window, a mode switch, collapsing, and, in a sticky window, Esc, which otherwise closes the window. ⌘1–⌘6 still set the colour with a picker open.
- **The state**: the open picker's name is in `state/<id>.picker`, a file that exists while one is open, since the handler is zsh and can't easily rewrite JSON. The buttons, ⌘I, Esc and the catcher run `scripts/picker.sh`, a short zsh script (fast, as Alfred waits for it), which reads that file with a builtin and prints the right `update`, or a `finish` for Esc with none open. `launched` and `quit` remove the file.
- **A click anywhere else**: Alfred UI has no event for a click outside a view, so while a picker is open, the catcher (`pickercatcher`), an empty view filling the window under the pickers and the top row, takes a click anywhere else and runs `picker.sh close` on `mousedown`. The click goes no further, as with a menu, and the top row's buttons, above it, still work. Clicks in a picker's shadow margin neither close it nor reach the note.
- Choosing a colour or an icon runs `window.js colour` or `window.js icon`, which replace the customise group and the picker (built hidden), so the choice shows and the drop-down closes.

## Collapsing

A double-click on a sticky window's top strip collapses the window to that strip, and a second expands it again, as a double-click on the title bar does in Stickies. There's no button or shortcut (a button was tried and dropped), so the user guide needs to say so; the actions menu also has Collapse / Expand.

- **Where**: anywhere along the window's top 32 pt (`titlestrip`), around the top row's buttons, which take their own clicks; while collapsed, the whole window. The strip still drags the window: Alfred UI's views drag their window themselves, even with `mousedown` and `doubleclicked` events.
- **Collapsed**, the window is 32 pt tall (`collapsed.height` in `NOTE_WINDOW_LAYOUT`) and shows only the close button, the note's title in a 13 pt semibold label (cut off with "…", `linebreak: "truncatetail"`) and the actions menu's button. The note (`content`) and the customise and actions groups are hidden.
- **Expanding** shows them again, hides the title, puts the caret back in the editor in Edit, and restores the height the window had when it collapsed, so a note resized by hand comes back at its own size (288 pt, `collapsed.defaultHeight`, if it couldn't be measured).
- **While collapsed**, the mode switch (keys, and its menu item, greyed out) and the drop-downs do nothing; Esc, ⌘W and the close button close the window; ⌘1–⌘6 and the font size keys still work, with the customise group they replace built hidden. Collapsing closes an open drop-down, and saves the editor's text in Edit first.
- **Closed while collapsed**, a note opens collapsed the next time it's stuck, by any route. Its quick view is never collapsed.

How it's built: `window.js collapse` measures the window's height with CoreGraphics (`CGWindowListCopyWindowInfo` for the window's process, which needs no permission) and prints one response: an `update` hiding or showing the parts, a `replace` of the title (`ui/collapsedtitle.json`, re-laid out with the note's current title), and a `window` action's `resize` with only a `height`. A `resize` can go below the window's `minsize`, keeps its width, and keeps its top edge in place. Collapsed state is recorded in three places: the window's state (checked by the mode switch and `picker.sh`), the sidecar's `collapsed` (the height to expand to, so a reopened window opens collapsed), and the bundle's context (so parts built later are built hidden). The templates' `@collapsed` directive builds a window that opens collapsed that way from the start. AppKit saves the collapsed size of a window closed collapsed, so `launched` corrects it: a collapsed window gets the collapsed height, and one that isn't collapsed but opens shorter than its minimum (closed collapsed on another Mac, with the sidecar synced) gets the default height.

## The actions menu

A menu of the window's actions, in both forms, from the … button or ⌘K. The button and ⌘K run `window.js menu`, which prints a `popupmenu` built fresh for the window as it is (`noteActionsMenu` in `lib.js`). Each item runs the same action as its button or key.

The items, with their keys:

- Collapse or Expand (sticky), or Stick to Desktop (⌘D) (quick)
- Edit (↩) or Preview (⌘↩), whichever switches the mode; greyed out while collapsed
- Close (⌘W, or ⎋ in a quick view)
- Move to Trash (⌘⌫)
- Share…, Copy as Rich Text, Copy as Markdown Text; greyed out for a blank note

It drops down from just under the button, as a pull-down menu does: that's the convention for a ⌘K menu (macOS's More buttons, Raycast's Actions). Alfred UI opens a menu with its first item over the view it's given, so it opens at `menuanchor`, a 1 pt view just under the button's left edge (`menuAnchor` in `NOTE_WINDOW_LAYOUT`), and runs on past the window's edge, which menus can.

- **Close** in a quick view is a `finish` that sets `close_view`, since a quick view's `finish` carries on to the stick route, where `open.js` then opens nothing.
- **Move to Trash** (`window.js trash`) saves the editor's text in Edit, so the trashed note is the one on screen, trashes it through Finder (`store.trash`, so Put Back works and the sidecar stays) and closes the window. A blank or never-saved note is deleted outright instead. The window's state is marked `trashed` first, so its `quit` removes the state and bundles without saving the note back. It posts "Moved “\<title>” to the Trash" (`noteTrashedMessage`, shared with `trash.js`) through the `notify` External Trigger; a sticky window waits for that call to finish before it closes (the `wait` option of `postNotesNotification`), as macOS refuses an Apple event from a process that has quit (-1743), while a quick view must not wait on Alfred, so it doesn't. If Finder fails, the notification gives the reason (`noteTrashFailedMessage`) and the window stays open. ⌘⌫ is Finder's key for it; in Edit it takes the key from the editor, where it would delete to the start of the line, which is safe as the text is saved and the note can be put back.
- **Share…** (`window.js share`) saves in Edit, then opens macOS's share menu with the note's `.md` file. Alfred UI's `share` action shares only a file (see [Alfred UI](alfred-ui.md#share)), so services such as Notes, Mail and Messages attach the file; there's no sharing the text itself.
- **Copy as Rich Text** (`window.js copyrich`) puts the note on the clipboard rendered as Preview renders it, for pasting with its formatting into Notes, Mail or Pages: markdown-it and `ui/view.js`'s task rule run in the script (`noteRichHtml`), the HTML becomes rich text through `NSAttributedString`, and the clipboard gets the RTF, the HTML and the Markdown as plain text. Task boxes become ☐ and ☑, and the text is the system font at 13 pt. It takes about 0.7 s the first time, while macOS loads its HTML reader.
- **Copy as Markdown Text** (`window.js copytext`, `copyNoteAsMarkdownText`) puts the Markdown on the clipboard as plain text only, so it pastes as source everywhere. It saves in Edit first, too.

There's no Minimise: a borderless window can't be minimised (⌘M beeps, and Alfred UI's `minimise` does nothing). Each sticky note is its own app, so ⌘H hides it, which does much the same.

## Font size

A note can have its own font size, in its sidecar (`fontSize`); without one it takes the `font_size` setting (11–20 pt, default 14), which is the menu's Default. A size that isn't a number is ignored, and one outside the menu's range is brought within it.

- The sizes are `NOTE_FONT_SIZES` at the top of `lib.js`, a plain list to tune by hand (10–14, 16–24 in twos, 28–36 in fours, 48, 64, 72, 96), in any order; anything that isn't a whole number is left out.
- **The menu**: the Font size button, after the colour and icon buttons, with the workflow's own `text-size` button icon (`dev/icons/text-size.svg`, a large and a small A in Lucide's style, as Lucide's `a-large-small` showed too little difference), pops up a text menu (`noteFontSizeMenu`): "Default (14 pt)", a separator, then the sizes, with ✓ on the size shown, and on Default too when the note has no size of its own. Tooltip "Font size (⌘+, ⌘−)".
- **The keys**: ⌘+ and ⌘− step to the next size in the list from the size shown, staying put at either end; ⌘0 goes back to Default.
- Both run `window.js fontsize <size|bigger|smaller|default>`, which records the size (removing the key for Default) in the sidecar and the context, then prints an `update` of the editor's `font` and a `replace` of the customise group, so the menu ticks the new size. Updating a `textarea`'s font keeps its text, selection and undo history, and works while it's hidden. In Preview it reloads the page with the new size. It closes an open picker, and prints nothing when nothing changes.
- The page's size comes from `note.js` (`window.NOTE_FONT_SIZE`), set as the `--font-size` CSS variable by `showNoteLook` in `ui/view.js`. Headings, code and task boxes (`0.9em`) are sized in `em`, so they follow it.

## A new sticky note's size

A new sticky note (`newsticky`, ⌘↩ on New note, the New sticky note Universal Action) opens at a size fitted to its starting text, so pasted or sent text shows without scrolling where it can. It only grows: text that fits 360×288 keeps that size, so a note started from a heading opens at the usual size. Notes stuck for the first time, and quick views, keep their fixed sizes; a window with a saved frame opens at that instead.

- **Shape**: long text widens the window until it's no taller than it's wide (`NOTE_SHAPE` 1, square; more allows taller), then makes it taller. It widens only while that makes it shorter, so a list of short lines just gets taller. Fenced code and table lines aren't meant to wrap, so the window is at least as wide as the longest of them.
- **Caps**: at most 40% of the screen's width and 800 pt (`NOTE_MAX_WIDTH_FRACTION`, `NOTE_MAX_WIDTH`), and 70% of its height (`NOTE_MAX_HEIGHT_FRACTION`), on the main screen, where AppKit centres a window with no saved frame. Longer text scrolls; with always-shown scroll bars the window is widened by the scroll bar so lines don't wrap.
- **Measuring**: the editor is monospaced, so text is measured by counting: a character's width and a line's height from AppKit at the editor's font and size, wrapping at spaces and after hyphens, breaking a word too long for a line anywhere, wide (CJK) characters and emoji at their own widths, also from AppKit, and a tab as 28 pt (`TAB_STOP`, NSParagraphStyle's default). Only the first 20,000 characters are measured (`MEASURED_LENGTH`), more than fills the largest window.
- **Calibration**: the text sits 5 pt inside the editor's frame on each side (the text view's line fragment padding) and 0 above and below; the window is asked for 32 pt more height than the content needs, as it comes out that much short.

`fittedNoteSize` in `scripts/text-rules.js` does the measuring and shaping, with its tuning at the top of the file; it's pure, given the font's measures, the insets, the usual size and the screen. `newStickyWindowSize` in `lib.js` gathers those (the editor's insets from `ui/content.json`, plus `stickySize` in `NOTE_WINDOW_LAYOUT`) and `open.js` writes the result as the bundle's `window.size`.
