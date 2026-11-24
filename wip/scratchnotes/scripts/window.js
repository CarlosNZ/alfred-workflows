#!/usr/bin/osascript -l JavaScript

// The note window's actions, run by its Alfred UI events (see ui/):
//
//   window.js launched <id> <form> <mode>   the window opened: records its state
//   window.js save <id> <form> <text>       typing stopped: saves the text
//   window.js toggle <id> <form> <text>     ⌘E or the Edit / View button
//   window.js edit <id> <form> <text>       ↩ in View: to Edit
//   window.js view <id> <form> <text>       ⌘↩ in Edit: saves, to View
//   window.js colour <id> <form> <colour>   the colour menu or ⌘1 to ⌘6
//   window.js tick <id> <form> <line> <x|o> a task box in View: ticks (x) or
//                                           unticks (o) the task on that line
//                                           (from scripts/changed.sh)
//   window.js quit <id> <form> <text>       the window closed: saves, and
//                                           deletes the note if it's empty
//
// <form> is "quick" or "pinned", which says which bundle the window opened
// from (see "Note windows" in lib.js).
//
// <text> is the editor's text ({value:editor.text}). The editor stays in the
// window in View mode, hidden, with the text it had when it was last shown (or
// none), so the mode comes from the window's state, and nothing is saved from
// View mode, where the file is already up to date (switching to View saves
// first). Text and IDs arrive escaped as they were in the window (see
// escapeForAlfredUi in lib.js).
//
// In a quick view these run inside Alfred's own process, which waits for them,
// so nothing here may wait on Alfred (an AppleEvent to Alfred would deadlock).
// The window's scripts get the alfred_* variables but not User Configuration,
// so the notes folder and the window's look come from the context written into
// the note's bundle (by list.js for a quick view, by open.js when pinned).

ObjC.import("Foundation");
ObjC.import("unistd");

