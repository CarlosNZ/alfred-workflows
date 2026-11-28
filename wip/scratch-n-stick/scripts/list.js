#!/usr/bin/osascript -l JavaScript

// Script Filter for the Scratch'n'Stick keyword: lists the notes, last edited
// first, narrowed by argv[0], the text typed after the keyword. With argv[1]
// "stickies", for the sticky notes keyword, it lists only the sticky notes,
// those open on the desktop and then those closed (see stickiesListItems).
//
// A note is sticky while its sticky window is open, and closed sticky while
// its sidecar's `sticky` is true without one (from when it's stuck until it's
// unstuck; see window.js). In the results list, ↩ on either sticks it (or
// brings its window to the front), and ⌘↩ closes it or unsticks it (see
// notesListItem).
//
// Every word of the query must appear somewhere in a note (its title or any
// of its text), ignoring case and accents. With no query, a "New note" result
// comes first, unless the `show_new_note` checkbox is off; with a query that
// matches no note, the only result is "New note: <query>", which creates a
// note with that text.
//
// Each result's arg is its quick view's bundle, which ↩ opens inside Alfred
// with nothing in between, so the view replaces the results seamlessly. The
// bundles are written here, before the results are shown, and only rebuilt
// when out of date (see quickWindows in lib.js), and so is the stylesheet that
// gives their pages the colour of Alfred's theme. ↩ on a note that's sticky
// sticks it, or brings its sticky window to the front, instead (see
// notesListItem). ⌘↩ sticks the note, or closes or unsticks a sticky one
// (open.js; that modifier's arg is the note's ID), ⌥↩ moves it to the Trash
// (trash.js), ⌃↩ reveals it in Finder (its path is that modifier's arg), and
// Quick Look shows the file.
//
// With no query, both lists start with "Reopen sticky notes" while there are
// notes whose sticky windows were closed by a restart, shutdown or logout, or
// ended without closing (see reopenItem, and "Reopening sticky notes" in
// lib.js).
//
// The first run each day also sweeps away the sidecars, sticky window bundles
// and saved window frames of notes that have been gone a long time
// (sweepSidecarsDaily in lib.js), and the first run of
// all adds the example notes (installExamplesOnce).

ObjC.import("Foundation");

// Separates the parts of a note's subtitle: when it was edited, and its
// preview.
const SUBTITLE_SEPARATOR = " • ";

// What starts a sticky note's subtitle, followed by a space: in the results
// list, the pin for a sticky note, open or closed, and the sleep sign for a
// closed one; in the sticky notes list, where every note is sticky, only the
// sleep sign.
const STICKY_MARK = "📌";
const CLOSED_MARK = "💤";

