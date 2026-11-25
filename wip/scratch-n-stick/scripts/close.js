#!/usr/bin/osascript -l JavaScript

// Closes sticky windows, from the sticky notes list: argv[0] is the ID of the
// note whose window to close (⌘↩ on a note), or empty for every sticky window
// (Close all sticky notes).
//
// Each window is asked to quit, as its close button does, so its `quit` event
// saves the note and records its mode and whether it's collapsed, and the
// note reopens as it was the next time it's sticky (see quitStickyNoteWindows
// in lib.js). A note whose window has already closed is left alone.

ObjC.import("Foundation");

function run(argv) {
  loadLib(argv, "lib.js");
  const id = argv[0] || "";
  if (id && !isNoteId(id)) throw new Error(`Not a note ID: ${JSON.stringify(id)}`);
  quitStickyNoteWindows(id ? { ids: [id] } : {});
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
