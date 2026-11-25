#!/usr/bin/osascript -l JavaScript

// Script Filter for the Scratch'n'Stick keyword: lists the notes, last edited
// first, narrowed by argv[0], the text typed after the keyword. With argv[1]
// "stickies", for the sticky notes keyword, it lists only the notes that are
// sticky (see stickiesListItems).
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
// brings its sticky window to the front instead (see notesListItem). ⌘↩
// sticks the note (open.js; that modifier's arg is the note's ID), ⌥↩ moves
// it to the Trash (trash.js), ⌃↩ reveals it in Finder (its path is that
// modifier's arg), and Quick Look shows the file.

ObjC.import("Foundation");

// Separates the parts of a note's subtitle: "Sticky", when it was edited, and
// its preview.
const SUBTITLE_SEPARATOR = " • ";

function run(argv) {
  const workflowFolder = $(loadLib(argv, "lib.js")).stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.js;
  loadLib(argv, "titles.js");
  const query = (argv[0] || "").trim();
  const stickiesOnly = argv[1] === "stickies";
  // A colour in User Configuration that can't be read shows what's wrong in
  // place of the list, as every result and window needs the palette.
  const paletteProblems = notePaletteProblemItems();
  if (paletteProblems.length) return output(paletteProblems);
  const sticky = stickyIds();
  let store, notes;
  try {
    // The notes may have to move to a newly configured folder first.
    const move = checkNotesFolderMove({ workflowFolder, showFailure: true });
    if (move.status !== "ready") return notesFolderMoveOutput(move);
    store = noteStore();
    notes = store.list(stickiesOnly ? { ids: sticky } : {});
  } catch (e) {
    return output([notesFolderErrorItem(e)]);
  }
  const words = searchWords(query);
  const matches = notes.filter((note) => words.every((word) => searchText(note).includes(word)));
  const now = new Date();
  // Each variable is read once (see cachedVariables in lib.js).
  const variable = cachedVariables();
  const icon = (note) => attempt(() => noteResultIcon(workflowFolder, note, noteColour(note.meta, variable), variable));
  const item = (note) => noteItem(note, now, icon(note));
  if (stickiesOnly) return output(stickiesListItems(matches.map((note) => stickiesListItem(note, item(note))), query, sticky.size, variable));

  const quick = attempt(() => quickWindows(store, workflowFolder));
  // Quick views' pages take their colour from Alfred's theme, which Alfred
  // gives a Script Filter (see noteThemeStylesheet in lib.js).
  attempt(() => writeNoteTheme(workflowVariable("alfred_theme_background")));
  const bundle = (make) => (quick ? attempt(make) || "" : "");
  const items = matches.map((note) => notesListItem(note, item(note), bundle(() => quick.bundleFor(note)), sticky.has(note.id)));
  if (!query && showNewNote(variable)) items.unshift(newNoteResult("New note", "Create a blank note", "", bundle(() => quick.bundleForNew(""))));
  else if (items.length === 0) items.push(newNoteResult(`New note: ${query}`, newNoteSubtitle(query), query, bundle(() => quick.bundleForNew(query))));
  if (quick) attempt(() => quick.finish(notes));
  return output(items);
}

// Whether the list starts with New note when there's no query: the
// `show_new_note` checkbox, on unless it's unticked ("0"). A query that
// matches no note offers New note: <query> either way, as the only result.
function showNewNote(variable) {
  return variable("show_new_note") !== "0";
}

// The IDs of the notes that have a sticky window (stickyNoteIds in lib.js),
// or none if they can't be read. The variable `scratchnstick_sticky_ids`, IDs
// one per line, stands in for them, for dev/test-list.sh, which can't open
// sticky windows.
function stickyIds() {
  const ids = workflowVariable("scratchnstick_sticky_ids");
  if (ids) return new Set(ids.split("\n").filter(isNoteId));
  return attempt(stickyNoteIds) || new Set();
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

// A note's result in the notes list, from `base` (noteItem): ↩ opens
// `bundle`, its quick view, and ⌘↩ sticks it. A note that's sticky gets no
// arg, so ↩ shows no quick view, and the variable `sticky`, which takes ↩
// down the stick route instead (with `stick_note` naming the note, as Stick in
// a quick view does), where open.js brings the sticky window to the front.
function notesListItem(note, base, bundle, sticky) {
  return {
    ...base,
    subtitle: sticky ? `Sticky${SUBTITLE_SEPARATOR}${base.subtitle}` : base.subtitle,
    arg: sticky ? "" : bundle,
    variables: sticky ? { sticky: "1", stick_note: escapeForAlfredUi(note.id) } : undefined,
    mods: { ...base.mods, cmd: { subtitle: "Stick to the desktop", arg: note.id } },
  };
}

// A note's result in the sticky notes list, from `base` (noteItem): ↩ takes
// the note's ID down the stick route, as ⌘↩ in the notes list does, where
// open.js brings its window to the front (or opens it again, if it has closed
// after the list was shown), and ⌘↩ closes its window (close.js).
function stickiesListItem(note, base) {
  return {
    ...base,
    arg: note.id,
    mods: { ...base.mods, cmd: { subtitle: "Close this sticky note", arg: note.id } },
  };
}

// The sticky notes list: `items`, the matching notes' results, then Close all
// sticky notes, last whatever the query, which closes all `count` sticky
// windows, not only those listed. A sticky window whose note hasn't been
// saved yet (a blank new note, with nothing typed yet) has no result, but is
// counted and closed. With no sticky windows, the only result says so.
function stickiesListItems(items, query, count, variable) {
  const keyword = variable("keyword") || "scratch";
  if (count === 0) return [{ title: "No sticky notes", subtitle: `Stick a note to the desktop with ⌘↩ in “${keyword}”`, valid: false }];
  if (items.length === 0 && query) {
    items.push({ title: `No sticky notes match “${query}”`, subtitle: `Search all your notes with “${keyword}”`, valid: false });
  }
  return items.concat(closeAllItem(count));
}

// Close all sticky notes: ↩ goes to close.js with an empty arg, through the
// Conditional on `close_all` that keeps it off the stick route, where the
// notes' ↩ goes. The modifiers do nothing.
function closeAllItem(count) {
  const subtitle = count === 1 ? "Close the sticky note on the desktop" : `Close the ${count} sticky notes on the desktop`;
  const none = { subtitle, valid: false };
  return {
    title: "Close all sticky notes",
    subtitle,
    arg: "",
    variables: { close_all: "1" },
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
// (JXA has no require). See "Loading lib.js" in DESIGN.md.
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