function run(argv) {
  const workflowFolder = $(loadLib(argv, "lib.js")).stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.js;
  loadLib(argv, "text-rules.js");
  const query = (argv[0] || "").trim();
  const stickiesOnly = argv[1] === "stickies";
  // A colour in User Configuration that can't be read shows what's wrong in
  // place of the list, as every result and window needs the palette.
  const paletteProblems = notePaletteProblemItems();
  if (paletteProblems.length) return output(paletteProblems);
  const windows = windowStates();
  const sticky = windows.open;
  let store, notes, reopen;
  try {
    // The notes may have to move to a newly configured folder first.
    const move = checkNotesFolderMove({ workflowFolder, showFailure: true });
    if (move.status !== "ready") return notesFolderMoveOutput(move, { canReveal: true });
    store = noteStore();
    // The first run adds the example notes.
    attempt(() => installExamplesOnce(store, workflowFolder));
    notes = store.list();
    reopen = query || windows.reopen.size === 0 ? [] : attempt(() => reopenNotes(store)) || [];
  } catch (e) {
    return output([notesFolderErrorItem(e)]);
  }
  // Once a day, the sidecars of notes gone a long time are deleted.
  attempt(() => sweepSidecarsDaily(store));
  const words = searchWords(query);
  const matches = notes.filter((note) => words.every((word) => searchText(note).includes(word)));
  const now = new Date();
  // Each variable is read once (see cachedVariables in lib.js).
  const variable = cachedVariables();
  const icon = (note) => attempt(() => noteResultIcon(workflowFolder, note, noteColour(note.meta, variable), variable));
  const item = (note) => noteItem(note, now, icon(note));
  const reopenResult = reopen.length ? reopenItem(reopen) : null;
  if (stickiesOnly) {
    const closedCount = notes.filter((note) => isClosedSticky(note, sticky)).length;
    const open = matches.filter((note) => sticky.has(note.id));
    const closed = matches.filter((note) => isClosedSticky(note, sticky));
    const listed = open.map((note) => stickiesListItem(note, item(note), true)).concat(closed.map((note) => stickiesListItem(note, item(note), false)));
    const items = stickiesListItems(listed, query, sticky.size, sticky.size + closedCount, variable);
    return output(reopenResult ? [reopenResult, ...(sticky.size + closedCount ? items : [])] : items);
  }

  const quick = attempt(() => quickWindows(store, workflowFolder));
  // Quick views' pages take their colour from Alfred's theme, which Alfred
  // gives a Script Filter (see noteThemeStylesheet in lib.js).
  attempt(() => writeNoteTheme(workflowVariable("alfred_theme_background")));
  const bundle = (make) => (quick ? attempt(make) || "" : "");
  const items = matches.map((note) => notesListItem(note, item(note), bundle(() => quick.bundleFor(note)), sticky.has(note.id), isClosedSticky(note, sticky)));
  if (!query && showNewNote(variable)) items.unshift(newNoteResult("New note", "Create a blank note", "", bundle(() => quick.bundleForNew(""))));
  else if (items.length === 0) items.push(newNoteResult(`New note: ${query}`, newNoteSubtitle(query), query, bundle(() => quick.bundleForNew(query))));
  if (reopenResult) items.unshift(reopenResult);
  if (quick) attempt(() => quick.finish(notes));
  return output(items);
}

// Whether the list starts with New note when there's no query: the
// `show_new_note` checkbox, on unless it's unticked ("0"). A query that
// matches no note offers New note: <query> either way, as the only result.
function showNewNote(variable) {
  return variable("show_new_note") !== "0";
}

// The sticky windows' states (noteWindowStates in lib.js): { open, reopen },
// the IDs of the notes with a sticky window and of those to reopen, or none
// if they can't be read. The variable `scratchnstick_sticky_ids`, IDs one per
// line, stands in for the open ones, for dev/test-list.sh, which can't open
// sticky windows.
function windowStates() {
  const states = attempt(noteWindowStates) || { open: new Set(), reopen: new Set() };
  const ids = workflowVariable("scratchnstick_sticky_ids");
  if (ids) states.open = new Set(ids.split("\n").filter(isNoteId));
  return states;
}

// Reopen sticky notes, first in both lists with no query, for `notes`, the
// notes to reopen (reopenNotes in lib.js): ↩ goes to stickies.js with
// `sticky_action` "reopen" and an empty arg, through the Conditional on that
// variable (in the notes list, the quick view's Alfred UI object gets the
// empty arg too, and shows nothing). ⌘↩ leaves the notes closed, through
// stickies.js from the sticky notes list and open.js from the notes list,
// where ⌘ goes. ⌥ and ⌃ do nothing.
function reopenItem(notes) {
  const one = notes.length === 1;
  const subtitle = one ? "Put the sticky note back on the desktop" : listedTitles(notes.map((note) => note.title));
  const none = { subtitle, valid: false };
  return {
    title: one ? `Reopen “${notes[0].title}”` : "Reopen sticky notes",
    subtitle,
    arg: "",
    icon: { path: "icons/note.png" },
    variables: { sticky_action: "reopen" },
    mods: {
      cmd: { subtitle: one ? "Leave it closed" : "Leave them closed", arg: "", variables: { sticky_action: "forget" } },
      alt: none,
      ctrl: none,
    },
  };
}

