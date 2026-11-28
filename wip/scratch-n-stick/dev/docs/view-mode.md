# Preview

How Preview (View mode in the code) renders a note in a web view, with task boxes that tick the note. Part of Scratch'n'Stick's [developer notes](../../DEVELOPMENT.md). What Alfred UI's `webkitview` does, on which this rests, is in [Alfred UI and Alfred behaviour](alfred-ui.md#web-view).

## Why a web view

Preview has to work as people expect from other Markdown apps: full Markdown, task lists included, and ticking a box ticks it in the note. Alfred UI's own `markdownarea` renders Alfred's Markdown but no task boxes or raw HTML, is display-only, sends no click events, and has very loose spacing (see [Alfred UI](alfred-ui.md#markdownarea)). Workarounds within it (☐ substituted for `- [ ]`, a `checkbox` component per task between `markdownarea` blocks, custom-scheme links) were each display-only or broke selection and scrolling. So Preview is a `webkitview`.

## The renderer

[markdown-it](https://github.com/markdown-it/markdown-it) (MIT): CommonMark, with tables and strikethrough, raw HTML escaped by default (so a note can't run script in the page), and one file to vendor: `vendor/markdown-it/markdown-it.umd.min.js` (from npm's `dist/browser/`, 15.0.3, the global `markdownit`), with its `LICENSE` and a `VERSION` file. It records each block's source lines (`token.map`), so a task's box can carry the line it came from.

**Links and images** resolve as in other Markdown apps, plus `~/`:

- a relative path is from the notes folder, which is the note's own folder;
- `~/…` is from the home folder of whoever is viewing, so a note synced to another Mac or account finds the same file there. Other apps don't expand `~/`: they read `~/a.png` as a folder named `~` beside the note;
- absolute paths, `file://` URLs and anything else with a scheme, and `#…` fragments, are left as they are.

Every address markdown-it reads (inline links and images, reference definitions, autolinks and bare URLs) goes through its `normalizeLink` and then its `validateLink`, so `noteMarkdown` changes only those two, and the note's text is never changed:

- `normalizeLink` is wrapped so its result goes through `noteResolvedAddress(address, bases)`, a pure function that prefixes a relative or `~/` address with the notes folder's or home folder's `file://` URL (`bases`, from `note.js`). The address is already percent-encoded and so are the bases, so joining them makes a valid URL; `./` and `../` are left for WebKit to resolve.
- `validateLink` is markdown-it's own check without `file:`: `javascript:`, `vbscript:` and `data:` other than a GIF, PNG, JPEG or WebP image are still refused. `file:` is refused by default because on a website it makes no sense; in a note it's a normal address.

A bare `file:///…` isn't made a link (linkify only knows web and mail schemes), and raw HTML `<img>` stays escaped. Linked files don't move with the notes folder (see [Moving the notes folder](storage.md#moving-the-notes-folder)), so a relative path breaks if the folder moves; `~/` and absolute paths don't. Copy as Rich Text calls `noteMarkdown` without bases, so its relative and `~/` addresses are left as written.

Task lists are a core rule of our own, `noteTaskRule` in `ui/view.js` (after `inline`): a list item whose paragraph starts `[ ] ` or `[x] ` gets an `<input type="checkbox" data-line="N">`. The `markdown-it-task-lists` plugin is unmaintained and records no lines; marked has task lists but no source positions; micromark / remark have positions but are many ES modules to bundle.

markdown-it also runs in JXA (12 ms to load, 9 ms to render), which Copy as Rich Text uses, but rendering ahead of time doesn't make the page appear any sooner, so the page renders the note itself.

## The page

The page is `view.html` in the note's bundle, written by `notePageHtml` in `lib.js` from `ui/view.html` with `ui/view.js` inlined, so a changed script is never read from WebKit's cache. It loads:

- markdown-it from the workflow folder by its absolute `file://` path;
- in a quick view, the theme stylesheet (`noteThemePath()`), with a `?t=` that changes every time so a changed theme is never cached;
- the note from `note.js` beside it, as `note.js?v=<version>`: `window.NOTE` (the text), `window.NOTE_TINT` (a sticky page's colour), `window.NOTE_FONT_SIZE` and `window.NOTE_BASES`, the `file://` URLs links and images are resolved against (`notePageScript`, `noteAddressBases`). It has to be a script: a page can load scripts by `file://` URL, but `fetch` and `XMLHttpRequest` fail even beside it. And WebKit keeps a page's scripts, so a reload runs the old `note.js` unless its own URL changes, hence the `?v=`.

The note's text never passes through `ui.json`, so it needs no escaping for Alfred's placeholders, and the quick bundles' fingerprints already cover it. A window that opens in Edit gets `NOTE = null`, so its page draws nothing until the first switch to Preview reloads it with the note.

`writeNotePage(id, form, text)` gives an open window's page a text: it rewrites `note.js`, records the text's hash as `textHash` in the context, and returns the reload URL, `file://<bundle>/view.html?v=<version>`, where the version is the hash of `note.js` and the time, so every reload has a new URL even for the same text. The page keeps its scroll position across reloads in `sessionStorage`.

## The page talks by changing its fragment

A web view sends its `changed` action whenever its URL changes, fragment included, and that's the only way a page can tell the workflow anything:

- `#t-<line>-<x|o>-<counter>`: a task box was clicked (the counter makes each change distinct).
- `#ready-<opacity>-<rrggbb>-<counter>`: the page has drawn, with the opacity to show it at (1 when sticky; in a quick view the theme stylesheet's `--opacity`) and its background colour (`notePagePanel` in `ui/view.js`; left out if it can't be read).

The `changed` action is `scripts/changed.sh`, a short zsh script rather than JXA, since Alfred waits for it (in a quick view, inside Alfred's process) and it runs on every URL change, including the page starting to load; an `osascript` there held the page back by about 80 ms. It:

- answers `#ready` with an `update` setting the web view's `opacity`, and in a quick view the strip along the top (`titlestrip`) to the page's colour at the same opacity, unless the window's state says Edit (a page that finished loading after a quick switch to Edit would otherwise show over the editor). It reads the state file with a zsh builtin; no state yet means the window has just opened in Preview;
- passes `#t-` on to `window.js tick`;
- ignores everything else.

## Ticking task boxes

`window.js tick` ticks the box only if the note's text still has the hash the page was built from (`textHash`) and the line is still a task box in the other state (`toggleNoteTask` in `lib.js`); it then saves the note. Otherwise it rewrites `note.js` and reloads the page with the note as it is now, so a tick can't act on a stale page. A task's line is a list item whose text starts `[ ] ` or `[x] `, with any indent, bullet or number, and `>` quote markers before it (`NOTE_TASK_LINE`). A tick takes about 5 ms in the script.

## Switching mode

The web view stays in the window for its whole life, rather than the switch replacing the content, since each new web view takes 100–250 ms to show anything.

- **To Edit**, an `update` fills and shows the editor (`hidden: false`, `focus: true`, caret at the end) and fades the web view out (`opacity: 0`), and in a quick view clears the strip.
- **To Preview**, `window.js` saves the editor's text, hides the editor and reloads the page with the note, which `changed.sh` shows once it has drawn.
- The same output changes the toggle button's image, tooltip and accessibility label, and in a quick view replaces the key hints.

From the switch script to the note shown takes 38–66 ms, plus `osascript`'s start-up (about 75 ms). Re-rendering in place without a reload (the note in the URL's fragment) was barely faster, and a refused tick needs the reload anyway.

## Showing the page without a flash

A web view is opaque: WebKit paints a fill under the page (`#1E1E1E` in dark appearance, white in light) that Alfred UI never turns off, and a new web view shows only that fill for 130–200 ms before the page first draws, however little the page does. So the web view starts at `opacity: 0`, and the page reports `#ready` two animation frames after rendering, when `changed.sh` shows it. Shown any sooner (on `launched`, or one frame after rendering), a sticky window showed a white block for about 120 ms. From the page starting to load to being shown takes 70–180 ms in a quick view and 190–260 ms in a sticky window: the note appears a moment after the window, with no flash.

An Edit window's empty page might still draw behind the editor, as an opacity set before the first draw may not hold; nothing has shown there, so the web view isn't also `hidden`, which would be the fix if a panel ever appears.

## The look

- **Sticky**: the page's background is the note's tint and its text dark, like the window. The page starts below the top row (see [Dragging](window-ui.md#the-window)).
- **Quick view**: the page should look like Alfred's window, in the user's theme. `list.js` gets Alfred's theme background as a Script Filter (`alfred_theme_background`, `rgba(r,g,b,a)`) and writes a stylesheet the pages load (`writeNoteTheme`, `noteThemeStylesheet`), so a change of theme rebuilds no bundles. The panel colour is the theme's colour over the appearance's base at its alpha, *a* × theme + (1 − *a*) × base (base `#1E1E1E` in dark, white in light), and the web view's opacity is *a*, but at least 0.8 (`THEME_MIN_OPACITY`). So a solid theme is matched exactly. Below full opacity the text fades with the view, so it's drawn at 0.85 ÷ opacity (`THEME_TEXT_ALPHA`, at most 1), with brighter links, to land at its normal strength. A translucent theme can only be imitated like this until Alfred can make a web view transparent (filed in [Alfred requests](../../../../Alfred%20requests.md#alfred-ui-a-transparent-background-for-a-web-view)). The page's colour is read back from the page for the strip, rather than worked out in `lib.js`, as the stylesheet's colour depends on the appearance.
- **Fades**: while there's more of the note below, the bottom of the text fades to transparent, and the top likewise while there's more above, since overlay scroll bars are hidden until you scroll. Each fade is 5 times the font size, shortening over the last of the scroll, so the start and end of the note are never faded. It's a mask on `#note`, which fills the page and does the scrolling (the page itself doesn't scroll), so the mask stays at the edges without script on every `scroll` event. In a quick view the mask also hides the bottom 28 px under the key hints (`--clear-bottom`) and the bottom fade starts above that. `view.js` sets the fades' lengths (`--fade-top`, `--fade-bottom`) on scroll, resize and an image loading. Edit has no fades: its `textarea` is native, and a faded line where you type would get in the way.
- **Links** open in the default browser (`openlinksexternally: true`), and the page stays as it is. A quick view closes as the browser comes forward.
- Text can be selected and copied (task boxes without their `[ ]`); ↓ and Home scroll after a click in the page.
