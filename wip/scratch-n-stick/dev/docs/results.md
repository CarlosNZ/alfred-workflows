# Results and new notes

The workflow's Alfred inputs: the results list, the sticky notes list, and the ways of creating a note. Part of Scratch'n'Stick's [developer notes](../../DEVELOPMENT.md). Where each route leads once a note opens is in [Note windows](windows.md).

## The results list

A Script Filter on `{var:keyword}` (`scratch` by default), run by `scripts/list.js`. An optional hotkey, unset by default, shows the same list (Hotkey → the Script Filter).

**Order.** One result per note, last edited first. Results have no `uid`, so Alfred keeps this order: with `uid`s, Alfred's learning moved often-chosen notes above New note and above more recent ones, and `skipknowledge` doesn't help, as Alfred still sorts by what it learned before the flag was set (rows of the `knowledge` table in `~/Library/Application Support/Alfred/Databases/knowledge.alfdb` keyed `<Script Filter uid>.<item uid>`). A `uid` would only be worth it with `rerun`, to keep the selection on one item, and would then need `skipknowledge` and those rows cleared.

**A result:**

- Title: the note's title (see [Storage](storage.md#titles-and-previews)).
- Subtitle: when it was last edited and its preview, `Edited 3h ago • milk, eggs, flour…`. The time is "just now", "5m ago", "3h ago", "2d ago", and after a week the date in the Mac's format ("12 Nov", with the year if not this year). A sticky note's starts "📌 Sticky • ": the pushpin stands out among grey subtitles, where the word alone was easy to miss. The separator is a bullet, `SUBTITLE_SEPARATOR` in `list.js` (a middle dot looked too small, ● too heavy, and a pipe clashes with the preview's ` | `).
- Icon: the note's result icon, its badge or its colour's dot (see [Colours and icons](colours-and-icons.md)).
- ⌘C copies the note's text, ⌘L shows it in Large Type, → shows Alfred's file actions for its file, and ⇧ / ⌘Y Quick Look it (`quicklookurl` is the `.md`, so the preview is whatever Markdown previewer the Mac has, possibly plain text). A Quick Look preview of the workflow's own is [planned](planned.md#the-workflows-own-quick-look-preview).

**Keys on a note:**

| Key | Does |
|---|---|
| ↩ | Opens it in a quick view inside Alfred, or, if it's sticky, brings its window to the front |
| ⌘↩ | Sticks it to the desktop, or brings its sticky window to the front |
| ⌥↩ | Moves it to the Trash (`trash.js`, through Finder, without asking), closing its sticky window first, and posts "Moved “\<title>” to the Trash" |
| ⌃↩ | Reveals it in Finder |

**Searching.** Every word of the query must appear somewhere in the note, in any order, ignoring case and accents ("cafe" finds "Café"). `list.js` matches itself (`alfredfiltersresults` off), as it needs to know when nothing matches. It reruns on every keystroke, reading every note (about 115 ms for 300 notes, plus `osascript`'s startup), and `queuemode` 2 stops the previous run.

**New note.** With no query, a New note result comes first, unless the `show_new_note` checkbox is off. A query that matches nothing gives a single **New note: \<query>** whatever the setting, since it isn't clutter there and an empty list would fall through to Alfred's fallback searches. ↩ opens the new note in a quick view and ⌘↩ sticks it, as on a note. ⌥ and ⌃ are `valid: false` on it, as their actions take a note's ID or path. Its icon shows what its key creates (`newNoteResult` in `lib.js`): the slate (`icons/slate.png`) for a quick note, the sticky note (`icons/note.png`) under ⌘. The title can't change with the modifier: Alfred ignores a `title` in `mods`.

Creating a note from the clipboard is a result of the new-note keyword rather than a key here, since ⌥↩, unused on New note, trashes a note, so one slip would trash a note.

**"Loading notes..."** is the Script Filter's `runningsubtext`, shown on the keyword before the first results. A run usually takes 0.1–0.2 s, but rebuilding every quick bundle (once after a workflow update or a changed setting) takes about 1.5 s for 300 notes. While typing, Alfred keeps the previous results up, so it doesn't show then.

**Before the results**, `list.js` checks for a notes folder move (see [Storage](storage.md#moving-the-notes-folder)) and the palette (see [Colours and icons](colours-and-icons.md#the-palette)); either can replace the results with a single message. Its first run of all adds the example notes, as does the new-note keywords' (see [Example notes](storage.md#example-notes)). On its first run of the day it sweeps the sidecars of notes gone 30 days (see [Sweeping sidecars](storage.md#sweeping-sidecars)). It then writes the quick bundles that are out of date and the quick view's theme stylesheet, so ↩ can open a quick view with nothing in between (see [Seamless quick views](windows.md#seamless-quick-views)).

## The sticky notes list

A Script Filter on `{var:keyword_sticky}` (`sticky` by default) showing only the sticky notes, to find one among other windows and to close them. It runs `exec ./scripts/list.js "$1" stickies` (an inline script, as a `scriptfile` takes no arguments of its own), which reads only those notes (`store.list({ ids })`) and writes no quick bundles. An optional hotkey, unset by default, shows it.

- Results are the results list's (built by `noteItem`, with each list's arg and ⌘ added by `notesListItem` and `stickiesListItem`), without "📌 Sticky • " and without New note.
- ↩ brings the note's window to the front: the arg is the note's ID, down the stick route (`open.js stick`), which activates the live window, or opens it again if it has closed since.
- ⌘↩ closes the note's window (`stickies.js close <id>`; ⌘ sets `sticky_action` to `close`), asking it to quit as its close button does, so it saves and reopens as it was. (Switching Edit / Preview from here isn't possible: nothing outside a window can tell it to do anything but quit.)
- ⌥↩ and ⌃↩ trash and reveal, as in the results list.
- **Show all sticky notes** and **Close all sticky notes** come last, whatever the query, and act on every sticky window, listed or not. Their subtitles give the count ("Bring the 3 sticky notes on the desktop to the front"). Each sets `sticky_action` (`show` or `close`) with an empty arg; a Conditional sends them to the Run Script `stickies.js "$sticky_action" "$1"`, and its else output sends the notes' ↩ to the stick route. A sticky window whose note isn't saved yet has no result but is counted, shown and closed.
- **Show all** (`stickies.js show`, `activateWindowProcesses`) activates the windows' processes in the list's order from the bottom up, each once the one before has become active, so the most recently edited note ends on top with the focus, and Alfred closes. A window hidden with ⌘H is shown again.
- With no sticky notes: one result, "No sticky notes", subtitled "Stick a note to the desktop with ⌘↩ in “scratch”" (the configured keyword). With a query that matches none: "No sticky notes match “\<query>”", subtitled "Search all your notes with “scratch”", then Show all and Close all.

`dev/test-list.sh` can't open windows, so it gives the sticky notes in the variable `scratchnstick_sticky_ids` (IDs one per line), which `list.js` reads in place of the live windows (`windowStates`).

## Reopen sticky notes

With no query, both lists start with **Reopen sticky notes** while there are notes whose sticky windows were closed by a restart, shutdown or logout, or ended without closing (a crash), and that still exist (see [Reopening after a restart](windows.md#reopening-after-a-restart)). It comes before New note, and in the sticky notes list before the notes; with no sticky windows open, it's the only result there, instead of "No sticky notes".

- Title and subtitle: for one note, "Reopen “\<title>”" and "Put the sticky note back on the desktop"; for several, "Reopen sticky notes" and their titles, last edited first: "A and B", "A, B and C", or "A, B and 2 more" (`listedTitles`). The icon is the sticky note's.
- ↩ reopens them all (`stickies.js reopen`). The item's arg is empty and it sets `sticky_action` to `reopen`. In the sticky notes list, the Conditional on `sticky_action` sends that to `stickies.js`. In the results list, ↩ also reaches the quick view's Alfred UI object, which shows nothing for an empty path, and the Conditional on `sticky`, which has a second condition, `sticky_action` is `reopen`, to `stickies.js`.
- ⌘↩, "Leave it closed" / "Leave them closed", sets `sticky_action` to `forget`, so they're no longer offered. ⌘ in the sticky notes list goes straight to `stickies.js "$sticky_action"`; in the results list it goes to the stick route, where `open.js` sees `forget`, forgets them and opens nothing. ⌥ is taken by Move to Trash in both lists, so ⌘ is the free key.
- ⌥↩ and ⌃↩ do nothing (`valid: false`).

It costs the lists almost nothing: `list.js` already reads every state file to mark the sticky notes, and the same pass (`noteWindowStates`) finds the notes to reopen; their notes are only read when there are some.

## Creating notes

Every route creates a new note the same way: it opens before it's saved, with its starting text, and is saved when its window saves (a pause in typing, a switch to Preview, sticking, or closing). Even a quick view opened while Alfred's window is hidden fires `quit` with its text, so text from elsewhere is only lost if the window's process crashes. The exception is a new note opened sticky: `open.js` saves its starting text (unless blank) as the window opens, so it's in both lists while the window is open.

**The new-note keyword**, a Script Filter on `{var:keyword_new}` (`newscratch` by default), run by `scripts/new.js`. `newscratch buy milk` gives **New note: buy milk**, whether or not a note matches. `newscratch` alone gives **New note**, then **New note from clipboard** when the clipboard has text, with that text on one line as its subtitle. They behave as New note in the results list (`newNoteResult`): ↩ opens a quick view, seamlessly (the Script Filter connects straight to the quick view's Alfred UI object, with a bundle `new.js` writes first), and ⌘↩ sticks it. The two new notes get their own IDs and bundles (the second has `-2`).

**The new sticky note keyword**, `{var:keyword_new_sticky}` (`newsticky` by default), runs `exec ./scripts/new.js "$1" sticky`: the same results, titled "New sticky note…", with the keys swapped. ↩ goes to the stick route and ⌘↩ ("Create it in Alfred instead") to the quick view's Alfred UI object; ⌘ clears the variable `new` so it doesn't carry into the quick view.

**From the clipboard**: offered only when the clipboard has plain text that isn't only whitespace (rich text gives its plain version), and not when it also holds files copied in Finder, or is marked concealed or transient (`org.nspasteboard.ConcealedType`, `org.nspasteboard.TransientType`), such as a password manager's, as Alfred's clipboard history also skips (`clipboardText` in `lib.js`). The text is kept exactly as copied.

**Universal Actions**, "New scratch note" and "New sticky note", on text and URLs (one item each), covering the macOS selection and Alfred's clipboard history:

- New scratch note → Run Script `new=1 ./scripts/open.js quick "$1"` → the quick view's Alfred UI object. Alfred's window is showing while an action is chosen, so the quick view opens and stays; the Run Script in between makes Alfred fade it in, which is fine here.
- New sticky note → Run Script `new=1 ./scripts/open.js stick "$1"` → the stick route's Conditional.

**Keywords aren't Universal Actions.** All four Script Filters have "Treat Input as Universal Action" switched off (`skipuniversalaction`), so Alfred's action list shows only the two Universal Actions rather than also "New Scratch'n'Stick note" and a search of the notes for the selection.

**A hotkey for a new note**, unset by default: Hotkey → Arg and Vars (empty arg, `new` = `1`) → the stick route. A quick view only works while Alfred's window is showing, so a hotkey from another app opens the new note sticky.

### Text as a heading

Text that starts a new note (typed after a keyword, from the clipboard, or from a Universal Action) is usually a heading, so text that reads as one starts the note as `# <text>`, an empty line, and the caret on the body's line. Any other text is kept exactly as given.

Text reads as a heading when, once trimmed, it's one line of at most `HEADING_MAX_LENGTH` (60) characters that isn't a sentence (no sentence break, and no final full stop, though `...` and `?` are fine), doesn't start with Markdown block syntax (`#`, a bullet or number, `>`, a code fence, `|`, a thematic break), and isn't a URL, email address or file path. A trailing colon is dropped: "Things to buy:" gives `# Things to buy`.

Typed text's result says which it will be: "Create a note with this heading" or "Create a note with this text" (`newNoteSubtitle`). There's no key to keep the text as typed: deleting `# ` takes a moment, and the modifiers are taken.

It's `newNoteText` in `scripts/text-rules.js`, applied wherever a new note's text is set (`quickWindows`' `bundleForNew` for ↩, `open.js` with `new` for ⌘↩ and the Universal Actions), so every route agrees.