function run(argv) {
  const workflowFolder = $(loadLib(argv, "lib.js")).stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.js;
  const [command, escapedId, form, ...rest] = argv;
  const id = unescapeFromAlfredUi(escapedId || "");
  if (form !== "quick" && form !== "pinned") throw new Error(`Unknown form: ${form}`);
  const context = readNoteContext(id, form);
  if (!context) throw new Error(`No window context for ${JSON.stringify(id)}`);
  const store = noteStore(context.folder);
  switch (command) {
    case "launched":
      return launched(store, workflowFolder, context, id, form, rest[0]);
    case "save":
      save(store, id, form, unescapeFromAlfredUi(rest[0] || ""));
      return;
    case "toggle":
    case "edit":
    case "view":
      return switchMode(store, workflowFolder, context, id, form, unescapeFromAlfredUi(rest[0] || ""), command === "toggle" ? null : command);
    case "quit":
      quit(store, id, form, unescapeFromAlfredUi(rest[0] || ""));
      return;
    case "colour":
      return setColour(store, workflowFolder, context, id, form, rest[0]);
    case "tick":
      return tick(store, context, id, form, Number(rest[0]), rest[1]);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// The window has opened. Records its state, except in a quick view of a note
// that's already pinned: that view finishes as Pin does, carrying on to the
// pin route, which brings the pinned window to the front, so a note is never
// open in two windows. (↩ on a pinned note doesn't open a quick view at all,
// so this only catches a note pinned after the results were listed; see
// noteItem in list.js.) And if a quick view's note has changed since list.js
// wrote its bundle (an edit elsewhere just before ↩), it shows the note as it
// is now, so a stale text can't be saved over it: in the editor, or by
// reloading the page.
function launched(store, workflowFolder, context, id, form, mode) {
  if (form === "quick" && pinnedNotePid(id) !== null) {
    return JSON.stringify({ finish: { variables: { pin_note: escapeForAlfredUi(id) } } });
  }
  writeNoteState(id, { form, pid: $.getppid(), mode });
  const note = form === "quick" ? store.read(id) : null;
  if (!note || textHash(note.text) === context.textHash) return;
  if (mode === "edit") {
    updateNoteContext(id, form, { textHash: textHash(note.text) });
    return JSON.stringify({ update: { ids: { editor: { text: escapeForAlfredUi(note.text) } } } });
  }
  return JSON.stringify({ update: { ids: { web: { src: writeNotePage(id, form, note.text) } } } });
}

// Typing has stopped: saves the editor's text, if it's the editor's (see
// isEditorText). The event fires about a second after the last keystroke, so
// it can come after a switch to View, which has already saved the text.
function save(store, id, form, text) {
  if (isEditorText(readNoteState(id), form, text)) store.save(id, text);
}

// Switches the window to mode `to` ("edit" or "view"), or to the other mode
// when `to` is null, through the saved file. Both modes are in the window all
// the time (see "Note windows" in lib.js), so it prints an update: to Edit, it
// fades the web view out and shows the editor, with the file's text and the
// caret at its end; to View, it saves the editor's text, hides the editor and
// reloads the web view's page with the file's text (the page has the web view
// shown once it has drawn; see scripts/changed.sh). The toggle button changes
// its symbol and tooltip. It also remembers the mode in the note's sidecar, so
// the note reopens in it. Does nothing when the window is already in mode
// `to` (⌘↩ is a shortcut of the whole window, so it also reaches this in View
// mode), or when it has no state of its form (its `launched` failed, or it
// handed over to a pinned window), since then its mode is unknown.
function switchMode(store, workflowFolder, context, id, form, text, to) {
  const state = readNoteState(id);
  if (!state || state.form !== form) return;
  const from = state.mode === "view" ? "view" : "edit";
  if (to === from) return;
  if (from === "edit") store.save(id, text);
  const mode = from === "edit" ? "view" : "edit";
  const note = store.read(id);
  const current = note ? note.text : "";
  const toprow = noteWindowPart({ workflowFolder, id, form, mode, fontSize: context.fontSize, colour: context.colour }, "toprow");
  const { image, tooltip, accessibility } = findNoteComponent(toprow, "toggle");
  const ids = { toggle: { image, tooltip, accessibility } };
  if (mode === "edit") {
    Object.assign(ids, { web: { opacity: 0 }, editor: { hidden: false, text: escapeForAlfredUi(current), focus: true } });
  } else {
    Object.assign(ids, { editor: { hidden: true }, web: { src: writeNotePage(id, form, current) } });
  }
  writeNoteState(id, Object.assign(state, { mode }));
  store.updateMeta(id, { mode });
  return JSON.stringify({ update: { ids } });
}

// Gives the note the palette colour named `name`: records it in the note's
// sidecar (which works for a new note that isn't saved yet) and in the
// window's context, so what the window's scripts give it later matches, and
// prints the replace action for the top row, whose dot and menu show the
// colour. A pinned window's tint has already been updated by the action that
// ran this (see noteColourAction in lib.js), but its page covers it, so in
// View the page is reloaded with the new tint too. Does nothing without a
// state of the window's form, as for switchMode, since the top row depends on
// the mode.
function setColour(store, workflowFolder, context, id, form, name) {
  if (!notePaletteColour(name)) throw new Error(`Unknown colour: ${name}`);
  const state = readNoteState(id);
  if (!state || state.form !== form) return;
  store.updateMeta(id, { colour: name });
  updateNoteContext(id, form, { colour: name });
  const mode = state.mode === "view" ? "view" : "edit";
  const toprow = noteWindowPart({ workflowFolder, id, form, mode, fontSize: context.fontSize, colour: name }, "toprow");
  const action = { replace: { ids: { toprow } } };
  if (form === "pinned" && mode === "view") {
    const note = store.read(id);
    action.update = { ids: { web: { src: writeNotePage(id, form, note ? note.text : "") } } };
  }
  return JSON.stringify(action);
}

// A task box was clicked in the page: ticks the task on `line` (counting from
// 0) when `to` is "x", unticks it when "o". The page has already changed its
// box, so this prints nothing, but it rewrites the page's note.js, so a later
// reload shows the tick. It only changes the note if it still has the text the
// page was given (the hash in the window's context) and the line is still a
// task box in the other state; otherwise the note has changed under the page
// (an edit elsewhere), so it reloads the page with the note as it is now.
// Does nothing without a View state of the window's form.
function tick(store, context, id, form, line, to) {
  if (to !== "x" && to !== "o") throw new Error(`Unknown tick: ${to}`);
  const state = readNoteState(id);
  if (!state || state.form !== form || state.mode !== "view") return;
  const note = store.read(id);
  const text = note ? note.text : "";
  const ticked = note && textHash(text) === context.textHash ? toggleNoteTask(text, line, to === "x") : null;
  if (ticked === null) return JSON.stringify({ update: { ids: { web: { src: writeNotePage(id, form, text) } } } });
  store.save(id, ticked);
  writeNotePage(id, form, ticked);
}

// The window has closed. Saves the editor's text (see isEditorText), then
// deletes the note, with its window bundles, if it's empty or was never saved.
// A state of the other form is another window's: this was a quick view that
// handed over to the note's pinned window (see launched), so it leaves
// everything alone.
function quit(store, id, form, text) {
  const state = readNoteState(id);
  if (state && state.form !== form) return;
  if (isEditorText(state, form, text)) store.save(id, text);
  removeNoteState(id);
  if (store.deleteIfEmpty(id)) removeNoteBundle(id);
}

// Whether `text`, a window's {value:editor.text}, is its editor's text, and so
// can be saved: only in Edit mode, since in View the editor is hidden and has
// the text it was last shown with, which ticks may have changed since. With no
// state (the window's `launched` failed), the mode is unknown, so only
// non-blank text counts (a window that opens in View has an empty editor). A
// state of the other form is another window's.
function isEditorText(state, form, text) {
  if (!state) return !isBlankText(text);
  return state.form === form && state.mode === "edit";
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
