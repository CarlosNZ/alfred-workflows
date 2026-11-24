#!/usr/bin/osascript -l JavaScript

// The note window's actions, run by its Alfred UI events (see ui/):
//
//   window.js launched <id> <form> <mode>   the window opened: records its state
//   window.js save <id> <form> <text>       typing stopped: saves the text
//   window.js toggle <id> <form> <text>     ⌘E or the Edit / View button
//   window.js edit <id> <form> <text>       double-click in View: to Edit
//   window.js view <id> <form> <text>       ⌘↩ in Edit: saves, to View
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
      save(store, id, form, unescapeFromAlfredUi(rest[0] || ""));
      return;
    case "toggle":
    case "edit":
    case "view":
      return switchMode(store, workflowFolder, context, id, form, unescapeFromAlfredUi(rest[0] || ""), command === "toggle" ? null : command);
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

// Typing has stopped: saves the editor's text, if it's the editor's (see
// isEditorText). The event fires about a second after the last keystroke, so
// it can come after a switch to View has replaced the editor, when its text is
// empty.
function save(store, id, form, text) {
  if (isEditorText(readNoteState(id), form, text)) store.save(id, text);
}

// Switches the window to mode `to` ("edit" or "view"), or to the other mode
// when `to` is null, through the saved file: to View, it saves the editor's
// text and renders the file; to Edit, it puts the file's text in a new editor.
// Prints the replace action for the window, and remembers the mode in the
// note's sidecar, so the note reopens in it. Does nothing when the window is
// already in mode `to` (⌘↩ is a shortcut of the whole window, so it also
// reaches this in View mode), or when it has no state of its form (its
// `launched` failed, or it handed over to a pinned window), since then its
// mode is unknown.
function switchMode(store, workflowFolder, context, id, form, text, to) {
  const state = readNoteState(id);
  if (!state || state.form !== form) return;
  const from = state.mode === "view" ? "view" : "edit";
  if (to === from) return;
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
// can be saved: only in Edit mode, since in View there's no editor and the
// value is empty. With no state (the window's `launched` failed), the mode is
// unknown, so only non-blank text counts. A state of the other form is
// another window's.
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
