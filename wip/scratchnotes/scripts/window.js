#!/usr/bin/osascript -l JavaScript

// The note window's actions, run by its Alfred UI events (see ui/):
//
//   window.js launched <id> <form> <mode>   the window opened: records its state
//   window.js save <id> <text>              typing stopped: saves the text
//   window.js toggle <id> <text>            ⌘E or the Edit / View button
//   window.js quit <id> <text>              the window closed: saves, and
//                                           deletes the note if it's empty
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
// so the notes folder and the window's look come from the context open.js
// wrote into the note's bundle.

ObjC.import("Foundation");
ObjC.import("unistd");

function run(argv) {
  const workflowFolder = $(loadLib(argv, "lib.js")).stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.js;
  const [command, escapedId, ...rest] = argv;
  const id = unescapeFromAlfredUi(escapedId || "");
  const context = readNoteContext(id);
  if (!context) throw new Error(`No window context for ${JSON.stringify(id)}`);
  const store = noteStore(context.folder);
  switch (command) {
    case "launched":
      writeNoteState(id, { form: rest[0], pid: $.getppid(), mode: rest[1] });
      return;
    case "save":
      store.save(id, unescapeFromAlfredUi(rest[0] || ""));
      return;
    case "toggle":
      return toggle(store, workflowFolder, context, id, unescapeFromAlfredUi(rest[0] || ""));
    case "quit":
      quit(store, id, unescapeFromAlfredUi(rest[0] || ""));
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// Switches the window between Edit and View, through the saved file: to View,
// it saves the editor's text and renders the file; to Edit, it puts the file's
// text in a new editor. Prints the replace action for the window, and
// remembers the mode in the note's sidecar, so the note reopens in it.
function toggle(store, workflowFolder, context, id, text) {
  const state = readNoteState(id) || {};
  const from = state.mode === "view" ? "view" : "edit";
  if (from === "edit") store.save(id, text);
  const mode = from === "edit" ? "view" : "edit";
  const note = store.read(id);
  const parts = noteModeParts({
    workflowFolder,
    id,
    form: state.form === "pinned" ? "pinned" : "quick",
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
// the note, with its window bundle, if it's empty or was never saved. Without
// a state (its `launched` failed), the mode is unknown, so only non-blank text
// is saved: blank text could be View mode's empty value.
function quit(store, id, text) {
  const state = readNoteState(id);
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
