#!/usr/bin/osascript -l JavaScript

// The note window's actions, run by its Alfred UI events (see ui/):
//
//   window.js launched <id> <form> <mode>   the window opened: records its state
//   window.js save <id> <form> <text>       typing stopped: saves the text
//   window.js toggle <id> <form> <text>     ⌘E or the Edit / View button
//   window.js quit <id> <form> <text>       the window closed: saves, and
//                                           deletes the note if it's empty
//
// <form> is "quick" or "pinned", which says which bundle the window opened
// from (see "Note windows" in lib.js).
//
// <text> is the editor's text ({value:editor.text}), which is empty in View
// mode, where there's no editor: so the mode comes from the window's state,
// and nothing is saved from View mode, where the file is already up to date
// (switching to View saves first). Text and IDs arrive escaped as they were in
// the window (see escapeForAlfredUi in lib.js).
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
      store.save(id, unescapeFromAlfredUi(rest[0] || ""));
      return;
    case "toggle":
      return toggle(store, workflowFolder, context, id, form, unescapeFromAlfredUi(rest[0] || ""));
    case "quit":
      quit(store, id, form, unescapeFromAlfredUi(rest[0] || ""));
      return;
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
// is now, so a stale text can't be saved over it.
function launched(store, workflowFolder, context, id, form, mode) {
  if (form === "quick" && pinnedNotePid(id) !== null) {
    return JSON.stringify({ finish: { variables: { pin_note: escapeForAlfredUi(id) } } });
  }
  writeNoteState(id, { form, pid: $.getppid(), mode });
  const note = form === "quick" ? store.read(id) : null;
  if (!note || textHash(note.text) === context.textHash) return;
  const parts = noteModeParts({ workflowFolder, id, form, mode, text: note.text, fontSize: context.fontSize, tint: context.tint });
  return JSON.stringify({ replace: { ids: parts } });
}

// Switches the window between Edit and View, through the saved file: to View,
// it saves the editor's text and renders the file; to Edit, it puts the file's
// text in a new editor. Prints the replace action for the window, and
// remembers the mode in the note's sidecar, so the note reopens in it.
function toggle(store, workflowFolder, context, id, form, text) {
  const state = readNoteState(id) || {};
  const from = state.mode === "view" ? "view" : "edit";
  if (from === "edit") store.save(id, text);
  const mode = from === "edit" ? "view" : "edit";
  const note = store.read(id);
  const parts = noteModeParts({
    workflowFolder,
    id,
    form,
    mode,
    text: note ? note.text : "",
    fontSize: context.fontSize,
    tint: context.tint,
  });
  writeNoteState(id, Object.assign(state, { mode }));
  store.updateMeta(id, { mode });
  return JSON.stringify({ replace: { ids: parts } });
}

// The window has closed. Saves the editor's text in Edit mode, then deletes
// the note, with its window bundles, if it's empty or was never saved. Without
// a state (its `launched` failed), the mode is unknown, so only non-blank text
// is saved: blank text could be View mode's empty value. A state of the other
// form is another window's: this was a quick view that handed over to the
// note's pinned window (see launched), so it leaves everything alone.
function quit(store, id, form, text) {
  const state = readNoteState(id);
  if (state && state.form !== form) return;
  if (state ? state.mode === "edit" : !isBlankText(text)) store.save(id, text);
  removeNoteState(id);
  if (store.deleteIfEmpty(id)) removeNoteBundle(id);
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
