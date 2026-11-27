#!/usr/bin/osascript -l JavaScript

// The sticky notes list's actions on sticky windows: argv[0] is the command,
// from the variable `sticky_action`, and argv[1] the note's ID, if any.
//
//   close <id>   ⌘↩ on a note: closes its window
//   close        Close all sticky notes: closes every sticky window
//   show         Show all sticky notes: brings every sticky window to the front
//   reopen       Reopen sticky notes: opens the notes whose sticky windows
//                were closed by a restart, shutdown or logout, or ended
//                without closing (see "Reopening sticky notes" in lib.js)
//   forget       ⌘↩ on Reopen sticky notes: leaves those notes closed
//   unstick <id> ⌘↩ on a closed sticky note: unsticks it
//
// Closing asks each window to quit, as its close button does, so its `quit`
// event saves the note and records its mode and whether it's collapsed, and
// the note reopens as it was the next time it's sticky (see
// quitStickyNoteWindows in lib.js). A note whose window has already closed is
// left alone.
//
// Showing brings the windows forward in the sticky notes list's order from
// the bottom up, so the note edited most recently ends up on top, with the
// focus, and any whose note hasn't been saved yet (a blank new note) at the
// bottom (see activateWindowProcesses in lib.js).
//
// Reopening runs the workflow's `stick` External Trigger once for each note,
// as only an Alfred UI object can open a sticky window, and each run of it
// opens one. So each note opens as ⌘↩ opens it, where and as it was left. It
// waits for each window before asking for the next, so they open one at a
// time, in Show all's order, the note edited most recently last, on top.
//
// Unsticking removes `sticky` from the note's sidecar and its closed window's
// state (see unstickNote in lib.js).

ObjC.import("Foundation");

function run(argv) {
  loadLib(argv, "lib.js");
  loadLib(argv, "text-rules.js");
  const [command, id = ""] = argv;
  if (id && !isNoteId(id)) throw new Error(`Not a note ID: ${JSON.stringify(id)}`);
  if (command === "close") return quitStickyNoteWindows(id ? { ids: [id] } : {});
  if (command === "show" && !id) return showStickyNoteWindows();
  if (command === "reopen" && !id) return reopenStickyNotes();
  if (command === "forget" && !id) return forgetReopenNotes();
  if (command === "unstick" && id) return unstickNote(noteStore(), id);
  throw new Error(`Unknown command: ${JSON.stringify(argv)}`);
}

function showStickyNoteWindows() {
  const ids = [...stickyNoteIds()];
  let listed = [];
  try {
    listed = noteStore().list({ ids }).map((note) => note.id);
  } catch (e) {
    // Without the notes folder the windows still come forward, in any order.
    console.log(e.message);
  }
  const order = ids.filter((id) => !listed.includes(id)).concat(listed.reverse());
  activateWindowProcesses(order.map((id) => stickyNotePid(id)).filter((pid) => pid !== null));
}

// How long reopenStickyNotes waits for each window to open.
const REOPEN_WAIT_SECONDS = 10;

function reopenStickyNotes() {
  const notes = reopenNotes(noteStore()).reverse();
  for (const note of notes) {
    if (!runWorkflowTrigger("stick", note.id, workflowVariable, { wait: true })) continue;
    const deadline = Date.now() + REOPEN_WAIT_SECONDS * 1000;
    while (stickyNotePid(note.id) === null && Date.now() < deadline) delay(0.05);
  }
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
