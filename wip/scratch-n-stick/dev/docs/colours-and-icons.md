# Colours and icons

A note's colour and icon, the images the workflow uses, and how they're made. Part of Scratch'n'Stick's [developer notes](../../DEVELOPMENT.md).

## The palette

Each note has one of six colours, stored by slot in its sidecar (`"colour": 2`), so a slot's colours can change without rewriting notes. A note without one takes the `default_colour` setting's slot. A value that isn't a slot gets the default colour, and the sidecar keeps it until a colour is chosen.

A colour has two shades:

- the **tint**: a sticky window's background (and its page's), and the fill of the note's badge and dot in the results;
- the **control** colour: the colour button's swatch, the colour picker's swatches, and the ring around a badge or dot.

The default palette is Stickies' six colours, read from its asset catalogue (`/System/Applications/Stickies.app/Contents/Resources/Assets.car`, with `assetutil --info`). Dark text (`#1D1D1F`) on the tints has a contrast of 10–15:1.

| Slot | Name | Tint | Control |
|---|---|---|---|
| 1 (default) | Yellow | `#FEF49C` | `#DBC503` |
| 2 | Blue | `#ADF4FF` | `#24D0E9` |
| 3 | Green | `#B2FFA1` | `#51BB51` |
| 4 | Pink | `#FFC7C7` | `#F87F7F` |
| 5 | Purple | `#B6CAFF` | `#7D9BEB` |
| 6 | Grey | `#EEEEEE` | `#A8A8A8` |

A free choice of colour per note isn't offered: Alfred UI has no colour well, and arbitrary colours would need tints worked out to stay readable.

### Custom colours

Each slot is a User Configuration text field, `colour_1` to `colour_6`, holding a name and one or two hex colours in any order: the tint, then the control colour (`Yellow #FEF49C #DBC503`). Their defaults are the default palette, which `dev/test-list.sh` checks against `NOTE_PALETTE_DEFAULTS` in `lib.js`. Alfred's User Configuration has no colour picker.

- A hex colour is `#RRGGBB` or `#RGB`, either case, and the `#` can be left off six digits (so a six-letter name made of A–F, such as "Facade", is taken for a colour). Commas between words are allowed. Colours are kept as `#RRGGBB` in capitals.
- A slot without a name is "Colour \<slot>"; an empty field takes its slot's default.
- With one colour, it's the tint, and the control colour is worked out (`noteControlColour`): the tint's hue, twice as saturated and 10% darker, then darker still until it has at least 2:1 contrast with white. Stickies' own pairs follow no single rule, so this only gives similar colours (yellow's tint gives `#C9B92E` against Stickies' `#DBC503`).
- The Default colour popup lists "Colour 1 (Yellow)" to "Colour 6 (Grey)": a popup's labels are fixed in `info.plist`, so they can't follow a renamed slot.
- **A slot that can't be read** (no hex colour, more than two, or a `#` word that isn't a hex colour) replaces the results of both Script Filters with one result per bad slot, "Colour 3 isn't valid", with what's wrong and "Fix it in the workflow's Configuration." They can't be actioned (opening the Configuration from ↩ would need a route of its own, as ↩ goes straight to the quick view). `open.js` opens nothing and posts a notification saying what's wrong.
- The palette is parsed on each run (`notePalette`, once per process), not cached: parsing six short strings is quicker than reading a file. Window scripts don't get User Configuration, so the palette goes into each bundle's `context.json` and the quick bundles' fingerprint; an open sticky window keeps the palette it opened with.
- A slot's name is user text, so it's escaped for Alfred UI (`escapeForAlfredUi`) in the colour picker's tooltips and accessibility labels.

