#!/usr/bin/osascript -l JavaScript

// ↩ on the results list's "Can't move the notes" (the variable `move_action`
// set to "reveal"; see notesFolderMoveOutput in lib.js): shows the folders
// that block moving the notes folder in Finder, each selected in both the old
// and the new notes folder, so the user can sort them out
// (revealNotesFolderClashes). It takes no argument: it works out what blocks
// the move from the settings and the record of where the notes are.

ObjC.import("Foundation");

function run(argv) {
  loadLib(argv, "lib.js");
  loadLib(argv, "text-rules.js");
  revealNotesFolderClashes();
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
