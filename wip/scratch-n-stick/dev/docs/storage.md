# Storage

How notes are kept on disk: the notes folder, note IDs and filenames, metadata sidecars, titles and previews, saving and the save lock, the Trash and sweeping sidecars, the example notes, and moving the notes folder. Part of Scratch'n'Stick's [developer notes](../../DEVELOPMENT.md).

## The notes folder

Each note is one plain `.md` file in the notes folder. By default that's `notes/` in the workflow's data folder (`$alfred_workflow_data/notes/`): the data folder rather than the cache, which Alfred or a cleaning app may empty, and a subfolder, to keep the notes apart from the workflow's other data. The `notes_folder` setting puts them somewhere of the user's choosing.

- The default folder is created when it's missing. A configured folder must already exist and is never created, so a folder on an unmounted volume isn't recreated on the startup disk.
- The notes are the files directly in the folder whose names end in `.md`, in any case, and don't start with `.`. Subfolders, hidden files (including temporary save files) and other files are ignored.
- A configured folder that doesn't exist gives a single result, "Missing notes folder", with its path as the subtitle. Any other problem opening it gives "Can't open the notes folder", with the reason.

## Note IDs and filenames

Everything about a note is keyed on its ID: its sidecar, its quick and sticky bundles, its window's state, and through the bundle's path, its sticky window's saved position. So a note's ID never changes, while its filename can.

**New notes** get IDs from their creation time in local time, `YYYYMMDD-HHMMSS`, with `-2`, `-3`… added if the ID is taken, and are named `<ID> <title>.md` (`20261120-153012 Shopping list.md`), or `<ID>.md` while they have no title. Such a name is "prefixed": its ID is the timestamp before the first space, and the rest of the name follows the note's title, so notes can be told apart in Finder, where they also sort by creation. An ID is taken if its note or its sidecar exists (a trashed note keeps its sidecar for 30 days), or if the caller says so: `newId`'s `isTaken` counts new notes that are open but not saved yet (`isNoteIdInUse`: a sticky bundle or a state file exists), so two notes created in the same second don't share an ID. A quick bundle alone doesn't take an ID, so the New note results offered on each list don't pile up as `-2`, `-3`.

**Files added by hand** (`Shopping.md`, `Example Number 1.md`) have their whole name without `.md` as their ID, and are never renamed, as that would change the ID. Only a name that starts with the timestamp form and then a space or `.md` is prefixed; `20261120-153012-copy.md` isn't. The example notes (`example-1-…`) aren't prefixed either.

**The title in the name** is the results list's title (see [Titles and previews](#titles-and-previews)), from the same function, cut at 60 characters (`FILE_NAME_TITLE_LENGTH`) rather than 80, then made safe: `/` (which a filename can't have) and `:` (which Finder shows as `/`) become `-`, control characters go, and it's NFC. A name over 255 UTF-8 bytes (a long emoji title) has its title cut further. A note with no title is `<ID>.md`; one whose first line is "Untitled" is named for it. This is `noteFileName(id, text)`.

**When a note is renamed**: when a save changes its title, and when the results list finds a name that doesn't follow the title (a note with only its ID for a name, one edited in another app, or one renamed by hand in Finder, which is renamed back). A rename never replaces a file, and changes neither the modification time (so "last edited" doesn't move) nor the birth time. It's `renamex_np` with `RENAME_EXCL`, which is atomic and also does a change of case alone, which `NSFileManager`'s move refuses on a case-insensitive volume. Names are compared in NFC, since an HFS+ volume gives them back decomposed.

**Copies.** Finder's Duplicate (`… copy.md`), a sync app's conflicted copy, or a save that went ahead without the lock can leave two files with one prefixed ID. The note's own file is the one named as `noteFileName` would name it, else the one with the shorter name (copies are named by adding to the original's), else the first by name; reading and saving use it. The results list splits off each other file as a note of its own: the next free ID from the timestamp (`<timestamp>-2`…), named for its text, with the note's colour, icon, font size and mode but not sticky. Its sidecar is written before the file is renamed, so a list stopped between the two leaves only a sidecar without a note, which a sweep deletes. Two files named by hand with one ID (`Notes.md` and `Notes.MD` on a case-sensitive volume) are listed as they are.

