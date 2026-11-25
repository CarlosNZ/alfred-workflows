#!/usr/bin/osascript -l JavaScript

// Moves the notes from argv[0], the folder they were last in, to argv[1], the
// folder the settings give, in the background (see "Moving the notes folder"
// in DESIGN.md). checkNotesFolderMove in lib.js starts it, with the
// workflow's variables, and its input and output on /dev/null.
//
// It first leaves the process group it was started in: a keystroke in Alfred
// stops a Script Filter's run by signalling its whole process group, which
// would stop the move with it. A keystroke before that stops it too, and the
// next run starts it again. Then it takes the move lock, or exits if another
// move holds it; closes the sticky windows, which saves their notes into the
// old folder; moves the notes (moveNotes); and records the new folder as the
// one the notes are in. If the move fails, it records why, for the results
// list to show, and the record still names the old folder, so the next run
// tries again and carries on where this one stopped. It posts a
// notification saying what happened (postNotesNotification), except for a
// retry that fails the same way as the last try, so retries made as the
// user types in the list don't notify each time.

ObjC.import("Foundation");
ObjC.import("unistd");

function run(argv) {
  $.setsid();
  loadLib(argv, "lib.js");
  loadLib(argv, "titles.js");
  const [from, to] = argv;
  if (!from || !to) throw new Error("Give the folder to move the notes from and the folder to move them to");
  if (!takeMoveLock()) return;
  try {
    // Another move may have finished this one since it was started.
    if (readLastNotesFolder() !== from) return;
    quitStickyNoteWindows();
    const result = moveNotes(from, to);
    writeLastNotesFolder(to);
    removeMoveFailure();
    // The default folder is created again whenever it's needed.
    if (from === defaultNotesFolder()) removeFolderIfEmpty(from);
    postNotesNotification(notesMovedMessage(result, to));
  } catch (e) {
    const last = readMoveFailure();
    writeMoveFailure({ from, to, error: e.message });
    if (!last || last.from !== from || last.to !== to || last.error !== e.message) {
      postNotesNotification(`Couldn't move the notes to ${notesFolderName(to)}: ${e.message}`);
    }
  } finally {
    releaseMoveLock();
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
