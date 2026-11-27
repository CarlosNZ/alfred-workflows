#!/usr/bin/osascript -l JavaScript

// Opens a note in a window: argv[0] is the form, "quick" (inside Alfred's
// window) or "stick" (its own window on the desktop), and argv[1] the note's ID,
// or, with the variable `new` set to "1" (the New note result), the text a new
// note starts with, which may become its heading (newNoteText in
// text-rules.js). After Stick in a quick view, or ↩ on a sticky note in the
// results, the variable `stick_note` names the note instead (escaped as in its
// window; see escapeForAlfredUi). After Stick, `stick_mode` is the quick view's
// mode, which the sticky window opens in.
//
// ⌘↩ in the results list always comes here, so on a sticky note it sets
// `sticky_action`: "close" on an open one closes its window, as its close
// button does, and "unstick" on a closed one unsticks it (unstickNote in
// lib.js); either way argv[1] is the note's ID, and nothing opens.
//
// It writes the note's window bundle (see "Note windows" in lib.js) and
// prints it as the arg, for the Alfred UI object that follows, with the
// variable `open_window` set to "1". If the note is already sticky, it brings
// that window to the front instead and leaves `open_window` empty, so the
// Conditional after it stops, and a note is never open in two windows at once.
// A sticky window opening on a screen other than the one it was left on is
// moved back by scripts/place.js, which it starts (see "Sticky window
// positions" in lib.js).
//
// The workflow runs it for sticking (⌘↩, and Stick in a quick view) and for ↩
// on a sticky note. ↩ on any other note opens a quick bundle that list.js has
// already written (see quickWindows in lib.js); `open.js quick` writes one the
// same way, for testing.
//
// A new note gets its ID now, before it's saved, so its window can save to it;
// newId skips IDs that open, unsaved notes already use (isNoteIdInUse).
//
// A quick view closed from its actions menu (Close, or Move to Trash) finishes
// with the variable `close_view` set to "1", as a quick view's `finish`
// carries on to the stick route: then it opens nothing.
//
// While the notes are moving to a newly configured folder (see
// checkNotesFolderMove in lib.js), it opens nothing. From the results list
// that can't happen, as the list shows only "Moving notes…" then; from the
// hotkey or the Universal Action, the new note isn't opened, and its text is
// still where it came from. Likewise while a colour in User Configuration
// can't be read (see notePalette in lib.js), which a notification says: the
// results list shows what's wrong instead of the notes.

ObjC.import("Foundation");

function run(argv) {
  const workflowFolder = $(loadLib(argv, "lib.js")).stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.js;
  loadLib(argv, "text-rules.js");
  const form = argv[0] === "stick" ? "sticky" : "quick";
  if (workflowVariable("close_view") === "1") return output("");
  // ⌘↩ on Reopen sticky notes in the results list comes here, as ⌘↩ on a
  // note does: it leaves those notes closed, and opens nothing.
  if (workflowVariable("sticky_action") === "forget") {
    forgetReopenNotes();
    return output("");
  }
  const stickyAction = workflowVariable("sticky_action");
  if (stickyAction === "close" || stickyAction === "unstick") {
    const noteId = argv[1] || "";
    if (!isNoteId(noteId)) throw new Error(`Not a note ID: ${JSON.stringify(noteId)}`);
    if (stickyAction === "close") quitStickyNoteWindows({ ids: [noteId] });
    else unstickNote(noteStore(), noteId);
    return output("");
  }
  if (checkNotesFolderMove({ workflowFolder }).status !== "ready") return output("");
  const paletteProblems = notePaletteProblems();
  if (paletteProblems.length) {
    postNotesNotification(`${paletteProblems[0].title}: ${paletteProblems[0].message}. Fix it in the workflow's Configuration.`);
    return output("");
  }
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
  // A new sticky note is saved with its starting text as it opens, so it's in
  // the results and sticky notes lists while its window is open, as a note
  // stuck from a quick view is (Stick saves first). store.save writes nothing
  // for blank text. A new quick view's note is saved by its window, as no
  // list shows while it's open.
  if (isNew && form === "sticky") store.save(id, text);
  const mode = stickNote ? workflowVariable("stick_mode") : "";
  // A sticky window opens sized to its note's text, unless an earlier sticky
  // window left the note a bundle: Alfred UI keys a window's saved frame on
  // its bundle's path, so that window opens where and as it was left.
  const isFirstSticky = form === "sticky" && !$.NSFileManager.defaultManager.fileExistsAtPath(noteBundlePath(id, "sticky"));
  const size = isFirstSticky ? fittedStickyWindowSize(workflowFolder, text, noteOwnFontSize(note && note.meta)) : null;
  const bundle = writeNoteWindow({ store, workflowFolder, id, form, note, text, mode, size });
  if (form === "sticky") startStickyWindowPlacement(workflowFolder, bundle);
  return output(bundle);
}

// The output for the next objects: the bundle to open, if any, and the
// variables, clearing those that chose the note, so they don't carry on to a
// note made sticky from the window this opens.
function output(bundle) {
  return JSON.stringify({
    alfredworkflow: {
      arg: bundle,
      variables: { open_window: bundle ? "1" : "", new: "", stick_note: "", stick_mode: "", close_view: "" },
    },
  });
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
