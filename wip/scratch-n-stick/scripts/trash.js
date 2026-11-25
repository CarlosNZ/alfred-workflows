#!/usr/bin/osascript -l JavaScript

// ⌥↩ on a note: moves the note whose ID is argv[0] to the Trash, through
// Finder so "Put Back" works, and prints the text of the notification that
// follows, naming the note.
//
// If the note is sticky, its window's process is ended first, without its
// `quit` event, which would otherwise save the note back after it's gone.
// The note's window bundle goes too; its sidecar stays (see trash in lib.js).

ObjC.import("Foundation");

function run(argv) {
  loadLib(argv, "lib.js");
  loadLib(argv, "titles.js");
  try {
    const store = noteStore();
    const note = store.read(argv[0]);
    if (!note) return "That note no longer exists";
    closeStickyNoteWindow(note.id);
    store.trash(note.id);
    removeNoteBundle(note.id);
    return noteTrashedMessage(note.title);
  } catch (e) {
    return noteTrashFailedMessage(e);
  }
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
