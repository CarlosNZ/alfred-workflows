#!/usr/bin/osascript -l JavaScript

// ⌥↩ on a note: moves the note whose ID is argv[0] to the Trash, through
// Finder so "Put Back" works, and prints the text of the notification that
// follows, naming the note.

ObjC.import("Foundation");

function run(argv) {
  loadLib(argv, "lib.js");
  try {
    const store = noteStore();
    const note = store.read(argv[0]);
    if (!note) return "That note no longer exists";
    store.trash(note.id);
    return `Moved “${note.title}” to the Trash`;
  } catch (e) {
    return `Couldn't move the note to the Trash: ${e.message}`;
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