Functions: `notePalette()` (throws if a slot can't be read), `notePaletteProblems()`, `notePaletteProblemItems()`, `noteDefaultPalette()`, `parseNotePaletteSlot`, `noteControlColour`, `notePaletteColour(palette, slot)`, `noteColour(meta)`, `noteColourIn`, `noteDefaultColour`, `noteContextColour(context)`. A colour is `{ slot, label, tint, control }`.

### Colour in the window

- **Sticky**: the root view's `background` is the tint and the editor's is `null`, so the whole window is tinted like a sticky note; Preview's page has the tint as its background. The root view's `appearance: "light"` keeps text, buttons, caret and selection in their light look, so a note looks the same in light and dark mode, like Apple's Stickies; without it, dark mode gives white text on the pale tint. (A view's `appearance` applies to everything inside it; only the title bar follows the window's.)
- **Quick view**: not tinted. It takes Alfred's theme, and its only accent is the colour button's swatch. A stripe of the note's colour down the left edge, and a coloured top row, both looked wrong.

Dark-appearance variants of the palette are [planned](planned.md#dark-appearance).

### The colour button and picker

The colour button, first in the top row's customise group, is a borderless `circle.fill` symbol in the note's control colour (the colour swatch), which opens the colour picker, a drop-down (see [Drop-downs](window-ui.md#drop-downs)): the six swatches in a row (`circle.fill` in each control colour, font size 14), each with its name and key as its tooltip ("Blue (⌘2)"). The note's colour is marked by a rounded grey background behind its swatch (a 25 pt view, `unemphasizedSelectedContentBackgroundColor`, corner radius 5), which matches the icon picker's bezel in both appearances: a bordered button doesn't tint its symbol, so a bezel can't mark it.

⌘1 to ⌘6 set the colours directly, in that order, as in Stickies; the colour button's tooltip is "Colour (⌘1–⌘6)".

A colour's button and key run `window.js colour <slot>`, which writes the sidecar and the context, then replaces the customise group (so the swatch follows) and the colour picker (built hidden, so choosing closes it). In a sticky window the action first sends an `update` of the root view's `background`, so the tint changes at once, and in Preview the script also reloads the page with the new tint.

There's no right-click colour menu: the editor and the web view keep their own menus, so it would only work in the margins.

## Note icons

A note can have an icon, chosen from 44, or none (the default). The icon shows on its result (its badge, in place of the colour dot) and in its window's icon button.

The icons are from [Lucide](https://lucide.dev) (ISC, plus Feather's MIT for a few icons; its `LICENSE` ships in `icons/lucide/`): outline SVGs, 2 pt strokes on a 24 pt grid, drawn with `stroke="currentColor"`. SF Symbols can't be used: a Script Filter's icon must be a file, and Apple's licence doesn't allow shipping symbols as images.

The set (`NOTE_ICONS` in `lib.js`), in picker order with the label used for its tooltip and accessibility label; with None first they fill the picker's 9×5 grid, one theme to a row:

1. Notes and work: `sticky-note` (Note), `list-todo` (To-do), `lightbulb` (Idea), `question-mark` (Question), `triangle-exclamation-point` (Important), `briefcase` (Work), `building-2` (Office), `laptop` (Computer)
2. Time and contact: `calendar` (Calendar), `alarm-clock` (Reminder), `sun` (Sun), `moon` (Moon), `phone` (Call), `mail` (Mail), `message-circle` (Message), `user-group` (People), `person-standing` (Person)
3. Home and life: `house` (Home), `utensils` (Food), `coffee` (Coffee), `shopping-cart` (Shopping), `circle-dollar-sign` (Money), `gift` (Gift), `paw-print` (Pets), `sprout` (Garden), `wrench` (Fixes)
4. Learning, leisure and health: `graduation-cap` (Learning), `book-open` (Reading), `link` (Links), `music` (Music), `camera` (Photo), `gamepad-2` (Games), `stethoscope` (Health), `activity` (Fitness), `volleyball` (Sport)
5. Out and about, and markers: `plane` (Travel), `car` (Car), `bike` (Cycling), `sailboat` (Sailing), `parasol` (Beach), `tent-tree` (Camping), `heart` (Heart), `star` (Star), `flag` (Flag)

Lucide has no running figure, soccer ball, family or double exclamation mark, so `activity`, `volleyball`, `user-group` and `triangle-exclamation-point` stand in. It has no filled variants; Phosphor and Tabler (MIT) do, but the window's buttons would have to change with them.

**The sidecar** holds the icon's name (`"icon": "shopping-cart"`); choosing None removes the key. A name not in the set (from another version) shows as no icon and is kept until another is chosen.

**The icon button**, after the colour button, shows the note's icon as a button icon, or `square-dashed-plus` (an empty slot to add an icon to) for a note without one. Tooltip "Icon (⌘I)".

**The icon picker** is a drop-down (see [Drop-downs](window-ui.md#drop-downs)) of None (`square-dashed`, tooltip "No icon") and the 44 icons, in five rows of nine, as 22 pt button icons in 30 pt buttons. The current choice is a bordered button, so its bezel marks it. Choosing runs `window.js icon <name>` or `window.js icon none`, which records it in the sidecar and context, and replaces the customise group and the picker. A colour change leaves the picker alone, as its icons don't depend on the colour.

Functions: `NOTE_ICONS`, `noteIcons()` (`{ name, label }` in grid order), `noteIconByName(name)`, `noteIcon(meta)` (the note's icon or null, and always null on macOS 12), `noteIconsSupported()`.

## The images

The workflow's images, with the names used for them in code (named for what they look like, not where they're used):

| Name | What it is | Format | Where it comes from | Used for | In code |
|---|---|---|---|---|---|
| **Lucide sources** | Lucide's original icons: the 44 note icons plus `eye`, `pencil`, `sticky-note-plus`, `square-dashed-plus`, `square-dashed`, `ellipsis`, drawn in black | SVG | `dev/lucide/`, development only | Making the button icons | `lucide` |
| **Button icons** (light and dark) | Every icon in the window, in the buttons' grey (`secondaryLabelColor`) for each appearance | SVG | `icons/lucide/<name>-<light or dark>.svg`, shipped, made by `dev/make-icons.js` | Every image button in the window | `noteButtonIconFile(name, appearance)`, token `@buttonIcon:<name>` |
| **Colour swatches** | The SF Symbol `circle.fill` tinted with a control colour | No file | Built into the window | The colour button and colour picker | token `@swatch` |
| **Badges** (result icons) | A note's icon in `#1D1D1F` on a rounded square of its tint, ringed in its control colour | SVG | Made at run time into the cache (macOS 13 and later) | Results of notes with an icon | `noteBadgeFile(workflowFolder, icon, colour)` |
| **Dots** (result icons) | A circle of the note's tint, ringed in its control colour | PNG (so macOS 12 can show it) | Made at run time into the cache | Results of notes without an icon | `noteDotFile(colour)` |
| **Shadows** | The drop shadows behind the drop-downs | PNG | `icons/shadow-<icon or colour>-picker.png`, shipped, made by `dev/make-icons.js` | The icon and colour pickers | `noteDropdownShadowFile(name)` |

Also:

- **Result icons**: a note's result shows its badge, or its dot if it has no icon (or on macOS 12): `noteResultIcon`.
- **App icon**: every sticky window's app icon is the workflow's, `ui/appicon.png` (see [The workflow's own images](#the-workflows-own-images)), not one in the note's colour or with its icon. The Alfred UI helper sets its app icon once, at launch, and nothing changes it afterwards, so an icon of the note's own would be out of date as soon as its colour or icon changed, and would never follow a change of appearance either (an SVG's `prefers-color-scheme` is ignored too).
- **New note's icons**, `icons/note.png` and `icons/slate.png` (see [Results and new notes](results.md#the-results-list)), and the workflow's icon, are drawn by hand; see [The workflow's own images](#the-workflows-own-images).
- `dev/icons/` holds the workflow's own button icons in Lucide's style, `close.svg` and `text-size.svg`, which `make-icons.js` treats like Lucide's.

**Every icon in the window is a button icon**, drawn the same way, so they all match in style and colour, apart from the colour swatches, which are coloured symbols. With SF Symbols for the actions and a file for the note's icon, any mismatch in the worked-out appearance showed as a dark icon beside light symbols. `NOTE_WINDOW_BUTTON_ICONS` in `lib.js` lists the window's other icons, each with the SF Symbol used in its place on macOS 12.

**Which appearance**: a sticky window is always light (its root view's `appearance`), so it uses the `-light` button icons. A quick view takes Alfred's theme, so it uses the appearance Alfred gives its window (`noteQuickAppearance`, worked out once per run by `list.js` and `new.js`, and recorded as `appearance` in the context; `open.js quick`, run without a theme, uses `-light`). The rule: a theme's `appearanceMode` (in its `theme.json`'s `alfredtheme` object, beside `window`, not in it: `$alfred_preferences/themes/$alfred_theme/theme.json`) of 2 is dark and 1 light; otherwise the theme's background colour (`alfred_theme_background`) is dark when its luminance is below half. Most themes have no `appearanceMode`, but the colour alone would get some wrong (Spotlight Golden Gate Dark's is white at 4%). It matches what Alfred does with a light and a dark theme.

### How they're drawn

Button icons are Lucide's elements with `currentColor` given a colour, the button grey at its alpha (black at 49.8% in light, white at 54.9% in dark, read from `secondaryLabelColor` on macOS 27). The opacity is on a group (`<g opacity>`), not the strokes, so overlapping strokes aren't darker, as with a symbol in a translucent colour. NSImage reads SVG in JXA and draws `currentColor` in black unless a `color` attribute sets it.

A badge is SVG text: the light button icon's elements in `#1D1D1F`, as a nested `<svg>` with its own `viewBox`, over a rounded square of the tint ringed in the control colour (`NOTE_BADGE_STYLE`). It takes microseconds. A dot is a PNG drawn with AppKit, a filled circle with a ring (`NOTE_DOT_STYLE`), which works on macOS 12; AppKit is loaded only when a dot is drawn. It isn't drawn from the SF Symbol, whose licence doesn't allow it.

A file image in Alfred UI can't be tinted (`template` and `contenttintcolour` only work on symbols) or follow the appearance, so every colour an icon is shown in is drawn ahead (see [Alfred UI](alfred-ui.md#images)).

### What ships and what's made on demand

Whatever doesn't depend on the palette ships; only what does is made at run time. So the button icons and shadows ship, made by `dev/make-icons.js`, and badges and dots are made when needed into `$alfred_workflow_cache/icons/`. Two reasons: the palette can be customised, which images drawn ahead of time can't follow, and macOS 12 can't read SVG, so no SVG may reach a window there. Badges are made from the shipped light button icons (one set can't be made from another with `<use>`: NSImage draws nothing for a `<use>` into another file), so only two sets of Lucide icons ship.

- **Made when named**: `noteBadgeFile` and `noteDotFile` return the file's path, making it first (atomically) if it's missing. Only results name them (`list.js`, for each result's icon); windows name none. Each process checks a file on disk once, so a list of 300 notes takes no longer. A result icon that can't be made leaves the result without an icon, with the error in Alfred's debugger (`attempt` in `list.js`).
- **Names** say everything a file is made from, so a change gets new files rather than stale ones: the kind, the icon, the colours, the Lucide version and a short hash of the drawing function's own source (`toString()`), e.g. `badge-heart-FEF49C-DBC503-1.80.0-k3j9x.svg`. So changing the drawing code needs no version bump. The Lucide version is `LUCIDE_VERSION` in `lib.js`, which `dev/test-list.sh` checks against `dev/lucide/VERSION`.
- **Sweeping**: a run that makes a new badge or dot then deletes those in the cache whose names aren't current, and temporary files a stopped run left. Nothing can name a deleted file: windows name only shipped images, and results name their icons afresh each run.
- **Missing images**: a `file` image that doesn't exist, or isn't an image, shows as a blank button; a missing `iconpath` is ignored. Only on macOS 12, where an image that can't be read makes Alfred UI reject the whole window, is a missing image worse.

### macOS 12

macOS 12's NSImage can't read SVG, and an unreadable image makes Alfred UI reject the window ("Invalid Alfred UI…"; a quick view crashed Alfred). So on macOS 12 there are no note icons:

- The icon button, the icon picker and ⌘I are left out of the window (the templates' `"@needs": "icons"`). `picker.sh` still names `iconpicker` in its updates, which is harmless: Alfred UI ignores unknown ids in an `update`.
- Results show dots.
- The action buttons are SF Symbols: `@buttonIcon:<name>` gives the symbol from `NOTE_WINDOW_BUTTON_ICONS` there, so the templates don't change.
- `noteIcon(meta)` gives no icon on macOS 12, so it's never drawn; the sidecar keeps the key (dropping it in the sidecar's own read would lose it on the next write), for a notes folder also used on a newer Mac.
- `noteIconsSupported()` checks `NSProcessInfo`'s `operatingSystemVersion.majorVersion` (13 or later), which needs only Foundation; asking NSImage to read an SVG would load AppKit, about 10 ms a run. It's in the quick bundles' fingerprint, so an upgraded Mac rebuilds them once. The variable `scratchnstick_macos_version` (e.g. `12`) overrides it, for the tests and to see macOS 12's window on a newer Mac.

If icons are ever wanted on macOS 12, they could be drawn as PNGs at run time: Lucide shipped as black masks and recoloured with AppKit (13 ms a badge plus about 10 ms to load AppKit), or Lucide's SVG paths drawn with AppKit through [svgpath](https://github.com/fontello/svgpath) (MIT, 43 KB). Browser-based and native SVG renderers (canvg, resvg-wasm, sharp) don't run under `osascript`.

## dev/make-icons.js

Draws the images that ship: the button icons of every icon in the window, from `dev/lucide/` and `dev/icons/`, in both appearances, and the drop-downs' shadows. It removes the button icons of icons no longer in the set. With `--review <folder>` it writes every badge and dot into that folder instead, through `lib.js`'s own drawing code, to review their look; `--png` adds a PNG of each badge.

The Lucide sources in `dev/lucide/` come from `lucide-static` 1.80.0 (checked against npm's checksum), with Lucide's `LICENSE` and a `VERSION` file, so the icons can be redrawn without a download. To add an icon: copy its SVG from that release into `dev/lucide/`, add it to `NOTE_ICONS` (or `NOTE_WINDOW_BUTTON_ICONS`), and run `dev/make-icons.js`. A new Lucide release means updating `dev/lucide/`, `VERSION` and `LUCIDE_VERSION` together.

## The workflow's own images

- `icon.png` is the workflow's icon, 512 px, rendered from `dev/icon.svg` (a yellow sticky note with a curled corner, tilted 4°, on a warm grey tile, drawn by hand in a flat style, not an SF Symbol) with `rsvg-convert -w 512 -h 512 dev/icon.svg -o icon.png` (Homebrew's `librsvg`, or a browser: its shadows are Gaussian blurs, which NSImage and Quick Look draw hard-edged). Its colours are attributes rather than CSS, which NSImage and some design apps ignore: the tile's, note's and curl's are gradients, the writing's is on its `#writing` group, and the note's size and angle are one `transform` on its `#note` group. The tile fills the canvas and is a rounded square with Apple's continuous corners, corner radius 16% of its width, and straight sides between them, matching the flat-sided icons around it in Alfred's lists. A superellipse never runs straight, so even at exponent 6 its top looks bowed there, and Apple's app icon template (22.5% corners) looks rounder too. `ui/appicon.png` keeps the system's shape, which Icon Composer gives it.
- `ui/appicon.png`, sticky windows' app icon, is built from `dev/appicon.icon`, an Icon Composer document of the icon in layers: its fill is the tile's gradient, and its one layer, `Assets/note.svg`, is the note without the tile or the drop shadows, with glass and Icon Composer's neutral shadow. So the note gets the system's glass and shadow, as in other apps' icons. Edit it in Icon Composer, or its `icon.json` by hand. See [App icons](../../../../README.md#app-icons) for how `make-appicon` works and what it needs. From the workflow's folder:

  ```zsh
  ../../bin/make-appicon dev/appicon.icon ui/appicon.png
  pngquant --speed 1 --force --ext .png ui/appicon.png
  ```
- `examples/example-3-icon.svg`, the image in the Markdown example, is `dev/icon.svg` at 64 × 64 (`width` and `height`; its `viewBox` is unchanged), with the comments taken out. Preview draws it with WebKit, so its blurred shadows show, and an SVG sized this way is sharp at any scale, which a PNG at 64 px isn't on a Retina screen: Markdown can't size an image. Make it again when the icon changes.
- `icons/note.png` (`dev/note.svg`: the sticky note from the icon without its tile) and `icons/slate.png` (`dev/slate.svg`: the icon's tile with writing straight on it, like a slate) are New note's icons, 256 px, rendered with `rsvg-convert -w 256 -h 256`. Each copies paths and colours from `dev/icon.svg`, as do `dev/appicon.icon`'s note layer and fill (the fill's colours are `icon.svg`'s `#tile-fill` stops, as sRGB fractions), so a change to the note or tile in one is made in the others by hand, and their writing matches at the same displayed size.
- They're also the icons of the new-note objects in Alfred's workflow editor: Alfred reads an object's icon only from `<object UID>.png` in the workflow's folder, so those files are relative symlinks to `icons/note.png` (new sticky note objects) and `icons/slate.png` (new scratch note objects), so each image ships once. Setting an icon in Alfred's editor writes a re-encoded, bigger copy instead, so set them here by symlink.
