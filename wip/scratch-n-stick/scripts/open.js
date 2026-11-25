#!/usr/bin/osascript -l JavaScript

// Opens a note in a window: argv[0] is the form, "quick" (inside Alfred's
// window) or "stick" (its own window on the desktop), and argv[1] the note's ID,
// or, with the variable `new` set to "1" (the New note result), the text a new
// note starts with, which may become its heading (newNoteText in titles.js). After Stick in a quick view, or ↩ on a sticky note in the
// results, the variable `stick_note` names the note instead (escaped as in its
// window; see escapeForAlfredUi). After Stick, `stick_mode` is the quick view's
// mode, which the sticky window opens in.
//
// It writes the note's window bundle (see "Note windows" in lib.js) and
// prints it as the arg, for the Alfred UI object that follows, with the
// variable `open_window` set to "1". If the note is already sticky, it brings
// that window to the front instead and leaves `open_window` empty, so the
// Conditional after it stops, and a note is never open in two windows at once.
//
// The workflow runs it for sticking (⌘↩, and Stick in a quick view) and for ↩
// on a sticky note. ↩ on any other note opens a quick bundle that list.js has
// already written (see quickWindows in lib.js); `open.js quick` writes one the
// same way, for testing.
//
// A new note gets its ID now, before it's saved, so its window can save to it;
// newId skips IDs that open, unsaved notes already use (isNoteIdInUse).
//
// While the notes are moving to a newly configured folder (see
// checkNotesFolderMove in lib.js), it opens nothing. From the results list
// that can't happen, as the list shows only "Moving notes…" then; from the
// hotkey or the Universal Action, the new note isn't opened, and its text is
// still where it came from.

ObjC.import("Foundation");

function run(argv) {
  const workflowFolder = $(loadLib(argv, "lib.js")).stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.js;
  loadLib(argv, "titles.js");
  const form = argv[0] === "stick" ? "sticky" : "quick";
  if (checkNotesFolderMove({ workflowFolder }).status !== "ready") return output("");
  const store = noteStore();
  const stickNote = workflowVariable("stick_note");
  const isNew = !stickNote && workflowVariable("new") === "1";
  const id = stickNote ? unescapeFromAlfredUi(stickNote) : isNew ? store.newId({ isTaken: (id) => isNoteIdInUse(id) }) : argv[1] || "";
  if (!isNoteId(id)) throw new Error(`Not a note ID: ${JSON.stringify(id)}`);

  const pid = stickyNotePid(id);
  if (pid !== null) {
    activateWindowProcess(pid);
    return output("");
  }

  const note = isNew ? null : store.read(id);
  // A note that doesn't exist and isn't new is either a new note made sticky
  // from its quick view before anything was typed, or one that has gone
  // since the results were shown; both open blank.
  const text = isNew ? newNoteText(argv[1] || "") : note ? note.text : "";
  const mode = stickNote ? workflowVariable("stick_mode") : "";
  return output(writeNoteWindow({ store, workflowFolder, id, form, note, text, mode }));
}

// The output for the next objects: the bundle to open, if any, and the
// variables, clearing those that chose the note, so they don't carry on to a
// note made sticky from the window this opens.
function output(bundle) {
  return JSON.stringify({ alfredworkflow: { arg: bundle, variables: { open_window: bundle ? "1" : "", new: "", stick_note: "", stick_mode: "" } } });
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
