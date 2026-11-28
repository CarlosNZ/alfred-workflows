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

The example notes should be able to show images (a screenshot of a sticky note, say), shipped with the workflow and added to the notes folder with the notes. Preview resolves a relative path from the notes folder (see [The renderer](view-mode.md#the-renderer)), so an example can refer to its images by a path relative to the notes folder, which works wherever that folder is. What's left:

- **Where the images go.** Copied into the notes folder with the examples, so a note's reference stays valid when the workflow is updated or removed, in a folder beside the notes (perhaps `images/` or `attachments/`; not under `.scratchnstick/`, which Obsidian and other apps hide), never replaced if already there, like the notes. Moving the notes folder carries that folder with everything else (see [Moving the notes folder](storage.md#moving-the-notes-folder)).
- **Other renderings.** Copy as Rich Text renders without the notes folder, so relative images aren't resolved there. Quick Look doesn't load an absolute `file://` image (see [Alfred UI](alfred-ui.md#quick-look)), which matters for [the workflow's own Quick Look preview](#the-workflows-own-quick-look-preview).
- **Checks.** `dev/test-storage.sh` allows nothing in `examples/` but the notes and their sidecars, so it needs to allow the images folder and check that each image a shipped example refers to is there.
- **Clean-up.** An example's images stay when the example is trashed or deleted, as another note may use them. Naming them `example-…` too makes them as easy to spot and delete as the notes.

## Adding files to a note

A Universal Action that puts local files (not only images) into a note as Markdown links: `![](…)` for an image, `[name](…)` for anything else. It would copy each file into a folder in the notes folder (perhaps `attachments/`), or link to it where it is with a `~/` path, and add the link to a new note or to the end of a chosen one. Paths with spaces need `<…>` (macOS's screenshot names have spaces). Alfred UI's textarea may not accept a dropped or pasted image, which is why this is an action instead of something done in Edit.