// "A", "A and B", "A, B and C", or "A, B and 2 more".
function listedTitles(titles) {
  if (titles.length <= 3) return titles.length === 1 ? titles[0] : `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
  return `${titles.slice(0, 2).join(", ")} and ${titles.length - 2} more`;
}

// What `fn` returns, or null if it throws, logging the error (to Alfred's
// debugger). A quick bundle that can't be written leaves its result's arg
// empty, so ↩ does nothing, and a result icon that can't be made leaves its
// result without one, while the list and the other keys still work.
function attempt(fn) {
  try {
    return fn();
  } catch (e) {
    console.log(e.message);
    return null;
  }
}

// A note's result as both lists have it, with no arg and no ⌘: its title, its
// subtitle (when it was edited, and its preview), its icon (`icon`: its badge
// or its dot, from noteResultIcon in lib.js, or none if that couldn't be
// made), ⌥ and ⌃, and the file for Quick Look, ⌘C, ⌘L and Alfred's file
// actions.
function noteItem(note, now, icon) {
  const edited = `Edited ${formatEditedTime(note.modified, now)}`;
  return {
    title: note.title,
    subtitle: note.preview ? `${edited}${SUBTITLE_SEPARATOR}${note.preview}` : edited,
    icon: icon ? { path: icon } : undefined,
    quicklookurl: note.path,
    action: { file: note.path },
    text: { copy: note.text, largetype: note.text },
    mods: {
      alt: { subtitle: "Move to the Trash", arg: note.id },
      ctrl: { subtitle: "Reveal in Finder", arg: note.path },
    },
  };
}

// Whether `note` is a closed sticky note: its sidecar says it's sticky, and
// its ID isn't among `open`, the notes with a sticky window.
function isClosedSticky(note, open) {
  return note.meta.sticky === true && !open.has(note.id);
}

// A note's result in the notes list, from `base` (noteItem): ↩ opens
// `bundle`, its quick view, and ⌘↩ sticks it. A sticky note, `open` (its
// window is open) or `closed`, has its subtitle marked (📌, and 💤 if closed)
// and gets no arg, so ↩ shows no quick view, and the variable `sticky`, which
// takes ↩ down the stick route instead (with `stick_note` naming the note, as
// Stick in a quick view does), where open.js sticks the note, or brings its
// window to the front. On a sticky note, ⌘↩ goes down the stick route with
// `sticky_action` set, as in the sticky notes list: it closes an open one's
// window ("close"), and unsticks a closed one ("unstick").
function notesListItem(note, base, bundle, open, closed) {
  const cmd = open
    ? { subtitle: "Close this sticky note", arg: note.id, variables: { sticky_action: "close" } }
    : closed
      ? { subtitle: "Unstick", arg: note.id, variables: { sticky_action: "unstick" } }
      : { subtitle: "Stick to the desktop", arg: note.id };
  if (!open && !closed) return { ...base, arg: bundle, mods: { ...base.mods, cmd } };
  return {
    ...base,
    subtitle: `${closed ? `${STICKY_MARK}${CLOSED_MARK}` : STICKY_MARK} ${base.subtitle}`,
    arg: "",
    variables: { sticky: "1", stick_note: escapeForAlfredUi(note.id) },
    mods: { ...base.mods, cmd },
  };
}

// A note's result in the sticky notes list, from `base` (noteItem), its
// window `open` or not: ↩ takes the note's ID down the stick route, as ⌘↩ in
// the notes list does, where open.js brings its window to the front, or
// opens it. ⌘↩ closes its window (stickies.js close), or, for a closed note
// (its subtitle marked 💤), unsticks it (stickies.js unstick).
function stickiesListItem(note, base, open) {
  const close = { subtitle: "Close this sticky note", arg: note.id, variables: { sticky_action: "close" } };
  const unstick = { subtitle: "Unstick", arg: note.id, variables: { sticky_action: "unstick" } };
  return {
    ...base,
    subtitle: open ? base.subtitle : `${CLOSED_MARK} ${base.subtitle}`,
    arg: note.id,
    mods: { ...base.mods, cmd: open ? close : unstick },
  };
}

// The sticky notes list: `items`, the matching notes' results, then, while
// any are open, Show all and Close all sticky notes, last whatever the query,
// which act on all `openCount` sticky windows, not only those listed. A
// sticky window whose note hasn't been saved yet (a blank new note, with
// nothing typed yet) has no result, but is counted, shown and closed. With no
// sticky notes at all (`total`, open and closed), the only result says so.
function stickiesListItems(items, query, openCount, total, variable) {
  const keyword = variable("keyword") || "scratch";
  if (total === 0) return [{ title: "No sticky notes", subtitle: `Stick a note to the desktop with ⌘↩ in “${keyword}”`, valid: false }];
  if (items.length === 0 && query) {
    items.push({ title: `No sticky notes match “${query}”`, subtitle: `Search all your notes with “${keyword}”`, valid: false });
  }
  if (openCount === 0) return items;
  const notes = openCount === 1 ? "the sticky note" : `the ${openCount} sticky notes`;
  return items.concat(
    allStickiesItem("Show all sticky notes", `Bring ${notes} on the desktop to the front`, "show"),
    allStickiesItem("Close all sticky notes", `Close ${notes} on the desktop`, "close"),
  );
}

// Show all or Close all sticky notes: ↩ goes to stickies.js with the command
// `action` in the variable `sticky_action` and an empty arg, through the
// Conditional on that variable, which keeps it off the stick route, where the
// notes' ↩ goes. The modifiers do nothing.
function allStickiesItem(title, subtitle, action) {
  const none = { subtitle, valid: false };
  return {
    title,
    subtitle,
    arg: "",
    variables: { sticky_action: action },
    mods: { cmd: none, alt: none, ctrl: none },
  };
}

// The query's words, folded for matching (see foldForSearch).
function searchWords(query) {
  return foldForSearch(query).split(/\s+/).filter(Boolean);
}

function searchText(note) {
  if (note.searchText === undefined) note.searchText = foldForSearch(`${note.title}\n${note.text}`);
  return note.searchText;
}

// Lower case without accents, so "cafe" finds "Café".
function foldForSearch(text) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// How long ago a note was edited: "just now", "5m ago", "3h ago", "2d ago",
// then the date ("12 Nov", with the year if it's not this year), in the
// Mac's date format.
function formatEditedTime(date, now) {
  const minutes = Math.floor((now - date) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / (24 * 60))}d ago`;
  const options = { day: "numeric", month: "short" };
  if (date.getFullYear() !== now.getFullYear()) options.year = "numeric";
  return date.toLocaleDateString(undefined, options);
}

// The items have no uid, so Alfred keeps them in this order: a uid would let
// its learning move notes chosen often above New note and above more recently
// edited notes. A uid is only worth adding with `rerun`, to keep the selection
// on the same item, and would then need `skipknowledge: true`.
function output(items) {
  return JSON.stringify({ items });
}

// Runs lib.js from this script's own folder, wherever the script is run from
// (JXA has no require). See "Loading lib.js" in DEVELOPMENT.md.
function loadLib(argv, relativePath) {
  const args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments);
  let script = args[args.length - argv.length - 1];
  if (!script.startsWith("/")) script = `${$.NSFileManager.defaultManager.currentDirectoryPath.js}/${script}`;
  const path = $(script).stringByDeletingLastPathComponent.stringByAppendingPathComponent(relativePath).stringByStandardizingPath.js;
  const source = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  if (source.isNil()) throw new Error(`Can't load ${path}`);
  (0, eval)(source.js);
  return path;
}
