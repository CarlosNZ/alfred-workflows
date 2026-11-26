# Planned

Features planned for after the first release, with what's known about each. Part of Scratch'n'Stick's [developer notes](../../DEVELOPMENT.md), whose "Still to do" list has the work before the first release.

## Changes made elsewhere

A note's window doesn't notice its file changing on disk or being deleted (see [Changes made elsewhere](windows.md#changes-made-elsewhere)). The plan: a slow `pulse` in each window comparing the file's modification time, which reloads the window when it has no unsaved typing, and closes it without a final save when the file has gone.

## Dark appearance

- **The palette.** Only macOS's named colours adapt to the appearance by themselves; hex colours are fixed. Adaptive notes need a light and a dark tint per colour, chosen when the window opens, or a translucent tint that suits both. Sticky windows are kept in the light appearance meanwhile (see [Colour in the window](colours-and-icons.md#colour-in-the-window)).
- **The drop-downs.** Their shadow images are drawn for the light look only (see [Drop-downs](window-ui.md#drop-downs)).

## The workflow's own Quick Look preview

A Quick Look preview of the workflow's own, so ⇧ shows the note as Preview does, in its colour, on every Mac. Alfred runs no script on ⇧ / ⌘Y; it previews the `quicklookurl` it was given, so the page must exist before `list.js` returns. The plan: `bundleFor` in `quickWindows` writes a static `preview.html` into each quick bundle when it rebuilds it, so the fingerprint, the missing-bundle check and the clean-up cover it unchanged. The page is the note rendered with markdown-it under `osascript` (as `noteRichHtml` does), with inline CSS for the tint and the icon as inline SVG, and `quicklookurl` is its path. The sticky notes list builds no quick bundles, so it would keep the `.md` unless it reads the previews too. Rendering at save time doesn't work, as notes change outside the workflow and the page depends on settings and the theme too; rendering on demand would need a web server or a signed Quick Look extension. What Alfred's Quick Look does with an `.html` is in [Alfred UI and Alfred behaviour](alfred-ui.md#quick-look).

## Images in the example notes

The example notes should be able to show images (a screenshot of a sticky note, say), shipped with the workflow and added to the notes folder with the notes.

What Preview does with an image's address now, in markdown-it's default link check and the page's location:

- **`file://` URLs are refused.** markdown-it's `validateLink` rejects `file:`, `javascript:`, `vbscript:` and `data:` other than `data:image/(gif|png|jpeg|webp)`, so `![](file:///…)` is shown as its Markdown text, and linkify doesn't make a bare `file:///…` a link.
- **Relative paths resolve against the note's bundle**, not the notes folder: the page is `view.html` in the bundle in the cache (see [Preview](view-mode.md#the-page)), so `![](pic.png)` beside the note doesn't load.
- **`~/` isn't expanded.**
- **An absolute path with no scheme** (`/Users/…`, in `<…>` if it has spaces) becomes an `<img>` with that path, which the `file://` page should load, as it loads scripts from any folder (see [Alfred UI](alfred-ui.md#web-view)); not yet checked in a window.
- **`data:` images work**, but bloat the note's text, which shows in Edit, the results' previews and search.

So the examples can't use any of these as they are: the workflow folder's path differs on every Mac, and the notes folder can move. What it needs:

- **Where the images go.** Copied into the notes folder with the examples, so a note's reference stays valid when the workflow is updated or removed, in a folder beside the notes (perhaps `images/` or under `.scratchnstick/`), never replaced if already there, like the notes.
- **Note-relative paths in Preview.** A custom `validateLink` and a renderer rule in `ui/view.js` that resolve a relative path (and `~/`) against the notes folder, which the page would need from `note.js`, and allow `file:`. That also lets users put their own images in notes.
- **Moving the notes folder** has to move the images folder too (see [Moving the notes folder](storage.md#moving-the-notes-folder)).
- **Other renderings.** Copy as Rich Text renders with the same rule, so its images need the same paths. Quick Look doesn't load an absolute `file://` image (see [Alfred UI](alfred-ui.md#quick-look)), which matters for [the workflow's own Quick Look preview](#the-workflows-own-quick-look-preview).
- **Checks.** `dev/test-storage.sh` allows nothing in `examples/` but the notes and their sidecars, so it needs to allow the images folder and check that each image a shipped example refers to is there.
- **Clean-up.** An example's images stay when the example is trashed or deleted, as another note may use them. Naming them `example-…` too makes them as easy to spot and delete as the notes.
