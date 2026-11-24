#!/usr/bin/osascript -l JavaScript

// Script Filter for the ScratchNotes keyword: lists the notes, last edited
// first, narrowed by argv[0], the text typed after the keyword.
//
// Every word of the query must appear somewhere in a note (its title or any
// of its text), ignoring case and accents. With no query, a "New note" result
// comes first; with a query that matches no note, the only result is
// "New note: <query>", which creates a note with that text.
//
// Each result's arg is its quick view's bundle, which ↩ opens inside Alfred
// with nothing in between, so the view replaces the results seamlessly. The
// bundles are written here, before the results are shown, and only rebuilt
// when out of date (see quickWindows in lib.js). ⌘↩ pins the note (open.js;
// that modifier's arg is the note's ID), ⌥↩ moves it to the Trash (trash.js),
// ⌃↩ reveals it in Finder (its path is that modifier's arg), and Quick Look
// shows the file.

ObjC.import("Foundation");

function run(argv) {
  const workflowFolder = $(loadLib(argv, "lib.js")).stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.js;
  const query = (argv[0] || "").trim();
  let store, notes;
  try {
    store = noteStore();
    notes = store.list();
  } catch (e) {
    return output([{ title: "Can't open the notes folder", subtitle: e.message, valid: false }]);
  }
  const quick = attempt(() => quickWindows(store, workflowFolder));
  const bundle = (make) => (quick ? attempt(make) || "" : "");
  const words = searchWords(query);
  const matches = notes.filter((note) => words.every((word) => searchText(note).includes(word)));
  const now = new Date();
  const items = matches.map((note) => noteItem(note, now, bundle(() => quick.bundleFor(note))));
  if (!query) items.unshift(newNoteItem("New note", "Create a blank note", "", bundle(() => quick.bundleForNew(""))));
  else if (items.length === 0) items.push(newNoteItem(`New note: ${query}`, "Create a note with this text", query, bundle(() => quick.bundleForNew(query))));
  if (quick) attempt(() => quick.finish(notes));
  return output(items);
}

// What `fn` returns, or null if it throws, logging the error (to Alfred's
// debugger). A quick bundle that can't be written leaves its result's arg
// empty, so ↩ does nothing, while the list and the other keys still work.
function attempt(fn) {
  try {
    return fn();
  } catch (e) {
    console.log(`Quick view bundles: ${e.message}`);
    return null;
  }
}

function noteItem(note, now, bundle) {
  const edited = `Edited ${formatEditedTime(note.modified, now)}`;
  return {
    title: note.title,
    subtitle: note.preview ? `${edited} · ${note.preview}` : edited,
    arg: bundle,
    quicklookurl: note.path,
    action: { file: note.path },
    text: { copy: note.text, largetype: note.text },
    mods: {
      cmd: { subtitle: "Pin to the desktop", arg: note.id },
      alt: { subtitle: "Move to the Trash", arg: note.id },
      ctrl: { subtitle: "Reveal in Finder", arg: note.path },
    },
  };
}

// Its arg is the bundle of a quick view of a new note starting with `text`.
// ⌘'s arg is the text itself, so the variable `new` tells open.js it isn't a
// note's ID. ⌥ and ⌃ do nothing: their actions take a note's ID or path.
function newNoteItem(title, subtitle, text, bundle) {
  const variables = { new: "1" };
  return {
    title,
    subtitle,
    arg: bundle,
    mods: {
      cmd: { subtitle: "Create it pinned to the desktop", arg: text, variables },
      alt: { subtitle, valid: false },
      ctrl: { subtitle, valid: false },
    },
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