IDs from script arguments are checked (`isNoteId`: one non-hidden filename component), so an argument can't reach outside the folder.

## Metadata sidecars

Per-note metadata is kept in a hidden JSON sidecar per note, `.scratchnstick/<id>.json` in the notes folder, rather than as YAML front matter:

- Each `.md` stays plain Markdown that can be opened in any app, and the editor's text is the whole file, with nothing to strip and put back.
- Changing a note's colour or icon doesn't rewrite the note, so it doesn't change its modification time and jump to the top of "last edited".
- Sidecars are named by ID, not filename, so a note renamed to follow its title keeps its sidecar.
- The cost: sidecars travel with the notes when the whole folder is copied or synced, but a note moved on its own, or renamed so that its ID changes, loses its metadata. With the notes in the workflow's own data folder by default, that matters less.

```json
{
  "created": "2026-11-20T15:30:12+13:00",
  "colour": 1,
  "icon": "shopping-cart"
}
```

The keys:

| Key | Meaning |
|---|---|
| `created` | When the note was created, ISO 8601 in local time with its UTC offset. Never changes. |
| `colour` | The note's palette slot, 1 to 6 (see [Colours and icons](colours-and-icons.md)). Absent for the default colour. A value that isn't a slot is kept but shown in the default colour. |
| `icon` | The note's icon's name (see [Colours and icons](colours-and-icons.md)). Absent for no icon. An unknown name is kept but shown as no icon. |
| `fontSize` | The note's own font size in points (see [Window layout and controls](window-ui.md#font-size)). Absent for the default. |
| `mode` | `edit` or `view`: the mode its window was last in, recorded on every switch and when the window closes, so it reopens that way. |
| `sticky` | `true` while the note is sticky: from when it last opened sticky until it's unstuck, whether or not its window is open now (see [Note windows](windows.md#quick-views-and-sticky-notes)). Absent otherwise. |
| `collapsed` | While its sticky window is collapsed, the height in points it expands back to (see [Collapsing](window-ui.md#collapsing)). |
| `trashed` | Once the note is gone, when it was trashed, or when a sweep first found it gone. The sidecar is deleted 30 days later (see [Sweeping sidecars](#sweeping-sidecars)). |

Rules:

- Writes merge (`updateMeta`): keys being set are replaced, keys set to null are removed, and every other key is kept, including ones from other versions or tools. A sidecar is written only once there's something to store, and removed when its last key is.
- An unreadable sidecar, or one that isn't a JSON object, reads as empty, and is left alone rather than overwritten.
- Every `.md` in the folder is a note, with or without a sidecar. A note without one gets one the first time it's read or listed, recording the file's birth time as `created`. So "has a sidecar" doesn't mark the notes the workflow made.
- Moving a note to the Trash leaves its sidecar for 30 days, so a note that's put back keeps its colour and icon.

## Titles and previews

The title is the note's first line that has any text once Markdown markers are removed: heading `#`s, `>` quotes, list bullets and numbers, task boxes, and inline emphasis, code and link syntax (a link becomes its text). Code fence lines, thematic breaks, setext underlines and YAML front matter are skipped. It's "Untitled" if nothing is left.

The preview is the following lines, cleaned the same way and joined: " | " before a heading, ": " after one, ", " between list items, and a space otherwise. So `# Shopping` / `- milk` / `- eggs` gives "Shopping" and "milk, eggs", and `## Team meeting` / `### Decisions` / `- Ship on Friday` / `### Actions` / `- Release notes` gives "Team meeting" and "Decisions: Ship on Friday | Actions: Release notes". Only `#` headings count, since a setext heading's text comes before its underline.

The title is cut at 80 characters and the preview at 100 (`TITLE_MAX_LENGTH`, `PREVIEW_MAX_LENGTH`), with "…", always on whole characters: an emoji with modifiers, a flag or a letter with combining accents is never split.

**A note that's one long line** is split between title and preview, so the preview isn't empty. It applies when the note has a single line of text that isn't a `#` heading and, once cleaned, is longer than `SPLIT_LENGTH` (65, about what Alfred shows of a title at its default width). The title is the first of these that works:

1. as many whole sentences as fit in 65 characters, if they come to at least `SENTENCE_TITLE_MIN_LENGTH` (20);
2. the text up to the last `;`, `:` or dash (` — `, ` – `, ` - `, which is dropped) that leaves a title of `PUNCTUATION_BREAK_MIN_LENGTH` (40) to 65 characters;
3. the same for the last comma;
4. the short whole sentences.

The rest of the line is the preview. With none of these it isn't split, since a split mid-sentence reads no better than a long title cut short. Sentences are found with `Intl.Segmenter`, which also breaks after abbreviations, so no break is taken after a word in `ABBREVIATIONS` ("Dr", "e.g"…). "Hi Sam. Thanks for the notes from yesterday, I've added the action items to the tracker and assigned owners." gives "Hi Sam. Thanks for the notes from yesterday," and "I've added the action items to the tracker and assigned owners."

These rules are `splitTitleLine` in `scripts/text-rules.js`, with the numbers as constants at the top to tune by hand; `dev/test-storage.sh` has cases for each.

## Timestamps

"Created" is the sidecar's `created`, so it never changes, whatever happens to the file. "Last edited" is the file's modification time, which only a real change moves: saves skip writing unchanged text, and colour, icon and mode live in the sidecar.

## Saving

`save(id, text)` writes the whole text atomically: to a hidden temporary file (`.scratchnstick-save-…`) in the same folder, which then replaces the note with `NSFileManager`'s `replaceItemAtURL`. So a crash, a sync app or another save never sees half a note, and when two saves race (a window's `typingstopped` and `quit` saves are separate processes) the last to finish wins whole. `replaceItemAtURL` keeps the note's birth time, permissions and Finder tags; Cocoa's `writeToFile:atomically:` loses them. Racing processes writing 5 MB notes in place left mixed notes every time; the atomic save never did.

It returns `"created"`, `"saved"`, `"unchanged"` (text matches the file, nothing written) or `"blank"` (a new note with blank text, nothing written), and records `created` on a note's first save. A new prefixed note is written with the name for its title, and an existing one is renamed after it's written if its title has changed (see [Note IDs and filenames](#note-ids-and-filenames)).

**The save lock.** Saving, `deleteIfEmpty`, and the list's renames hold the save lock, `$alfred_workflow_cache/locks/save`, one per Mac for all notes. Without it, a save that found the note's name could write to it after another save had renamed the note, leaving two files. It's an `flock` lock (see [Locks](#locks)); saves hold it for milliseconds. One that waits more than 2 s (`SAVE_LOCK_TIMEOUT`), or can't take it, saves without it: at worst that leaves a second file, which the list splits off as a note of its own, where giving up would lose the text of a window's last save. Readers don't take it: a rename is atomic, so they see one name or the other, and `read` looks for the note again if it vanishes between finding its name and reading it. `noteStore`'s `lockFile` option gives the tests their own lock.

When a window saves is covered in [Note windows](windows.md#saving-from-a-window).

## Empty notes

A note is empty when its text is only whitespace, whatever its sidecar holds.

- A new note isn't written until its text isn't blank, so an abandoned new note leaves no files.
- Saving blank text over an existing note does write it, so deleting everything and typing again keeps the note's file and sidecar.
- A note that's empty when its window closes is deleted outright with its sidecar and bundles (`deleteIfEmpty`), not trashed, as there's nothing to recover.

## The Trash

`trash(id)` moves a note to the Trash through Finder, so Finder's Put Back works, and keeps its sidecar, recording the time in its `trashed`. A sidecar that can't be read is left alone, and if the time can't be written, the next sweep dates it instead. macOS asks once for Alfred's permission to control Finder. With the permission off, Finder fails at once with -1743 (errAEEventNotPermitted), whose JXA message is only "An error occurred.", so `trash` replaces it with one saying where to allow it. A sticky window's own process can control Finder without a prompt. Finder runs without the save lock, since the first time it can wait on the permission prompt; if it fails because a save renamed the note meanwhile, `trash` tries again with the new name.

## Sweeping sidecars

A note that's gone (trashed, or deleted some other way) leaves its sidecar, for Put Back. A sweep deletes it once it has been gone 30 days (`SIDECAR_KEEP_DAYS`), the same time Finder's "Remove items from the Trash after 30 days" keeps the note.

- **Two things must be true** for a sidecar to be deleted: there's no note for it, and its `trashed` is 30 days old. "No note" means no file with its ID, whatever its title, extension case or Unicode normalisation, as the move does.
- **A sidecar without a `trashed`** (the note was deleted in Finder, on another Mac sharing the folder, or by another app) is given the sweep's time, so it's kept 30 days from then. A `trashed` that isn't a date is replaced the same way.
- **A note that's back** (Put Back) has its `trashed` removed when it's next read or listed, so if it goes again other than through `trash`, a sweep dates it afresh rather than from the old date.
- **Left alone**: sidecars of notes open but not saved yet (`isNoteIdInUse`: a colour can be picked before typing, which writes a sidecar before the note exists), sidecars that can't be read as a JSON object, and other files. A file that can't be changed is skipped, and tried again on the next sweep.
- The sidecar's own modification time can't stand in for `trashed`: it's when the note's metadata last changed, which may be long before the note was trashed.

**When**: the results list (`list.js`) sweeps once a day, on its first run on a new local date (`sweepSidecarsDaily`), after checking for a move of the notes folder, so it sweeps only the folder the record names. The time of the last sweep is `lastSidecarSweep` in `$alfred_workflow_data/state.json`. A sidecar is deleted by the first sweep 30 days after its `trashed`: 30 to 31 days after a note trashed through the workflow, and up to a day more for one that went some other way, dated by the next sweep. An error in a sweep is logged and the list carries on.

A sweep of 1,000 notes and 1,100 sidecars (50 to date, 50 to delete) takes about 55 ms; with nothing to change, under 10 ms.

## Example notes

The workflow ships example notes in `examples/`, which is laid out as a notes folder: `example-<n>-<name>.md`, each with its sidecar in `examples/.scratchnstick/`. The first time the results list or the new-note keywords run, they're added to the notes folder (`installExamplesOnce`, and `installExamples` in the store), after the check for a move of the notes folder and before the notes are listed.

- **Names.** The `example-` prefix makes them stand out in the notes folder, so anyone looking there can see what they are and delete them. `<n>` sets their order (as a number, so `example-10` follows `example-9`); a file in `examples/` not named this way isn't installed.
- **Sidecars.** A shipped sidecar holds only what the example shows off: `colour`, `icon`, `fontSize` and `mode`. Installing copies it and adds `created`. It replaces any sidecar already there for that ID: with no note, that can only be what's left of a trashed example, kept for Put Back.
- **Dates.** The copies are dated as made at install time, a second apart, with `example-1` newest, so the list (last edited first) shows them in their numbered order above any notes already there. Their creation and modification dates and `created` are all set to that time. The dates in the bundle aren't used: they're when the build was made or unzipped.
- **Never replaced.** An example whose note is in the notes folder is left alone, sidecar included, as someone may have kept it and been using it for months.
- **Once.** When they've been added, `examplesInstalled` in `$alfred_workflow_data/state.json` records when. Nothing else stops them being installed: the notes folder may already have notes. With the data folder gone, or on another Mac sharing the notes folder (the state is per Mac), the examples that aren't in the notes folder come back beside the user's notes. If one can't be added, the ones before it stay, nothing is recorded, and the next run tries again; the error is logged and the list carries on.
- **Checks.** `dev/test-storage.sh` checks the shipped examples: numbered from 1 with no gaps, a sidecar for each with only those keys and valid values (a colour slot, one of the note icons, a font size from the menu, `edit` or `view`), and nothing else in the folder.

## Moving the notes folder

When `notes_folder` changes, the notes move to the new folder without asking. Alfred runs nothing when a setting changes, so the move happens on the workflow's next run. It's `checkNotesFolderMove` and `moveNotes` in `lib.js`, and `scripts/move.js`.

**Noticing a change.** The folder the notes were last in is recorded, as an expanded path, as `lastNotesFolder` in `$alfred_workflow_data/state.json` (local to each Mac). The file also holds `lastSidecarSweep`, and every write merges into it, read again just before writing, so each key is kept when the other changes. Every entry point that reads the setting (`list.js`, `new.js`, `open.js`) compares it with the folder the setting gives now; the window scripts don't, as each window works on the folder in its bundle's context. With no record yet, the current folder is recorded and nothing moves. The two count as the same folder if, with symlinks resolved, they have the same volume and file number, so `~/notes` and `~/Notes` on a case-insensitive volume, or a symlink and its target, aren't a change.

**The lock.** A move holds the move lock, `$alfred_workflow_cache/locks/move` (see [Locks](#locks)), so only one runs at a time. `isMoveLockHeld` checks by trying for the lock and letting go at once, so `takeMoveLock` waits up to 100 ms rather than taking a check for a running move. It's separate from the save lock: the move asks sticky windows to quit, and their `quit` saves take the save lock.

**Its own process.** The Script Filters have `queuemode` 2, so a keystroke kills the run in progress, and Alfred kills the run's whole process group, even a child disowned with `&!`. So the entry point starts `move.js` in the background (input and output on `/dev/null`) and stops; `move.js` first calls `setsid()` to leave the group. A keystroke in the instant before that is harmless: the next run starts the move again. (zsh can't do this: without a terminal `setopt monitor` fails, and macOS has no `setsid` command.)

**While it runs**, the results list and the new-note keyword show a single "Moving notes…" result with `rerun` (0.5 s), so the notes appear once it's done. Routes with no list (hotkeys, Universal Actions, New note from clipboard) open nothing and post nothing; the text is still where it came from.

**Sticky windows are closed first** (`quitStickyNoteWindows`), so none keeps saving into the old folder. Each is asked to quit normally (`NSRunningApplication`'s `terminate`), so its `quit` event saves the note into the old folder; the process exits only after those writes, about 100 ms later, so the move waits for the process to exit (polling `kill(pid, 0)`: in JXA `isTerminated` never updates without a run loop), force-quitting after a few seconds. Quick views need nothing: none can be open while the configuration sheet is, and their fingerprints include the notes folder.

**What moves**: every note (with its sidecar if it has one). Sidecars without a note (trashed notes') are deleted, as Put Back would return the note to the old folder anyway. Other files, subfolders and hidden files stay.

**Into a folder with notes already**: sidecars join its `.scratchnstick`. A note whose ID is taken there (by a note with any title, in any extension case or Unicode normalisation, or by a sidecar) is renamed with the next free suffix on its ID, keeping its title and its extension's case (`20261120-153012-2 Shopping.md`), and its sidecar with it. The exception: a note with the same text as the note of the same ID there (from a move that was cut short, or a copy made by hand) is kept only once, the new folder's copy; its sidecar moves only if that copy has none.

**One note at a time**, so a move stopped anywhere loses nothing: copy the sidecar, move the note, delete the old sidecar. (A sidecar in the new folder with exactly the text of the note's own is that copy, and doesn't take the ID.) Within a volume the note is renamed and the sidecar's copy is a hard link. Across volumes a file is copied to a hidden temporary name (`.scratchnstick-move-…`), renamed into place, and only then deleted from the old folder. The rename into place never replaces a file. Modification times, birth times and Finder tags are kept, and set explicitly on copies in case a volume doesn't. Temporary files left by a stopped move are cleared before a move starts. 1,000 notes with sidecars move in about 0.7 s on one volume.

**When a move stops part way** (cut short, or failing on a read-only folder or a full disk), the record isn't changed, so the next run carries on. A failure is recorded in `$alfred_workflow_cache/move-failure.json` (the folders and the reason), and the lists show it once as "Couldn't move the notes", without `rerun`; showing it marks it shown, so the next run tries again rather than the list retrying forever. `open.js` just tries again. The record stays until a move succeeds, so `move.js` can tell a repeat failure from a new one.

**Finishing**: the old folder's `.scratchnstick` is removed, the record is set to the folder the move went to (not whatever the setting says by then), and the old default folder is removed if it's empty. A folder of the user's own is left in place.

**Edge cases**: if the new folder is missing, nothing moves and the record is unchanged (the list shows "Missing notes folder", and the move happens once it exists). If the old folder is missing, nothing moves, the record is updated, and a notification says so, as nothing else would explain an empty list.

**Notifications** (`postNotesNotification`, through the workflow's `notify` External Trigger and a Post Notification object, so they come from Alfred with the workflow's icon and need no permission of their own; nothing is posted outside Alfred, as in the tests):

- "Moved 42 notes to ~/Notes.", plus "3 were renamed, as their names were taken there." when some were. The default folder is called "the workflow's data folder".
- "Your notes are now kept in ~/Notes. There were no notes to move."
- "Couldn't move the notes to ~/Notes: \<reason>", but not again for a retry that fails the same way.
- "Your notes are now kept in ~/Notes. No notes were moved, as the old folder, \<path>, wasn't found."

The `notes_folder` field's description warns that changing it moves the notes and closes any sticky notes.

## Locks

The save lock and the move lock are files in `$alfred_workflow_cache/locks/`, locked with `flock(2)`, the kernel's advisory lock (`takeFileLock`, `releaseFileLock`, `withFileLock`):

- One process holds a lock at a time; even the holder can't take it twice, since each take opens the file afresh.
- It's released when its process exits, however that happens: a crash, `kill -9`, or Alfred stopping a Script Filter's process group. So no lock is left held by a process that's gone, and there are no stale locks to detect.
- A process the holder starts (with `NSTask`) doesn't inherit it (tested).
- A take that has to wait tries every 10 ms until its timeout.
- The file is created by writing in place, never replaced: a process holding the lock holds it on the file as it is, so a replaced file would be a second lock.
- The files are in the cache, on the local disk, where `flock` is reliable, even when the notes are in a synced or network folder.

`flock` and `renamex_np` (for renames) are called through `ObjC.bindFunction`, as `CC_SHA1` is. Both have been in macOS since well before macOS 12.

## The storage API

`noteStore(folder = notesFolder(), { lockFile })` returns the functions for the notes in a folder, taking notes by ID. `lockFile` is the save lock's path, `locks/save` in the cache by default.

- `list({ ids, isInUse })`: notes, last edited first, as `{ id, path, fileName, text, meta, modified, created, title, preview }` (`meta` is `{}` without a sidecar; dates are `Date`s). `ids` limits it to those notes (the sticky notes list). Listing every note also renames notes and splits off copies (see [Note IDs and filenames](#note-ids-and-filenames)); `isInUse` says which IDs a copy can't be given, `isNoteIdInUse` by default.
- `read(id)`: one note object, or null.
- `newId({ date, isTaken })`, `save(id, text)`, `deleteIfEmpty(id)`, `trash(id)`, `sweepSidecars({ now, isInUse })`, `installExamples(source, { now })`: as above.
- `readMeta(id)`, `updateMeta(id, changes)`: the sidecar, which works before a note is first saved (a colour picked before typing).
- `notePath(id)`, `exists(id)`, `folder`.

Also `noteSummary(text, { titleLength, previewLength })` for text that isn't saved yet (a window's title), and `noteSummaryOrUntitled`, the same with a null title when there's none. For IDs and names: `noteIdFromFileName`, `isPrefixedNoteId`, `noteFileName(id, text)`, `renameFileInFolder(folder, from, to)`. Helpers: `workflowVariable`, `truncateText`, `isBlankText`, `formatNoteId`, `formatLocalIsoDate`, `readText`, `writeFileAtomically`, `errorText`. Fuller notes are in the comments in `lib.js`.

JXA lessons from this code:

- Give an ObjC object parameter `$()` for nil: JavaScript `null` arrives as `NSNull`, which crashed `replaceItemAtURL` (as its backup name). `null` is fine for out parameters.
- Pass `$()` for an `NSError **`, not `Ref()`: reading an NSError back from a `Ref()` crashes `osascript`. `errorText(error)` gives its description.
- `list()` of 300 notes takes about 110 ms on top of `osascript`'s startup, and about 240 ms the first time, when it writes their sidecars. Checking that names follow titles costs nothing measurable: it uses the title `list()` already works out. Renaming 300 notes named by time alone, once, takes about 650 ms.
