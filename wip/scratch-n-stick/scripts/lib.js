// Scratch'n'Stick shared code, loaded by every script with loadLib (see "Loading
// lib.js" in DESIGN.md). It runs in the global scope through an indirect eval:
// its function declarations become globals for the loading script, while its
// top-level const and let stay private to this file. Don't add "use strict",
// which would keep the functions private too.
//
// Storage: the notes folder, note IDs, saving, metadata sidecars, titles and
// previews, deleting empty notes and moving notes to the Trash.
//
// Regular expressions avoid lookbehind, which macOS 12's JavaScriptCore can't
// parse: one would stop the whole file loading.

ObjC.import("Foundation");

const NOTE_EXTENSION = ".md";
const META_FOLDER = ".scratchnstick";
const TITLE_MAX_LENGTH = 80;
const PREVIEW_MAX_LENGTH = 100;
const UNTITLED = "Untitled";

// The sizes in a note window's Font size menu, in points, which ⌘+ and ⌘−
// step through. Any order works, and a note's size outside the range of the
// list (chosen from a longer one) is brought within it.
const NOTE_FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72, 96];

// ---------------------------------------------------------------------------
// Configuration

// A workflow variable from the environment, or "" when it isn't set.
function workflowVariable(name) {
  const value = $.NSProcessInfo.processInfo.environment.objectForKey(name);
  return value.isNil() ? "" : value.js;
}

// A function like `readVariable` (workflowVariable, say) that reads each
// variable once and then remembers it: through the ObjC bridge, a read per
// note adds up over hundreds of notes on every keystroke.
function cachedVariables(readVariable = workflowVariable) {
  const values = new Map();
  return (name) => {
    if (!values.has(name)) values.set(name, readVariable(name));
    return values.get(name);
  };
}

// The notes folder: `notes_folder` from User Configuration if set; otherwise
// `notes/` in the workflow's data folder, created if it's missing. A
// configured folder must already exist and is never created, so a folder on
// an unmounted volume isn't recreated on the startup disk: if it's missing,
// the error thrown has `missingFolder` set to its path. `variable` reads a
// workflow variable, and is replaceable for tests.
function notesFolder(variable = workflowVariable) {
  const folder = configuredNotesFolder(variable);
  if (!variable("notes_folder").trim()) {
    ensureFolder(folder, true);
  } else if (!$.NSFileManager.defaultManager.fileExistsAtPath(folder)) {
    const error = new Error(`Missing notes folder: ${folder}`);
    error.missingFolder = folder;
    throw error;
  } else if (!isFolderPath(folder)) {
    throw new Error(`Not a folder: ${folder}`);
  }
  return folder;
}

// The path of the notes folder the settings give (see notesFolder), whether
// or not it exists.
function configuredNotesFolder(variable = workflowVariable) {
  const configured = variable("notes_folder").trim();
  return configured ? expandPath(configured) : defaultNotesFolder(variable);
}

// `notes/` in the workflow's data folder.
function defaultNotesFolder(variable = workflowVariable) {
  const data = variable("alfred_workflow_data");
  if (!data) throw new Error("No notes folder: neither notes_folder nor alfred_workflow_data is set");
  return expandPath(data) + "/notes";
}

function isFolderPath(path) {
  const isFolder = Ref();
  return $.NSFileManager.defaultManager.fileExistsAtPathIsDirectory(path, isFolder) && Boolean(isFolder[0]);
}

function expandPath(path) {
  return $(path).stringByExpandingTildeInPath.stringByStandardizingPath.js;
}

function ensureFolder(folder, createParents) {
  const fm = $.NSFileManager.defaultManager;
  const isFolder = Ref();
  if (fm.fileExistsAtPathIsDirectory(folder, isFolder)) {
    if (!isFolder[0]) throw new Error(`Not a folder: ${folder}`);
    return;
  }
  if (!createParents) {
    const parent = $(folder).stringByDeletingLastPathComponent.js;
    if (!fm.fileExistsAtPath(parent)) throw new Error(`Can't create ${folder}: ${parent} doesn't exist`);
  }
  const error = $();
  if (!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(folder, createParents, $(), error)) {
    throw new Error(`Can't create ${folder}: ${errorText(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Note IDs
//
// A note's ID is its filename without the `.md` extension. Notes the workflow
// creates are named for their creation time in local time, YYYYMMDD-HHMMSS,
// with -2, -3… when that's taken; files added by hand keep their own names.

function formatNoteId(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

// Whether `id` can name a note: a single, non-hidden filename component. IDs
// arrive as script arguments, so this keeps them inside the notes folder.
function isNoteId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= 250 && !/[/\0]/.test(id) && !id.startsWith(".");
}

// The note ID for a filename in the notes folder, or null if it isn't a note.
function noteIdFromFileName(name) {
  if (name.startsWith(".") || name.slice(-NOTE_EXTENSION.length).toLowerCase() !== NOTE_EXTENSION) return null;
  const id = name.slice(0, -NOTE_EXTENSION.length);
  return isNoteId(id) ? id : null;
}

// ---------------------------------------------------------------------------
// The note store
//
// noteStore(folder) returns the functions that read and change the notes in a
// folder (the configured notes folder by default). Notes are passed around as
// IDs; read and list return note objects:
//
//   { id, path, fileName, text, meta, modified, created, title, preview }
//
// `text` is the whole file. `meta` is the sidecar's object. `modified` is the
// file's modification time; `created` is the sidecar's `created`, or the
// file's birth time if the sidecar has none. Both are Dates. Every note in the
// folder is a note, with or without a sidecar: one without is given one when
// it's first read or listed (recordNewNote).
//
// Metadata lives in a hidden sidecar per note, `.scratchnstick/<id>.json` in the
// notes folder, so the note itself stays plain Markdown and changing its colour
// doesn't change its modification time.

function noteStore(folder = notesFolder()) {
  const fm = $.NSFileManager.defaultManager;
  const metaFolder = `${folder}/${META_FOLDER}`;

  function checkId(id) {
    if (!isNoteId(id)) throw new Error(`Not a note ID: ${JSON.stringify(id)}`);
  }

  function folderEntries() {
    const entries = fm.contentsOfDirectoryAtPathError(folder, null);
    return entries.isNil() ? [] : ObjC.deepUnwrap(entries);
  }

  // The note's filename as it is on disk, or `<id>.md` if it doesn't exist.
  // Matches the extension in any case (Notes.MD), and the ID whatever its
  // Unicode normalization, since a filename may be decomposed.
  function fileNameFor(id) {
    const exact = `${id}${NOTE_EXTENSION}`;
    const wanted = id.normalize("NFC");
    let match = null;
    for (const name of folderEntries()) {
      if (name === exact) return name;
      const candidate = match === null ? noteIdFromFileName(name) : null;
      if (candidate !== null && candidate.normalize("NFC") === wanted) match = name;
    }
    return match || exact;
  }

  function notePath(id) {
    checkId(id);
    return `${folder}/${fileNameFor(id)}`;
  }

  function metaPath(id) {
    return `${metaFolder}/${id}.json`;
  }

  function exists(id) {
    return fm.fileExistsAtPath(notePath(id));
  }

  // A new note ID for a note created at `date` (now by default). An ID is
  // taken if its note or its sidecar exists (a trashed note keeps its sidecar,
  // so a Put Back note keeps its colour), or if `isTaken(id)` says so, which
  // lets a caller count notes that are open but not saved yet.
  function newId({ date = new Date(), isTaken = () => false } = {}) {
    const base = formatNoteId(date);
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      if (!exists(id) && !fm.fileExistsAtPath(metaPath(id)) && !isTaken(id)) return id;
    }
  }

  function readFile(id, fileName) {
    const path = `${folder}/${fileName}`;
    const attributes = fm.attributesOfItemAtPathError(path, null);
    if (attributes.isNil() || attributes.objectForKey("NSFileType").js !== "NSFileTypeRegular") return null;
    const text = readText(path);
    if (text === null) return null;
    const birth = jsDate(attributes.objectForKey("NSFileCreationDate"));
    const meta = fm.fileExistsAtPath(metaPath(id)) ? readMeta(id) : recordNewNote(id, birth);
    const summary = noteSummary(text);
    return {
      id,
      path,
      fileName,
      text,
      meta,
      modified: jsDate(attributes.objectForKey("NSFileModificationDate")),
      created: parseDate(meta.created) || birth,
      title: summary.title,
      preview: summary.preview,
    };
  }

  // Gives a note found without a sidecar (one added by hand or by another
  // app) a sidecar recording its birth time as `created`, the first time it's
  // read or listed, and returns its metadata. A note whose sidecar exists but
  // can't be read isn't given a new one, so nothing in it is overwritten.
  // Listing still works if the sidecar can't be written (a read-only folder).
  function recordNewNote(id, birth) {
    if (!birth) return {};
    try {
      return updateMeta(id, { created: formatLocalIsoDate(birth) });
    } catch (e) {
      return { created: formatLocalIsoDate(birth) };
    }
  }

  // The note, or null if it doesn't exist or can't be read.
  function read(id) {
    checkId(id);
    const fileName = fileNameFor(id);
    return fm.fileExistsAtPath(`${folder}/${fileName}`) ? readFile(id, fileName) : null;
  }

  // Every note in the folder, last edited first.
  function list() {
    const notes = [];
    for (const name of folderEntries()) {
      const id = noteIdFromFileName(name);
      const note = id === null ? null : readFile(id, name);
      if (note) notes.push(note);
    }
    return notes.sort((a, b) => b.modified - a.modified || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }

  // Saves `text` as the note's whole content, atomically. Returns what it did:
  //   "created"   a new note was written
  //   "saved"     an existing note was changed
  //   "unchanged" the file already had this text, so it wasn't rewritten and
  //               its modification time stays
  //   "blank"     a new note with blank text, which isn't written
  // Blank text over an existing note is saved: an empty note is only deleted
  // when its window closes (deleteIfEmpty), so deleting everything and typing
  // again keeps the note's file and sidecar.
  // The sidecar gets `created` the first time a note is saved, if it hasn't
  // one yet: now for a new note, the file's birth time for one added by hand
  // that hasn't been read yet.
  function save(id, text) {
    const path = notePath(id);
    const existed = fm.fileExistsAtPath(path);
    if (existed) {
      if (readText(path) === text) return "unchanged";
    } else if (isBlankText(text)) {
      return "blank";
    }
    const birth = existed ? fileDate(path, "NSFileCreationDate") : new Date();
    writeFileAtomically(path, text);
    if (!readMeta(id).created) updateMeta(id, { created: formatLocalIsoDate(birth) });
    return existed ? "saved" : "created";
  }

  // The note's metadata object, {} if it has no sidecar or it isn't a JSON
  // object.
  function readMeta(id) {
    checkId(id);
    const text = readText(metaPath(id));
    if (text === null) return {};
    try {
      const meta = JSON.parse(text);
      return meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};
    } catch (e) {
      return {};
    }
  }

  // Merges `changes` into the note's metadata and returns the result. A key
  // set to null or undefined is removed; other keys are kept as they are. The
  // sidecar is only written once there's something in it, and removed when
  // its last key is. Works for a note that isn't saved yet (a colour picked
  // before typing); deleteIfEmpty removes such a sidecar.
  function updateMeta(id, changes) {
    const meta = Object.assign(readMeta(id), changes);
    for (const key of Object.keys(meta)) {
      if (meta[key] === null || meta[key] === undefined) delete meta[key];
    }
    const path = metaPath(id);
    if (Object.keys(meta).length === 0) {
      if (fm.fileExistsAtPath(path)) removeFile(path);
    } else {
      ensureFolder(metaFolder, false);
      writeFileAtomically(path, JSON.stringify(meta, null, 2) + "\n");
    }
    return meta;
  }

  // Deletes the note and its sidecar if its text is blank, or if it was never
  // saved, and returns whether it did. For a window closing on its note. Not
  // through the Trash: there's nothing to recover. A note that can't be read
  // as text is left alone.
  function deleteIfEmpty(id) {
    const path = notePath(id);
    if (fm.fileExistsAtPath(path)) {
      const text = readText(path);
      if (text === null || !isBlankText(text)) return false;
      removeFile(path);
    }
    if (fm.fileExistsAtPath(metaPath(id))) removeFile(metaPath(id));
    return true;
  }

  // Moves the note to the Trash through Finder, so Finder's "Put Back" works,
  // and returns the path it has in the Trash ("" if Finder doesn't say), or
  // null if the note doesn't exist. Its sidecar stays, so a note that's put
  // back keeps its metadata. Needs permission to control Finder: macOS asks
  // the first time, and once it's refused, the error says where to allow it.
  function trash(id) {
    const path = notePath(id);
    if (!fm.fileExistsAtPath(path)) return null;
    let item;
    try {
      item = Application("Finder").delete(Path(path));
    } catch (e) {
      // -1743 is errAEEventNotPermitted, for which JXA's message is only "An
      // error occurred."
      if (e.errorNumber === -1743)
        throw new Error(
          "Alfred isn't allowed to control Finder. Allow it in System Settings › Privacy & Security › Automation.",
        );
      throw e;
    }
    if (fm.fileExistsAtPath(path)) throw new Error(`Finder didn't move ${path} to the Trash`);
    try {
      return $.NSURL.URLWithString(item.url()).path.js;
    } catch (e) {
      return "";
    }
  }

  return { folder, notePath, exists, newId, read, list, save, readMeta, updateMeta, deleteIfEmpty, trash };
}

// ---------------------------------------------------------------------------
// Moving the notes folder
//
// Alfred runs nothing when a setting changes, so the notes move on the next
// run (see "Moving the notes folder" in DESIGN.md). The scripts that read the
// setting (list.js, new.js, open.js) call checkNotesFolderMove first. It
// compares the folder the notes were last in, recorded per Mac in the data
// folder, with the folder the setting gives, and when they differ starts
// scripts/move.js in the background, which closes the sticky windows and
// moves the notes (moveNotes). A move holds a lock, <cache>/move.lock/, while
// it runs, and one that fails leaves <cache>/move-failure.json saying why.

const MOVE_TEMP_PREFIX = ".scratchnstick-move-";
const MOVE_RERUN_SECONDS = 0.5;

// Whether the notes can be used in the folder the settings give, starting a
// move if they have to move there first. Returns:
//   { status: "ready" }    nothing to move: notesFolder() is the folder (and
//                          throws if a configured folder is missing)
//   { status: "moving" }   a move is running, or has just been started
//   { status: "failed", error }
//                          the last try at this move failed. Only with
//                          `showFailure`, for a Script Filter, and only once
//                          per try: the failure's record is marked as shown,
//                          so the next run tries again.
// With no record yet, the current folder is recorded and nothing moves. A
// missing old folder has nothing to move, so the record changes to the new
// one; a missing new folder leaves the record as it is, and the move waits
// until the folder exists. A missing old folder is the one case that posts
// a notification here, as nothing else says why the list is empty.
// `start(from, to)` starts the move and `notify(text)` posts a notification;
// both are replaceable for tests.
function checkNotesFolderMove({
  workflowFolder,
  showFailure = false,
  start = (from, to) => startNotesMove(workflowFolder, from, to),
  notify = (text) => postNotesNotification(text, variable),
  variable = workflowVariable,
}) {
  if (isMoveLockHeld(variable)) return { status: "moving" };
  const to = configuredNotesFolder(variable);
  if (!variable("notes_folder").trim()) ensureFolder(to, true);
  if (!isFolderPath(to)) return { status: "ready" };
  const from = readLastNotesFolder(variable);
  if (from === null || isSameFolder(from, to)) {
    if (from !== to) writeLastNotesFolder(to, variable);
    return { status: "ready" };
  }
  if (!isFolderPath(from)) {
    writeLastNotesFolder(to, variable);
    notify(
      `Your notes are now kept in ${notesFolderName(to, variable)}. No notes were moved, as the old folder, ${notesFolderName(from, variable)}, wasn't found.`,
    );
    return { status: "ready" };
  }
  const failure = readMoveFailure(variable);
  if (showFailure && failure && failure.from === from && failure.to === to && !failure.shown) {
    writeMoveFailure(Object.assign(failure, { shown: true }), variable);
    return { status: "failed", error: String(failure.error) };
  }
  start(from, to);
  return { status: "moving" };
}

// A Script Filter's output while the notes can't be listed because of a move
// (see checkNotesFolderMove): "Moving notes…", rerun until the move has
// finished, or why the last try failed.
function notesFolderMoveOutput(move) {
  if (move.status === "moving") {
    return JSON.stringify({
      rerun: MOVE_RERUN_SECONDS,
      items: [
        { title: "Moving notes…", subtitle: "To the notes folder set in the workflow's configuration", valid: false },
      ],
    });
  }
  return JSON.stringify({ items: [{ title: "Couldn't move the notes", subtitle: move.error, valid: false }] });
}

// A Script Filter's result for an error opening the notes folder.
function notesFolderErrorItem(error) {
  if (error.missingFolder) return { title: "Missing notes folder", subtitle: error.missingFolder, valid: false };
  return { title: "Can't open the notes folder", subtitle: error.message, valid: false };
}

// Starts scripts/move.js in the background (see launchInBackground), with
// the workflow's variables, so Alfred doesn't wait for it.
function startNotesMove(workflowFolder, from, to) {
  launchInBackground("/usr/bin/osascript", ["-l", "JavaScript", `${workflowFolder}/scripts/move.js`, from, to]);
}

// Posts a notification from the workflow, through its "notify" External
// Trigger and Post Notification object, so it comes from Alfred with the
// workflow's icon, as the Trash's does: for scripts outside Alfred's flow of
// objects (move.js, and checkNotesFolderMove). The AppleScript call runs in
// a process of its own that nothing waits for, so a Script Filter never
// waits on Alfred while Alfred waits on it, and the text is passed as an
// argument, never pasted into the script. Does nothing outside Alfred (no
// alfred_workflow_bundleid), so the tests post nothing.
function postNotesNotification(text, variable = workflowVariable) {
  const bundleId = variable("alfred_workflow_bundleid");
  if (!bundleId) return;
  launchInBackground("/usr/bin/osascript", [
    "-e",
    "on run argv",
    "-e",
    'tell application id "com.runningwithcrayons.Alfred" to run trigger "notify" in workflow (item 1 of argv) with argument (item 2 of argv)',
    "-e",
    "end run",
    bundleId,
    text,
  ]);
}

// What a finished move's notification says, from moveNotes' result: the
// notes that were already in the new folder count as moved, as they're
// there now.
function notesMovedMessage(result, to, variable = workflowVariable) {
  const count = result.moved + result.duplicates;
  const place = notesFolderName(to, variable);
  if (count === 0) return `Your notes are now kept in ${place}. There were no notes to move.`;
  const notes = count === 1 ? "1 note" : `${count} notes`;
  const renamed = result.renamed.length;
  if (renamed === 0) return `Moved ${notes} to ${place}.`;
  return `Moved ${notes} to ${place}. ${renamed === 1 ? "1 was" : `${renamed} were`} renamed, as ${renamed === 1 ? "its name was" : "their names were"} taken there.`;
}

// A notes folder as a notification names it: "the workflow's data folder"
// for the default one, otherwise its path with ~ for the home folder.
function notesFolderName(folder, variable = workflowVariable) {
  let isDefault = false;
  try {
    isDefault = folder === defaultNotesFolder(variable);
  } catch (e) {
    // No data folder: not the default.
  }
  return isDefault ? "the workflow's data folder" : $(folder).stringByAbbreviatingWithTildeInPath.js;
}

// Starts a program that runs on its own, with its input and output on
// /dev/null, so nothing waits for it. It inherits the environment, and so
// the workflow's variables.
function launchInBackground(path, args) {
  const task = $.NSTask.alloc.init;
  task.launchPath = path;
  task.arguments = $(args);
  const nullDevice = $.NSFileHandle.fileHandleWithNullDevice;
  task.standardInput = nullDevice;
  task.standardOutput = nullDevice;
  task.standardError = nullDevice;
  task.launch;
}

function workflowDataFolder(variable) {
  const data = variable("alfred_workflow_data");
  if (!data) throw new Error("alfred_workflow_data isn't set");
  return expandPath(data);
}

function workflowCacheFolder(variable) {
  const cache = variable("alfred_workflow_cache");
  if (!cache) throw new Error("alfred_workflow_cache isn't set");
  return expandPath(cache);
}

// The record of the folder the notes were last in: its path, in a file in
// the data folder, which is local to each Mac.
function readLastNotesFolder(variable = workflowVariable) {
  const text = readText(`${workflowDataFolder(variable)}/last-notes-folder`);
  return text === null || !text.trim() ? null : text.trim();
}

function writeLastNotesFolder(folder, variable = workflowVariable) {
  const data = workflowDataFolder(variable);
  ensureFolder(data, true);
  writeFileAtomically(`${data}/last-notes-folder`, `${folder}\n`);
}

// Whether two paths are the same folder: with symlinks resolved, the same
// volume and file number. A path that differs only in case, on a
// case-insensitive volume, or that goes through a symlink, is the same.
function isSameFolder(a, b) {
  const idA = fileIdentity(a);
  return idA !== null && idA === fileIdentity(b);
}

function fileIdentity(path) {
  const attributes = $.NSFileManager.defaultManager.attributesOfItemAtPathError(
    $(path).stringByResolvingSymlinksInPath,
    null,
  );
  if (attributes.isNil()) return null;
  return `${attributes.objectForKey("NSFileSystemNumber").js}:${attributes.objectForKey("NSFileSystemFileNumber").js}`;
}

function volumeIdentity(path) {
  const attributes = $.NSFileManager.defaultManager.attributesOfItemAtPathError(
    $(path).stringByResolvingSymlinksInPath,
    null,
  );
  return attributes.isNil() ? null : attributes.objectForKey("NSFileSystemNumber").js;
}

// The move lock is a folder, so taking it is one step that only one process
// can win, holding a file `pid` with the process ID of the move.
function moveLockPath(variable) {
  return `${workflowCacheFolder(variable)}/move.lock`;
}

// Whether a live move holds the lock. A lock with no process ID in it yet is
// still being taken, and counts as held for a few seconds.
function isMoveLockHeld(variable = workflowVariable) {
  const lock = moveLockPath(variable);
  if (!$.NSFileManager.defaultManager.fileExistsAtPath(lock)) return false;
  const pid = moveLockPid(lock);
  if (pid !== null) return isProcessAlive(pid);
  const created = fileDate(lock, "NSFileCreationDate");
  return created !== null && Date.now() - created < 5000;
}

function moveLockPid(lock) {
  const text = readText(`${lock}/pid`);
  const pid = text === null ? NaN : Number(text.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

// Takes the lock for this process, taking over a stale one (its process has
// gone), and returns whether it did.
function takeMoveLock(variable = workflowVariable) {
  ObjC.import("unistd");
  const fm = $.NSFileManager.defaultManager;
  const lock = moveLockPath(variable);
  ensureFolder(workflowCacheFolder(variable), true);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(lock, false, $(), null)) {
      writeFileAtomically(`${lock}/pid`, `${$.getpid()}\n`);
      return true;
    }
    if (isMoveLockHeld(variable)) return false;
    fm.removeItemAtPathError(lock, null);
  }
  return false;
}

// Releases the lock, if this process holds it.
function releaseMoveLock(variable = workflowVariable) {
  ObjC.import("unistd");
  const lock = moveLockPath(variable);
  if (moveLockPid(lock) === $.getpid()) $.NSFileManager.defaultManager.removeItemAtPathError(lock, null);
}

function isProcessAlive(pid) {
  ObjC.import("signal");
  return $.kill(pid, 0) === 0;
}

// The record of a failed move, { from, to, error, shown }, or null: `shown`
// once a Script Filter has shown it. It stays until a move succeeds, so a
// retry that fails the same way doesn't notify again (see move.js).
function readMoveFailure(variable = workflowVariable) {
  return readJsonObject(`${workflowCacheFolder(variable)}/move-failure.json`);
}

function writeMoveFailure(failure, variable = workflowVariable) {
  const cache = workflowCacheFolder(variable);
  ensureFolder(cache, true);
  writeFileAtomically(`${cache}/move-failure.json`, JSON.stringify(failure) + "\n");
}

function removeMoveFailure(variable = workflowVariable) {
  const path = `${workflowCacheFolder(variable)}/move-failure.json`;
  if ($.NSFileManager.defaultManager.fileExistsAtPath(path)) removeFile(path);
}

// Asks every sticky window to quit, as its close button does, so its `quit`
// event saves its note, and waits for each one's process to exit, which it
// does once the note is saved. One still running after `timeout` ms is
// force-quit. Quitting another app goes through Apple events, so this runs
// as Alfred (in a process Alfred started). `isTerminated` doesn't change
// while a script runs, as nothing runs the run loop that updates it, so the
// wait checks the processes themselves.
function quitStickyNoteWindows(variable = workflowVariable, timeout = 5000) {
  const windows = [...stickyNoteIds(variable)]
    .map((id) => ({ id, pid: stickyNotePid(id, variable) }))
    .filter((w) => w.pid !== null);
  for (const { pid } of windows) {
    const app = runningApp(pid);
    if (app) app.terminate;
  }
  const start = Date.now();
  while (windows.some(({ pid }) => isProcessAlive(pid)) && Date.now() - start < timeout) delay(0.05);
  for (const { id, pid } of windows) {
    if (!isProcessAlive(pid)) continue;
    const app = runningApp(pid);
    if (app) app.forceTerminate;
    removeNoteState(id, variable);
  }
}

// Moves the notes in the folder `from` into the folder `to`, with their
// sidecars, and returns { moved, renamed, duplicates }: the number of notes
// moved, the [old ID, new ID] of those renamed, and the number already in
// `to`. The notes are the files the results list shows (see list in
// noteStore), with or without a sidecar.
//
// - A note whose ID is taken in `to`, by a note in any extension case and
//   Unicode normalization or by a sidecar, gets the next free suffix, as
//   newId gives (foo-2, foo-3), keeping its extension's case, and its sidecar
//   is renamed with it.
// - A note with the same text as the note of the same ID in `to` is only
//   deleted from `from`; its sidecar moves if that note has none.
// - Sidecars without a note are deleted, with the rest of `from`'s
//   .scratchnstick, once every note has moved.
//
// It works one note at a time, copying the sidecar, then moving the note,
// then deleting the old sidecar, so it can be stopped at any point and run
// again to finish. A sidecar in `to` with exactly the text of the note's own
// is the copy made by a move that was stopped, and doesn't count as taking
// the note's ID. Within a volume a note is renamed, and a sidecar's copy is a
// hard link, made in one step; across volumes both are copied (see
// copyFileTo). Throws on the first file it can't move, naming it.
function moveNotes(from, to) {
  const fm = $.NSFileManager.defaultManager;
  const fromMeta = `${from}/${META_FOLDER}`;
  const toMeta = `${to}/${META_FOLDER}`;
  const target = noteStore(to);
  const sameVolume = volumeIdentity(from) === volumeIdentity(to);
  removeMoveTemps(to);
  removeMoveTemps(toMeta);

  // The IDs of the notes in `to`, in NFC, so a note whose name is in the
  // other normalization counts. fileExistsAtPath covers the rest on a
  // case-insensitive volume, where Foo.md and foo.MD are one file.
  const targetIds = new Set(
    folderNames(to)
      .map(noteIdFromFileName)
      .filter((id) => id !== null)
      .map((id) => id.normalize("NFC")),
  );
  const noteTaken = (id) => targetIds.has(id.normalize("NFC")) || fm.fileExistsAtPath(`${to}/${id}${NOTE_EXTENSION}`);
  const freeId = (id, meta) => {
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? id : `${id}-${n}`;
      if (noteTaken(candidate)) continue;
      const sidecar = `${toMeta}/${candidate}.json`;
      if (!fm.fileExistsAtPath(sidecar) || (meta !== null && readText(sidecar) === readText(meta))) return candidate;
    }
  };
  let toMetaReady = false;
  const copySidecar = (meta, dest) => {
    if (!toMetaReady) ensureFolder(toMeta, false);
    toMetaReady = true;
    if (!sameVolume) return copyFileTo(meta, dest);
    const error = $();
    if (!fm.linkItemAtPathToPathError(meta, dest, error))
      throw new Error(`Can't copy ${meta} to ${dest}: ${errorText(error)}`);
  };

  const result = { moved: 0, renamed: [], duplicates: 0 };
  for (const name of folderNames(from)) {
    const id = noteIdFromFileName(name);
    const path = `${from}/${name}`;
    if (id === null || !isRegularFile(path)) continue;
    const meta = `${fromMeta}/${id}.json`;
    const hasMeta = fm.fileExistsAtPath(meta);

    if (noteTaken(id)) {
      const text = readText(path);
      if (text !== null && text === readText(target.notePath(id))) {
        if (hasMeta && !fm.fileExistsAtPath(`${toMeta}/${id}.json`)) copySidecar(meta, `${toMeta}/${id}.json`);
        removeFile(path);
        if (hasMeta) removeFile(meta);
        result.duplicates++;
        continue;
      }
    }

    const newId = freeId(id, hasMeta ? meta : null);
    if (hasMeta && !fm.fileExistsAtPath(`${toMeta}/${newId}.json`)) copySidecar(meta, `${toMeta}/${newId}.json`);
    const dest = `${to}/${newId}${name.slice(id.length)}`;
    if (sameVolume) moveFileTo(path, dest);
    else {
      copyFileTo(path, dest);
      removeFile(path);
    }
    if (hasMeta) removeFile(meta);
    targetIds.add(newId.normalize("NFC"));
    result.moved++;
    if (newId !== id) result.renamed.push([id, newId]);
  }

  if (fm.fileExistsAtPath(fromMeta)) {
    const error = $();
    if (!fm.removeItemAtPathError(fromMeta, error)) throw new Error(`Can't delete ${fromMeta}: ${errorText(error)}`);
  }
  return result;
}

// Moves a file to `dest`, which must not exist: it fails rather than replace
// a file.
function moveFileTo(source, dest) {
  const error = $();
  if (!$.NSFileManager.defaultManager.moveItemAtPathToPathError(source, dest, error)) {
    throw new Error(`Can't move ${source} to ${dest}: ${errorText(error)}`);
  }
}

// Copies a file to `dest`, which must not exist, by way of a temporary hidden
// name beside it, so a copy that's stopped part way never leaves a partial
// file at `dest`. Its birth and modification times are set to the
// original's, which a copy to another volume may not keep.
function copyFileTo(source, dest) {
  const fm = $.NSFileManager.defaultManager;
  const temp = `${$(dest).stringByDeletingLastPathComponent.js}/${MOVE_TEMP_PREFIX}${$.NSUUID.UUID.UUIDString.js}.tmp`;
  const error = $();
  if (!fm.copyItemAtPathToPathError(source, temp, error))
    throw new Error(`Can't copy ${source} to ${dest}: ${errorText(error)}`);
  const attributes = fm.attributesOfItemAtPathError(source, null);
  if (!attributes.isNil()) {
    const dates = $.NSMutableDictionary.dictionary;
    for (const key of ["NSFileCreationDate", "NSFileModificationDate"]) {
      const date = attributes.objectForKey(key);
      if (!date.isNil()) dates.setObjectForKey(date, key);
    }
    fm.setAttributesOfItemAtPathError(dates, temp, null);
  }
  try {
    moveFileTo(temp, dest);
  } catch (e) {
    fm.removeItemAtPathError(temp, null);
    throw e;
  }
}

// Deletes the temporary files a stopped copy left in `folder`.
function removeMoveTemps(folder) {
  for (const name of folderNames(folder)) {
    if (name.startsWith(MOVE_TEMP_PREFIX)) removeFile(`${folder}/${name}`);
  }
}

// Deletes `folder` if nothing is in it but Finder's .DS_Store.
function removeFolderIfEmpty(folder) {
  const names = folderNames(folder);
  if (!isFolderPath(folder) || names.some((name) => name !== ".DS_Store")) return false;
  return $.NSFileManager.defaultManager.removeItemAtPathError(folder, null);
}

// The names of the items in a folder, or [] if it can't be read.
function folderNames(folder) {
  const entries = $.NSFileManager.defaultManager.contentsOfDirectoryAtPathError(folder, null);
  return entries.isNil() ? [] : ObjC.deepUnwrap(entries);
}

function isRegularFile(path) {
  const attributes = $.NSFileManager.defaultManager.attributesOfItemAtPathError(path, null);
  return !attributes.isNil() && attributes.objectForKey("NSFileType").js === "NSFileTypeRegular";
}

// ---------------------------------------------------------------------------
// Note windows
//
// A note opens in a window built from the templates in the workflow's ui/
// folder, written as its own bundle: <cache>/quick/<id>.alfredui for a quick
// view, <cache>/windows/<id>.alfredui for a sticky window, so each sticky note
// keeps its own saved position (AppKit saves a window's frame under a hash of
// its bundle's path). The window is in one of two forms, "quick" (inside
// Alfred's window) or "sticky" (its own window on the desktop), and one of two
// modes, "edit" (a textarea) or "view" (the note rendered in a web view).
//
// Both modes have the same layout, a stack filling the window: the web view,
// the textarea over it, the icon picker over them (a box under the icon
// button, hidden until it's opened; see scripts/picker.sh), and the top row's
// two groups of buttons, over the top-left corner (after a sticky window's
// traffic lights) and the top-right corner.
// The web view stays in the window for its whole life (a new one takes
// 100–250 ms to show anything): Edit fades it out and shows the textarea, and
// View hides the textarea and reloads the web view's page with the note (see
// writeNotePage).
//
// The templates are ui.json as Alfred UI reads it, with directives that
// resolveNoteTemplate resolves and removes:
//   "@form": "quick" | "sticky"   on an array element: kept in that form only
//   "@mode": "edit" | "view"      on an array element: kept in that mode only
//   "@needs": "icons"             on an array element: kept only in a window
//                                 that can show note icons (macOS 13 or
//                                 later; see noteIconsSupported)
//   "@quick", "@sticky", "@edit", "@view": { … }
//                                 properties merged into the object in that
//                                 form or mode
//   "@collapsed": { … }           properties merged into the object in a
//                                 collapsed sticky window (see "Collapsing"
//                                 in window.js)
//   "@note", "@text", …           a whole string that's a token is replaced by
//                                 its value (see noteWindowTokens); an array
//                                 element whose token's value is an array is
//                                 replaced by its elements
//   "src": "scripts/…"            an action's script, made absolute, since the
//                                 bundle isn't in the workflow folder
//
// Alfred UI expands {var:…} and {const:…} placeholders in every string it's
// given (in ui.json and in update and replace actions), and {value:…} and
// {data:…} in action arguments, so text from a note is escaped before it goes
// in (escapeForAlfredUi) and unescaped when it comes back.

const FONT_SIZE = { min: 11, max: 20, default: 14 };
const WORD_JOINER = "⁠";

// The palette: six colours, in slots 1 to 6, in the colour picker's order,
// which is also ⌘1 to ⌘6. Each colour is { slot, label, tint, control }: a
// pale `tint` for a sticky note's background (always with dark text), and a
// stronger `control` colour, for the window's colour swatches. A note's
// result icon is drawn from both: its badge or dot is the tint, ringed in the
// control colour (see noteBadgeFile and noteDotFile). A note stores its
// colour's slot, so a slot's colours can change without rewriting notes.
//
// The slots are User Configuration's colour_1 to colour_6. Each is a name and
// one or two hex colours, in any order (parseNotePaletteSlot): the tint, then
// the control colour, worked out from the tint if it's left out
// (noteControlColour). A slot without a name is "Colour <slot>"; an empty one
// takes its default. These defaults are Stickies' colours, from its asset
// catalogue, and are the fields' defaults in info.plist too (dev/test-list.sh
// checks they agree).
const NOTE_PALETTE_DEFAULTS = [
  { label: "Yellow", tint: "#FEF49C", control: "#DBC503" },
  { label: "Blue", tint: "#ADF4FF", control: "#24D0E9" },
  { label: "Green", tint: "#B2FFA1", control: "#51BB51" },
  { label: "Pink", tint: "#FFC7C7", control: "#F87F7F" },
  { label: "Purple", tint: "#B6CAFF", control: "#7D9BEB" },
  { label: "Grey", tint: "#EEEEEE", control: "#A8A8A8" },
];

// The slot of the default colour when the `default_colour` setting isn't one.
const DEFAULT_COLOUR = 1;

// The default palette, as copies of its colours.
function noteDefaultPalette() {
  return NOTE_PALETTE_DEFAULTS.map((colour, i) => Object.assign({ slot: i + 1 }, colour));
}

// The palette from User Configuration (colour_1 to colour_6), as copies of its
// colours. Throws if a slot can't be read, with `paletteProblems` set to
// notePaletteProblems'. Parsed once per process for the same settings.
const notePalettes = new Map();

function notePalette(variable = workflowVariable) {
  const texts = NOTE_PALETTE_DEFAULTS.map((_, i) => variable(`colour_${i + 1}`) || "");
  const key = JSON.stringify(texts);
  if (!notePalettes.has(key)) notePalettes.set(key, readNotePalette(texts));
  const { palette, problems } = notePalettes.get(key);
  if (problems.length) {
    const error = new Error(problems.map((p) => `${p.title}: ${p.message}`).join("; "));
    error.paletteProblems = problems;
    throw error;
  }
  return palette.map((colour) => Object.assign({}, colour));
}

// The slots of User Configuration's palette that can't be read, as
// [{ slot, title, message }], or none.
function notePaletteProblems(variable = workflowVariable) {
  try {
    notePalette(variable);
    return [];
  } catch (e) {
    if (!e.paletteProblems) throw e;
    return e.paletteProblems;
  }
}

// The palette from the six slots' `texts`: { palette, problems }.
function readNotePalette(texts) {
  const palette = [];
  const problems = [];
  texts.forEach((text, i) => {
    const slot = i + 1;
    try {
      palette.push(Object.assign({ slot }, text.trim() ? parseNotePaletteSlot(slot, text) : NOTE_PALETTE_DEFAULTS[i]));
    } catch (e) {
      problems.push({ slot, title: `Colour ${slot} isn't valid`, message: e.message });
    }
  });
  return { palette, problems };
}

// A slot's colour, { label, tint, control }, from its setting's `text`: one or
// two hex colours (#RRGGBB or #RGB; the # can be left out of six digits), the
// tint and then the control colour, and any other words, which are its name.
// Throws an error saying what's wrong.
function parseNotePaletteSlot(slot, text) {
  const hexes = [];
  const words = [];
  for (const word of text.trim().split(/[\s,]+/).filter(Boolean)) {
    if (/^#?[0-9a-f]{6}$/i.test(word) || /^#[0-9a-f]{3}$/i.test(word)) hexes.push(normalHex(word));
    else if (word.startsWith("#")) throw new Error(`“${word}” isn't a hex colour, like #FEF49C`);
    else words.push(word);
  }
  if (hexes.length === 0) throw new Error("It needs a hex colour, like #FEF49C");
  if (hexes.length > 2) throw new Error("It has more than two hex colours: give the note's colour, then optionally a stronger one for its dot and ring");
  return {
    label: words.join(" ") || `Colour ${slot}`,
    tint: hexes[0],
    control: hexes[1] || noteControlColour(hexes[0]),
  };
}

// A hex colour as "#RRGGBB", in capitals.
function normalHex(hex) {
  const digits = hex.replace(/^#/, "").toUpperCase();
  return `#${digits.length === 3 ? digits.replace(/./g, "$&$&") : digits}`;
}

// A control colour for the tint `tint` ("#RRGGBB"), for a slot that doesn't
// give one: the tint's hue, twice as saturated and 10% darker, then darker
// still until it has a contrast of at least 2:1 with white, so a swatch or
// ring shows on a light background. Close to Stickies' own control colours,
// though not the same: theirs follow no one rule.
function noteControlColour(tint) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(tint.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const range = max - Math.min(r, g, b);
  let hue = 0;
  if (range) {
    hue = max === r ? ((g - b) / range) % 6 : max === g ? (b - r) / range + 2 : (r - g) / range + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const saturation = Math.min(1, (max ? range / max : 0) * 2);
  const fromHsv = (value) => {
    const chroma = value * saturation;
    const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const sector = Math.floor(hue / 60);
    const [r1, g1, b1] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][sector];
    return [r1, g1, b1].map((c) => c + value - chroma);
  };
  const luminance = (rgb) => {
    const [lr, lg, lb] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  };
  let value = max * 0.9;
  while (value > 0.3 && 1.05 / (luminance(fromHsv(value)) + 0.05) < 2) value -= 0.01;
  return `#${fromHsv(value)
    .map((c) => Math.round(c * 255).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

// The colour in slot `slot` (a number, or its text) of `palette`, or null if
// there's none.
function notePaletteColour(palette, slot) {
  const colour = palette.find((c) => String(c.slot) === String(slot));
  return colour ? Object.assign({}, colour) : null;
}

// The colour of a note with metadata `meta`, from User Configuration's
// palette: its own, or, if it has none or one that isn't a slot, the
// `default_colour` setting's, or slot 1's.
function noteColour(meta, variable = workflowVariable) {
  return noteColourIn(notePalette(variable), meta, variable);
}

// The Script Filter results that stand in for the list when the palette in
// User Configuration can't be read: one for each slot that's wrong, saying
// what's wrong with it (notePaletteProblems), or none if it's fine.
function notePaletteProblemItems(variable = workflowVariable) {
  return notePaletteProblems(variable).map((problem) => ({
    title: problem.title,
    subtitle: `${problem.message}. Fix it in the workflow's Configuration.`,
    valid: false,
  }));
}

function noteColourIn(palette, meta, variable = workflowVariable) {
  return notePaletteColour(palette, meta && meta.colour) || noteDefaultColour(palette, variable);
}

function noteDefaultColour(palette, variable = workflowVariable) {
  return notePaletteColour(palette, variable("default_colour")) || notePaletteColour(palette, DEFAULT_COLOUR);
}

// The icons a note can have, from Lucide (its sources are in dev/lucide/), in
// the picker's order, each with the label of its tooltip. A note stores its
// icon's name in its sidecar (`icon`); a note without one has no icon, and
// there's no default. Each is shipped as a button icon in each appearance, in
// icons/lucide/ (drawn by dev/make-icons.js), for the window, and made
// into a badge in a note's colour when one is needed (noteBadgeFile), for its
// result and its sticky window's app icon. Adding one adds a button to the
// icon picker's grid (NOTE_WINDOW_LAYOUT.iconPicker), whose shadow
// dev/make-icons.js then redraws.
const NOTE_ICONS = [
  { name: "sticky-note", label: "Note" },
  { name: "list-todo", label: "To-do" },
  { name: "shopping-cart", label: "Shopping" },
  { name: "lightbulb", label: "Idea" },
  { name: "book-open", label: "Reading" },
  { name: "bookmark", label: "Bookmark" },
  { name: "briefcase", label: "Work" },
  { name: "calendar", label: "Calendar" },
  { name: "phone", label: "Call" },
  { name: "users", label: "People" },
  { name: "house", label: "Home" },
  { name: "utensils", label: "Food" },
  { name: "plane", label: "Travel" },
  { name: "gift", label: "Gift" },
  { name: "wallet", label: "Money" },
  { name: "code", label: "Code" },
  { name: "music", label: "Music" },
  { name: "heart", label: "Heart" },
  { name: "star", label: "Star" },
  { name: "flag", label: "Flag" },
];

// The other Lucide icons in a note's window, shipped as button icons, so
// every icon in the top row and the picker is drawn the same way (in the
// buttons' colour for the window's appearance): the Edit / View switch's
// (`eye` to switch to View, `pencil` to Edit), Stick to the desktop's
// (`sticky-note-plus`), the icon button's for a note
// without an icon (`square-dashed-plus`), the picker's None (`ban`), and the Font
// size button's (`text-size`, the workflow's own, in Lucide's style; see
// dev/make-icons.js), a sticky window's close button's (`close`, the
// workflow's own too: a filled circle with an X cut out of it), and the
// actions menu button's (`ellipsis`). Each has an
// SF Symbol for windows that can't show the button icons (macOS 12; see
// noteIconsSupported), which follows the appearance by itself.
const NOTE_WINDOW_BUTTON_ICONS = {
  eye: "eye",
  pencil: "pencil",
  "sticky-note-plus": "note.text.badge.plus",
  "square-dashed-plus": "plus.square.dashed",
  ban: "nosign",
  "text-size": "textformat.size",
  close: "xmark.circle.fill",
  ellipsis: "ellipsis",
};

// The release of lucide-static that the button icons were drawn from, as
// dev/lucide/VERSION records it (dev/test-list.sh checks they agree). It's
// part of every badge's name, so a new release gets new badges.
const LUCIDE_VERSION = "1.72.0";

// The icons, as copies: { name, label }.
function noteIcons() {
  return NOTE_ICONS.map((icon) => Object.assign({}, icon));
}

// The names of every icon shipped as a button icon: the note icons and
// NOTE_WINDOW_BUTTON_ICONS, each once.
function noteButtonIconNames() {
  return [...new Set(NOTE_ICONS.map((icon) => icon.name).concat(Object.keys(NOTE_WINDOW_BUTTON_ICONS)))];
}

// The icon named `name`, or null if there's none.
function noteIconByName(name) {
  const icon = NOTE_ICONS.find((i) => i.name === name);
  return icon ? Object.assign({}, icon) : null;
}

// The icon of a note with metadata `meta`, or null if it has none, has one
// that isn't in the set, or the Mac can't show note icons (noteIconsSupported).
// Either way its sidecar keeps the name as it is, for another version or
// another Mac.
function noteIcon(meta, variable = workflowVariable) {
  if (!noteIconsSupported(variable)) return null;
  return noteIconByName(meta && meta.icon);
}

// Whether the Mac can show note icons: macOS 13 or later. The button icons
// and badges are SVGs, which macOS 12 can't read, and an image Alfred UI can't
// read makes it reject the whole window there (see "Note icons" in DESIGN.md).
// So on macOS 12 a window has no icon button, icon picker or ⌘I, its actions
// are SF Symbols, results show dots, and a sticky window keeps the Scratch'n'Stick
// app icon. The variable `scratchnstick_macos_version` overrides the version,
// for tests, and to see macOS 12's window on a newer Mac.
function noteIconsSupported(variable = workflowVariable) {
  const override = parseInt(variable("scratchnstick_macos_version"), 10);
  return (isNaN(override) ? macosMajorVersion() : override) >= 13;
}

let macosVersion = null;

function macosMajorVersion() {
  if (macosVersion === null) macosVersion = $.NSProcessInfo.processInfo.operatingSystemVersion.majorVersion;
  return macosVersion;
}

// A button icon: the icon named `name` (a note icon, or one of
// NOTE_WINDOW_BUTTON_ICONS) in the buttons' colour in `appearance` ("light" or
// "dark"), as a path in the workflow folder. Shipped with the workflow, drawn
// by dev/make-icons.js.
function noteButtonIconFile(name, appearance) {
  return `icons/lucide/${name}-${appearance === "dark" ? "dark" : "light"}.svg`;
}

// ---------------------------------------------------------------------------
// Result icons: badges and dots
//
// A note's result shows its badge (its icon on its colour) if it has an icon,
// or else its dot (a circle of its colour). Both depend on the palette, so
// they're made when they're needed, into <cache>/icons/, rather than shipped.
// Each file's name says everything it's made from: its kind, its icon, the
// colours it uses, for a badge the Lucide release, and a hash of the code that
// draws it, so a change to any of them gets new files rather than stale ones:
//   badge-<icon>-<tint>-<control>-<Lucide release>-<code>.svg
//   dot-<tint>-<control>-<code>.png
// A process that makes a file then deletes the badges and dots whose names
// aren't current (sweepNoteResultIcons). Nothing a window opens from names
// one: quick views have no app icon, results name theirs afresh on every run,
// and an open sticky window read its app icon when it opened.

// The badge's look, at its size in pixels.
const NOTE_BADGE_STYLE = { size: 128, text: "#1D1D1F", square: { inset: 6, radius: 26, ring: 4 }, icon: { inset: 30 } };

// The dot's look, at its size in pixels: the dot's diameter within the square,
// and its ring's width.
const NOTE_DOT_STYLE = { size: 256, diameter: 168, ring: 12 };

// The icon of `note` (a note from noteStore) for its result: its badge in
// `colour` (a palette colour, its colour from noteColour) or its dot, as an
// absolute path, made first if it's missing.
function noteResultIcon(workflowFolder, note, colour, variable = workflowVariable) {
  const icon = noteIcon(note.meta, variable);
  return icon ? noteBadgeFile(workflowFolder, icon.name, colour, variable) : noteDotFile(colour, variable);
}

// The badge of the note icon named `icon` in `colour` (a palette colour), as
// an absolute path in the cache, made first if it's missing: an SVG of the
// icon in dark text colour on a rounded square of the colour's tint, ringed
// in its control colour. Made from the icon's light button icon, whose file
// holds Lucide's elements as they are.
function noteBadgeFile(workflowFolder, icon, colour, variable = workflowVariable) {
  if (!noteIconByName(icon)) throw new Error(`No badge for ${icon}`);
  return noteResultIconFile(
    noteBadgeName(icon, colour),
    (path) => writeFileAtomically(path, noteBadgeSvg(workflowFolder, icon, colour)),
    variable,
  );
}

// The dot of `colour` (a palette colour), as an absolute path in the cache,
// made first if it's missing: a PNG of a circle of the colour's tint, ringed
// in its control colour. A PNG, as macOS 12 shows dots too.
function noteDotFile(colour, variable = workflowVariable) {
  return noteResultIconFile(noteDotName(colour), (path) => writeDataAtomically(path, noteDotPng(colour)), variable);
}

function noteBadgeName(icon, colour) {
  return `badge-${icon}-${hexName(colour.tint)}-${hexName(colour.control)}-${LUCIDE_VERSION}-${noteDrawingHash("badge")}.svg`;
}

function noteDotName(colour) {
  return `dot-${hexName(colour.tint)}-${hexName(colour.control)}-${noteDrawingHash("dot")}.png`;
}

function hexName(hex) {
  return hex.replace(/^#/, "").toUpperCase();
}

// A short hash of the code that draws a badge or a dot (its function's
// source, its style and, for a badge, how Lucide's strokes are drawn), so a
// change to how one is drawn renames it. Worked out once per process.
const noteDrawingHashes = {};

function noteDrawingHash(kind) {
  if (!noteDrawingHashes[kind]) {
    const source =
      kind === "badge"
        ? [noteBadgeSvg, JSON.stringify(NOTE_BADGE_STYLE), LUCIDE_STROKE]
        : [noteDotPng, JSON.stringify(NOTE_DOT_STYLE)];
    noteDrawingHashes[kind] = textHash(source.join("\n")).slice(0, 6);
  }
  return noteDrawingHashes[kind];
}

// The result icons' folder in the cache.
function noteResultIconsFolder(variable = workflowVariable) {
  return `${workflowCacheFolder(variable)}/icons`;
}

// The paths of the result icons this process has found or made, by name, so
// each is checked on disk once per run (a list asks for one per note), and
// whether it has swept.
const noteResultIconsSeen = new Map();
let noteResultIconsSwept = false;

// The result icon named `name` in the cache, made with `make(path)` if it's
// missing; a process that makes one then sweeps the folder once, keeping the
// result icons of User Configuration's palette.
function noteResultIconFile(name, make, variable) {
  if (noteResultIconsSeen.has(name)) return noteResultIconsSeen.get(name);
  const folder = noteResultIconsFolder(variable);
  const path = `${folder}/${name}`;
  if (!$.NSFileManager.defaultManager.fileExistsAtPath(path)) {
    ensureFolder(folder, true);
    make(path);
    if (!noteResultIconsSwept) {
      noteResultIconsSwept = true;
      sweepNoteResultIcons(folder, notePalette(variable));
    }
  }
  noteResultIconsSeen.set(name, path);
  return path;
}

// Deletes the badges and dots in `folder` whose names aren't current (made
// from colours that aren't in `palette`, another Lucide release or other
// drawing code), and temporary files that a stopped process left more than a
// minute ago.
function sweepNoteResultIcons(folder, palette) {
  const current = new Set(
    palette.flatMap((colour) =>
      NOTE_ICONS.map((icon) => noteBadgeName(icon.name, colour)).concat(noteDotName(colour)),
    ),
  );
  const names = ObjC.deepUnwrap($.NSFileManager.defaultManager.contentsOfDirectoryAtPathError(folder, null)) || [];
  const minuteAgo = Date.now() - 60000;
  for (const name of names) {
    const path = `${folder}/${name}`;
    const stale = /^(badge|dot)-.*\.(svg|png)$/.test(name)
      ? !current.has(name)
      : name.startsWith(".scratchnstick-save-") && (fileDate(path, "NSFileModificationDate") || 0) < minuteAgo;
    if (stale) $.NSFileManager.defaultManager.removeItemAtPathError(path, null);
  }
}

// A badge's SVG text (see noteBadgeFile). `colour` is a palette colour.
function noteBadgeSvg(workflowFolder, icon, colour) {
  const { size, text, square, icon: place } = NOTE_BADGE_STYLE;
  const side = size - 2 * square.inset;
  const iconSize = size - 2 * place.inset;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<!-- Lucide's ${icon} (see the workflow's icons/lucide/LICENSE), on Scratch'n'Stick's ${colour.tint} -->`,
    `<rect x="${square.inset}" y="${square.inset}" width="${side}" height="${side}" rx="${square.radius}" fill="${colour.tint}" stroke="${colour.control}" stroke-width="${square.ring}"/>`,
    `<svg x="${place.inset}" y="${place.inset}" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" ${LUCIDE_STROKE} stroke="${text}">${noteButtonIconElements(workflowFolder, icon)}</svg>`,
    `</svg>`,
    "",
  ].join("\n");
}

// How Lucide's elements are drawn: its root's attributes, besides the stroke's
// colour. The badges and button icons (dev/make-icons.js) share them.
const LUCIDE_STROKE = 'fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

function noteLucideStroke() {
  return LUCIDE_STROKE;
}

// The SVG elements of the icon named `name`: Lucide's, as its light button
// icon holds them, in its group (see dev/make-icons.js).
function noteButtonIconElements(workflowFolder, name) {
  const path = `${workflowFolder}/${noteButtonIconFile(name, "light")}`;
  const match = /<g\b[^>]*>([\s\S]*)<\/g>/.exec(readText(path) || "");
  if (!match) throw new Error(`Can't read the icon in ${path}`);
  return match[1];
}

// A dot's PNG data (see noteDotFile), drawn with AppKit. `colour` is a palette
// colour.
function noteDotPng(colour) {
  const { size, diameter, ring } = NOTE_DOT_STYLE;
  return pngData(
    drawInBitmap(size, () => {
      const inset = (size - diameter) / 2 + ring / 2;
      const dot = $.NSBezierPath.bezierPathWithOvalInRect(
        $.NSMakeRect(inset, inset, size - 2 * inset, size - 2 * inset),
      );
      hexColour(colour.tint).setFill;
      dot.fill;
      hexColour(colour.control).setStroke;
      dot.lineWidth = ring;
      dot.stroke;
    }),
  );
}

// A bitmap `pixels` square, or [width, height], with `draw` drawn into it
// with AppKit, which is loaded only when something is drawn.
function drawInBitmap(pixels, draw) {
  ObjC.import("AppKit");
  const [width, height] = Array.isArray(pixels) ? pixels : [pixels, pixels];
  const rep =
    $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
      $(),
      width,
      height,
      8,
      4,
      true,
      false,
      $.NSCalibratedRGBColorSpace,
      0,
      0,
    );
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep));
  draw();
  $.NSGraphicsContext.restoreGraphicsState;
  return rep;
}

// An sRGB colour from "#RRGGBB", for drawing.
function hexColour(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return $.NSColor.colorWithSRGBRedGreenBlueAlpha(r, g, b, 1);
}

// A bitmap's PNG data.
function pngData(rep) {
  return rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
}

// The appearance, "light" or "dark", that Alfred gives its window, and so a
// quick view, with its current theme. A file image in Alfred UI keeps its own
// colours (it can't be tinted, or follow the appearance), so the quick view's
// button icons are drawn for one or the other. A theme can set it: its
// theme.json's appearanceMode (in its top-level object), taken as 2 for dark
// and 1 for light. Otherwise it comes from the theme's background colour
// ($alfred_theme_background): dark when its luminance is below half. Without a
// theme (a script run by hand), "light". Both come from the variables Alfred
// gives a Script Filter.
function noteQuickAppearance(variable = workflowVariable) {
  const mode = noteThemeAppearanceMode(variable);
  if (mode === 2) return "dark";
  if (mode === 1) return "light";
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(variable("alfred_theme_background") || "");
  if (!match) return "light";
  const [r, g, b] = match.slice(1, 4).map((c) => Math.min(255, Number(c)) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5 ? "dark" : "light";
}

// The current theme's appearanceMode, from its theme.json in Alfred's
// preferences ({ "alfredtheme": { "appearanceMode": 2, … } }), or null.
function noteThemeAppearanceMode(variable = workflowVariable) {
  const preferences = variable("alfred_preferences");
  const theme = variable("alfred_theme");
  if (!preferences || !theme || theme.includes("/")) return null;
  const file = readJsonObject(`${expandPath(preferences)}/themes/${theme}/theme.json`);
  const root = file && Object.values(file).find((value) => value && typeof value === "object");
  const mode = root ? root.appearanceMode : undefined;
  return Number.isInteger(mode) ? mode : null;
}

// The text with a word joiner after the "{" of each {var:, {const:, {value:
// and {data:, so Alfred UI doesn't treat them as placeholders (it's case
// sensitive, and a placeholder may span lines). The word joiner is invisible.
function escapeForAlfredUi(text) {
  return text.replace(/\{(?=(?:var|const|value|data):)/g, `{${WORD_JOINER}`);
}

// Undoes escapeForAlfredUi: removes a word joiner only where it put one.
function unescapeFromAlfredUi(text) {
  return text.replace(new RegExp(`\\{${WORD_JOINER}(var|const|value|data):`, "g"), "{$1:");
}

// The `font_size` setting, in points, within FONT_SIZE: the size of a note's
// text when it has no size of its own.
function noteDefaultFontSize(variable = workflowVariable) {
  const size = parseInt(variable("font_size"), 10);
  return isNaN(size) ? FONT_SIZE.default : Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, size));
}

// The size of its own that a note with metadata `meta` has (its sidecar's
// `fontSize`), rounded and within the range of NOTE_FONT_SIZES, or null if it
// has none, so its text is the `font_size` setting's size.
function noteOwnFontSize(meta) {
  const size = meta && meta.fontSize;
  if (typeof size !== "number" || !isFinite(size)) return null;
  const sizes = noteFontSizes();
  return Math.min(sizes[sizes.length - 1], Math.max(sizes[0], Math.round(size)));
}

// The size a window's text is shown at, from its options or context
// (ownFontSize and defaultFontSize; see noteWindowTokens).
function noteShownFontSize({ ownFontSize = null, defaultFontSize = FONT_SIZE.default }) {
  return typeof ownFontSize === "number" ? ownFontSize : defaultFontSize;
}

// NOTE_FONT_SIZES, smallest first, each once, leaving out anything that isn't
// a whole number of points.
function noteFontSizes() {
  const sizes = [...new Set(NOTE_FONT_SIZES.filter((size) => Number.isInteger(size) && size > 0))].sort(
    (a, b) => a - b,
  );
  if (sizes.length === 0) throw new Error("NOTE_FONT_SIZES has no sizes");
  return sizes;
}

// The size that ⌘+ (`step` 1) or ⌘− (-1) gives text at `size`: the next size
// in NOTE_FONT_SIZES above or below it, or `size` itself past either end.
function steppedNoteFontSize(size, step) {
  const sizes = noteFontSizes();
  const next = step > 0 ? sizes.find((s) => s > size) : sizes.filter((s) => s < size).pop();
  return next === undefined ? size : next;
}

// The folder of a form's window bundles in the workflow's cache folder:
// quick/ for quick views (kept up to date by list.js, see quickWindows) and
// windows/ for sticky windows. Separate folders keep list.js from ever
// rewriting an open sticky window's bundle, and each sticky window's saved
// position is keyed on its own bundle's path.
function noteWindowsFolder(form, variable = workflowVariable) {
  const cache = variable("alfred_workflow_cache");
  if (!cache) throw new Error("alfred_workflow_cache isn't set");
  return `${expandPath(cache)}/${form === "quick" ? "quick" : "windows"}`;
}

function noteBundlePath(id, form, variable = workflowVariable) {
  if (!isNoteId(id)) throw new Error(`Not a note ID: ${JSON.stringify(id)}`);
  return `${noteWindowsFolder(form, variable)}/${id}.alfredui`;
}

function readNoteTemplate(workflowFolder, name) {
  const path = `${workflowFolder}/ui/${name}.json`;
  const text = readText(path);
  if (text === null) throw new Error(`Can't read ${path}`);
  return JSON.parse(text);
}

// The sizes and positions of the top row's buttons and of the drop-downs, in
// points, gathered here to be tuned by hand. The templates take them as
// tokens (see noteWindowTokens), and dev/make-icons.js draws the drop-downs'
// shadows from them (noteDropdownGeometry), so run it after changing a
// drop-down's size. Top-level consts are private to lib.js, so scripts get
// these through functions.
const NOTE_WINDOW_LAYOUT = {
  // The top row: a sticky window's close button at the top left, where a
  // window's close button would be (a sticky window is borderless, with no
  // traffic lights), in a group of the window's own buttons; and two groups,
  // the note's own look (its colour, its icon and its font size) at the top
  // left, after a sticky window's close button, and the actions (Edit / View,
  // then Stick in the quick view) at the top right, before the actions menu's
  // button (…), which is a group of its own so that it stays in a collapsed
  // sticky window. The menu opens at `menuAnchor`, a point just under the
  // button at its left edge, since a menu opens with its first item at the
  // view it's given. `top`, `left` and `right` are each one's distance from
  // the window's edges, in each form, and `spacing` the space between a
  // group's buttons. Every button in the row is a box `button` points square,
  // its image centred in it, so both groups are the same height whatever they
  // show, and the buttons' centres are level, 16 pt down (so `top` is 16 less
  // half a button), where a window's traffic lights are.
  windowButtons: { top: 5, left: 9 },
  customise: { quick: { top: 5, left: 12 }, sticky: { top: 5, left: 44 }, spacing: 10 },
  actions: { quick: { top: 5, right: 42 }, sticky: { top: 5, right: 42 }, spacing: 10 },
  menuButton: { top: 5, right: 10 },
  menuAnchor: { top: 29, right: 31 },
  button: 22,
  // The size of the row's button icons: the note's icon, the Font size
  // button's and the actions', all the same so that their strokes match.
  // `buttonIconSizes` overrides it for glyphs that look small at that size,
  // being short or wide (Aa, the eye), so they look as large as the rest, and
  // for the close button's circle, smaller, about the size of a window's own
  // close button. And the size of the colour button's swatch (a symbol, whose
  // size is its button's font size), and how far it's raised to be level with
  // the button icons' centres, as a symbol sits on its font's baseline, a
  // little low: the button is twice that much shorter than its box, at the
  // top of it, so the swatch's centre is that much higher.
  buttonIcon: 18,
  buttonIconSizes: { "text-size": 19, eye: 20, close: 15 },
  swatch: 16,
  swatchRaise: 1,
  // A collapsed sticky window (see "Collapsing" in window.js): its height,
  // the top row's, which is also the height of the strip along a sticky
  // window's top that a double-click collapses or expands it from, and its
  // title, a label between the close button and the actions menu's button,
  // `top`, `left` and `right` from the window's edges, with its font.
  // `defaultHeight` is the height a window expands to when its height before
  // collapsing isn't known, the height a sticky window opens at.
  collapsed: {
    height: 32,
    title: { top: 8, left: 39, right: 42 },
    titleFont: { size: 13, weight: "semibold" },
    defaultHeight: 288,
  },
  // The drop-downs, the icon and colour pickers: boxes of buttons under the
  // customise group, `top` from the window's top in each form and `left` from
  // its left, with corners of `radius`, `padding` inside, and a shadow around
  // them, `margin` wide. Alfred UI has no shadow, so it's an image drawn by
  // dev/make-icons.js: black at `opacity`, blurred by `blur`, `offset` down.
  dropdown: {
    top: { quick: 34, sticky: 32 },
    left: 8,
    radius: 10,
    padding: 6,
    margin: 8,
    shadow: { blur: 6, offset: 2, opacity: 0.3 },
  },
  // Each drop-down's grid: how many buttons in a row, their size (fixed, so
  // the box's size, and its shadow's, is known), the size of their images
  // (the colour picker's swatches are symbols, sized by their font size), and
  // the space between them. A bordered button doesn't tint its symbol, so the
  // colour picker marks the note's colour with `mark`, a rounded background
  // behind its swatch in a colour that looks like the icon picker's bezel in
  // both appearances (quaternaryLabelColor is barely visible in dark).
  iconPicker: { columns: 7, button: 25, image: 20, spacing: 2 },
  colourPicker: {
    columns: 6,
    button: 25,
    image: 14,
    spacing: 2,
    mark: { background: "unemphasizedSelectedContentBackgroundColor", radius: 5 },
  },
};

// The drop-downs, by name: the icon picker (None and the icons) and the colour
// picker (the palette), each with its grid in NOTE_WINDOW_LAYOUT and how many
// buttons it has.
const NOTE_DROPDOWNS = {
  icon: { layout: "iconPicker", count: () => NOTE_ICONS.length + 1 },
  colour: { layout: "colourPicker", count: () => NOTE_PALETTE_DEFAULTS.length },
};

// The drop-downs' names: "icon" and "colour".
function noteDropdownNames() {
  return Object.keys(NOTE_DROPDOWNS);
}

// A drop-down's sizes, in points: `box`, its box of buttons, and `outer`, the
// box with the shadow's margin around it, the size of the shadow image, with
// the box's corner radius and the shadow's settings.
function noteDropdownGeometry(name) {
  const { columns, button, spacing } = NOTE_WINDOW_LAYOUT[NOTE_DROPDOWNS[name].layout];
  const { padding, margin, radius, shadow } = NOTE_WINDOW_LAYOUT.dropdown;
  const count = NOTE_DROPDOWNS[name].count();
  const across = Math.min(columns, count);
  const rows = Math.ceil(count / columns);
  const box = {
    width: across * button + (across - 1) * spacing + 2 * padding,
    height: rows * button + (rows - 1) * spacing + 2 * padding,
  };
  return {
    box,
    outer: { width: box.width + 2 * margin, height: box.height + 2 * margin },
    margin,
    radius,
    shadow: Object.assign({}, shadow),
  };
}

// A drop-down's shadow, as a path in the workflow folder: a PNG drawn by
// dev/make-icons.js with AppKit's shadow, shipped with the workflow.
function noteDropdownShadowFile(name) {
  return `icons/shadow-${name}-picker.png`;
}

// The values of the templates' tokens for a window, given:
//   workflowFolder, id, form, mode, text, ownFontSize (the note's own font
//   size, or null for none; see noteOwnFontSize), defaultFontSize (the
//   `font_size` setting's), palette (the palette's colours, as notePalette
//   gives them), colour (the slot of the note's colour), icon (an icon's name, or
//   null for none), appearance (the appearance the window's button icons are
//   drawn for, "light" or "dark": always "light" when sticky, as a sticky
//   note's root view is always in light appearance), icons (whether the
//   window can show note icons; see noteIconsSupported), collapsed (whether
//   a sticky window is collapsed; see noteCollapsedHeight)
// Each of NOTE_WINDOW_BUTTON_ICONS is a token too, "@buttonIcon:<name>", its
// button icon as a button's image at its size in the top row, or its SF Symbol
// in a window without note icons.
function noteWindowTokens(
  {
    workflowFolder,
    id,
    form,
    mode,
    text = "",
    ownFontSize = null,
    defaultFontSize = FONT_SIZE.default,
    palette = noteDefaultPalette(),
    colour = DEFAULT_COLOUR,
    icon = null,
    appearance = "light",
    icons = true,
  },
  variable = workflowVariable,
) {
  const current = notePaletteColour(palette, colour) || notePaletteColour(palette, DEFAULT_COLOUR);
  const currentIcon = icons ? noteIconByName(icon) : null;
  const note = escapeForAlfredUi(id);
  const layout = NOTE_WINDOW_LAYOUT;
  const place = (group, position) => ({
    position,
    insets: Object.assign({}, layout[group][form === "quick" ? "quick" : "sticky"]),
  });
  const tokens = {
    "@note": note,
    "@form": form,
    "@mode": mode,
    "@text": escapeForAlfredUi(text),
    "@title": escapeForAlfredUi(noteSummary(text).title),
    "@tint": current.tint,
    "@swatch": current.control,
    "@swatchFont": { size: layout.swatch },
    "@swatchBox": {
      position: "topleft",
      insets: { top: 0, left: 0 },
      size: { width: layout.button, height: layout.button - 2 * layout.swatchRaise },
    },
    "@colourShortcuts": palette.map((c, i) => ({
      shortcut: `⌘${i + 1}`,
      action: noteColourAction({ workflowFolder, note, form, colour: c }),
    })),
    "@fontSize": noteShownFontSize({ ownFontSize, defaultFontSize }),
    "@fontSizeMenu": noteFontSizeMenu({ workflowFolder, note, form, ownFontSize, defaultFontSize }),
    "@fontSizeShortcuts": Object.entries(NOTE_FONT_SIZE_SHORTCUTS).map(([shortcut, choice]) => ({
      shortcut,
      action: noteFontSizeAction({ workflowFolder, note, form, choice }),
    })),
    "@iconImage": noteButtonIconImage(
      workflowFolder,
      currentIcon ? currentIcon.name : "square-dashed-plus",
      appearance,
      noteTopRowIconSize(currentIcon ? currentIcon.name : "square-dashed-plus"),
      icons,
    ),
    "@buttonBox": { size: { width: layout.button, height: layout.button } },
    "@windowButtonsPlace": { position: "topleft", insets: Object.assign({}, layout.windowButtons) },
    "@titleStripBox": { size: { width: 1, height: layout.collapsed.height } },
    "@menuButtonPlace": { position: "topright", insets: Object.assign({}, layout.menuButton) },
    "@menuAnchorPlace": {
      position: "topright",
      insets: Object.assign({}, layout.menuAnchor),
      size: { width: 1, height: 1 },
    },
    "@collapsedTitlePlace": { stretch: "horizontal", insets: Object.assign({}, layout.collapsed.title) },
    "@collapsedTitleFont": Object.assign({}, layout.collapsed.titleFont),
    "@customisePlace": place("customise", "topleft"),
    "@customiseSpacing": layout.customise.spacing,
    "@actionsPlace": place("actions", "topright"),
    "@actionsSpacing": layout.actions.spacing,
    "@dropdowns": [
      noteDropdownCatcher({ workflowFolder, note, form }),
      // Without note icons, update actions still name the icon picker; Alfred
      // UI ignores ids that a window doesn't have.
      ...(icons
        ? [
            noteDropdown({
              workflowFolder,
              form,
              name: "icon",
              buttons: noteIconPickerButtons({ workflowFolder, note, form, icon: currentIcon, appearance }),
            }),
          ]
        : []),
      noteDropdown({
        workflowFolder,
        form,
        name: "colour",
        buttons: noteColourPickerButtons({ workflowFolder, note, form, palette, colour: current }),
      }),
    ],
  };
  for (const name of Object.keys(NOTE_WINDOW_BUTTON_ICONS))
    tokens[`@buttonIcon:${name}`] = noteButtonIconImage(workflowFolder, name, appearance, noteTopRowIconSize(name), icons);
  // The app icon is worked out only when a template names it, which only
  // window.json does, in a sticky window: so its badge is made when open.js
  // writes the sticky window's bundle, and never by the window's own actions,
  // which build only its parts (a colour change would otherwise make a badge
  // for every colour tried).
  Object.defineProperty(tokens, "@iconPath", {
    enumerable: true,
    get: () =>
      form === "sticky" ? noteAppIconPath({ workflowFolder, icon: currentIcon, colour: current }, variable) : null,
  });
  return tokens;
}

// The size, in points, of the button icon named `name` in the top row (see
// NOTE_WINDOW_LAYOUT).
function noteTopRowIconSize(name) {
  const { buttonIcon, buttonIconSizes } = NOTE_WINDOW_LAYOUT;
  return Object.prototype.hasOwnProperty.call(buttonIconSizes, name) ? buttonIconSizes[name] : buttonIcon;
}

// A button's image: the button icon of the icon named `name` drawn for
// `appearance` ("light" or "dark"), at `size` points, or, in a window without
// note icons (`icons` false), its SF Symbol from NOTE_WINDOW_BUTTON_ICONS.
function noteButtonIconImage(workflowFolder, name, appearance, size, icons = true) {
  if (!icons) return { type: "symbol", src: NOTE_WINDOW_BUTTON_ICONS[name] || "questionmark" };
  return {
    type: "file",
    src: `${workflowFolder}/${noteButtonIconFile(name, appearance)}`,
    size: { width: size, height: size },
  };
}

// A sticky window's app icon (`iconpath`), for ⌘-Tab and the Dock: the badge
// of its note's icon (a note icon, or null) in its colour (a palette colour),
// or the Scratch'n'Stick icon for a note without an icon.
function noteAppIconPath({ workflowFolder, icon, colour }, variable = workflowVariable) {
  return icon ? noteBadgeFile(workflowFolder, icon.name, colour, variable) : `${workflowFolder}/ui/appicon.png`;
}

// A drop-down (see NOTE_WINDOW_LAYOUT): a view, `<name>picker`, hidden until
// it's opened (scripts/picker.sh), holding its shadow image and, over it, its
// box of `buttons`, with the window's background colour, rounded corners and a
// hairline border, in rows. Its buttons get their fixed size here.
function noteDropdown({ workflowFolder, form, name, buttons }) {
  const { box, outer, margin, radius } = noteDropdownGeometry(name);
  const { top, left, padding } = NOTE_WINDOW_LAYOUT.dropdown;
  const { columns, button: size, spacing } = NOTE_WINDOW_LAYOUT[NOTE_DROPDOWNS[name].layout];
  const sized = buttons.map((button) =>
    Object.assign(button, { constraints: { size: { width: size, height: size } } }),
  );
  const rows = [];
  for (let i = 0; i < sized.length; i += columns) {
    rows.push({
      type: "view",
      layout: "inline",
      direction: "horizontal",
      spacing,
      components: sized.slice(i, i + columns),
    });
  }
  return {
    id: `${name}picker`,
    type: "view",
    layout: "stack",
    hidden: true,
    constraints: {
      position: "topleft",
      insets: { top: top[form === "quick" ? "quick" : "sticky"] - margin, left: left - margin },
      size: outer,
    },
    components: [
      {
        id: `${name}pickershadow`,
        type: "imageview",
        image: { type: "file", src: `${workflowFolder}/${noteDropdownShadowFile(name)}`, size: outer },
        constraints: { position: "topleft" },
      },
      {
        id: `${name}pickerbox`,
        type: "view",
        layout: "inline",
        direction: "vertical",
        spacing,
        padding,
        background: "windowBackgroundColor",
        cornerradius: radius,
        border: { width: 1, colour: "separatorColor" },
        constraints: { position: "topleft", insets: { top: margin, left: margin }, size: box },
        components: rows,
      },
    ],
  };
}

// The ids of an update that hides the drop-downs and the catcher, as
// picker.sh close does.
function noteDropdownsClosed() {
  return { iconpicker: { hidden: true }, colourpicker: { hidden: true }, pickercatcher: { hidden: true } };
}

// The view that closes a drop-down when the window is clicked anywhere else:
// it covers the note, under the drop-downs and the top row, shown while a
// drop-down is open, and a mouse-down on it runs picker.sh close. Alfred UI
// has no event for a click outside a view. The click goes no further, as
// with a menu.
function noteDropdownCatcher({ workflowFolder, note, form }) {
  return {
    id: "pickercatcher",
    type: "view",
    layout: "stack",
    hidden: true,
    constraints: { stretch: "both" },
    events: [
      {
        triggers: "mousedown",
        action: { type: "script", src: `${workflowFolder}/scripts/picker.sh`, args: ["close", note, form] },
      },
    ],
  };
}

// The icon picker's buttons: None, then the icons, as button icons. The
// note's current choice is bordered, so its bezel marks it. Each runs
// window.js icon, with the icon's name or "none". `note` is the escaped ID.
function noteIconPickerButtons({ workflowFolder, note, form, icon, appearance }) {
  const { image } = NOTE_WINDOW_LAYOUT.iconPicker;
  return [{ name: "none", label: "No icon" }].concat(NOTE_ICONS).map((choice) => ({
    id: `icon-${choice.name}`,
    type: "button",
    text: "",
    bordered: choice.name === (icon ? icon.name : "none"),
    image: noteButtonIconImage(workflowFolder, choice.name === "none" ? "ban" : choice.name, appearance, image),
    tooltip: choice.label,
    accessibility: { label: choice.label },
    events: [
      {
        triggers: "actioned",
        action: { type: "script", src: `${workflowFolder}/scripts/window.js`, args: ["icon", note, form, choice.name] },
      },
    ],
  }));
}

// The colour picker's buttons: `palette`, in order, each as its swatch (the
// circle.fill symbol in its control colour), with its name and ⌘1 to ⌘6 in
// its tooltip. Each is in a view of its own size, `colourmark-<slot>`, which for the
// note's colour has a rounded background, so it looks like the icon picker's
// bezel: a bordered button would draw its symbol in the label colour rather
// than the swatch's. Each runs the colour's action (noteColourAction), as its
// shortcut does.
function noteColourPickerButtons({ workflowFolder, note, form, palette, colour }) {
  const { image, button: size, mark } = NOTE_WINDOW_LAYOUT.colourPicker;
  return palette.map((c, i) => ({
    id: `colourmark-${c.slot}`,
    type: "view",
    layout: "stack",
    background: c.slot === colour.slot ? mark.background : null,
    cornerradius: mark.radius,
    components: [
      {
        id: `colour-${c.slot}`,
        type: "button",
        text: "",
        bordered: false,
        image: { type: "symbol", src: "circle.fill" },
        font: { size: image },
        contenttintcolour: c.control,
        tooltip: `${escapeForAlfredUi(c.label)} (⌘${i + 1})`,
        accessibility: { label: escapeForAlfredUi(c.label) },
        constraints: { size: { width: size, height: size } },
        events: [{ triggers: "actioned", action: noteColourAction({ workflowFolder, note, form, colour: c }) }],
      },
    ],
  }));
}

// The action that gives a window's note colour `colour` (a palette colour),
// for its button in the colour picker and its shortcut: window.js colour,
// which records it and updates the top row. A sticky window's tint is updated
// first, so it changes at once rather than after the script. `note` is the
// escaped ID.
function noteColourAction({ workflowFolder, note, form, colour }) {
  const script = {
    type: "script",
    src: `${workflowFolder}/scripts/window.js`,
    args: ["colour", note, form, String(colour.slot)],
  };
  if (form !== "sticky") return script;
  return [{ type: "json", src: { update: { ids: { note: { background: colour.tint } } } } }, script];
}

// The font size shortcuts: ⌘+ (⌘= on a US keyboard, with or without ⇧, or a
// + key of its own) and ⌘− make the text bigger and smaller, through
// NOTE_FONT_SIZES, and ⌘0 gives it the default size.
const NOTE_FONT_SIZE_SHORTCUTS = { "⌘=": "bigger", "⇧⌘=": "bigger", "⌘+": "bigger", "⌘-": "smaller", "⌘0": "default" };

// The Font size button's menu: Default, the `font_size` setting's size, then
// NOTE_FONT_SIZES, with ✓ on the size the note is shown at, and on Default
// too when that's because it has no size of its own. Each item runs window.js
// fontsize with its choice.
function noteFontSizeMenu({ workflowFolder, note, form, ownFontSize, defaultFontSize }) {
  const shown = noteShownFontSize({ ownFontSize, defaultFontSize });
  const item = (text, on, choice) => ({
    text,
    state: on ? "on" : "off",
    action: noteFontSizeAction({ workflowFolder, note, form, choice }),
  });
  return [item(`Default (${defaultFontSize} pt)`, ownFontSize === null, "default"), { type: "separator" }].concat(
    noteFontSizes().map((size) => item(`${size} pt`, size === shown, String(size))),
  );
}

// The action that gives a window's note a font size, for the Font size menu
// and its shortcuts: window.js fontsize with `choice`, a size in points,
// "bigger", "smaller" or "default". `note` is the escaped ID.
function noteFontSizeAction({ workflowFolder, note, form, choice }) {
  return { type: "script", src: `${workflowFolder}/scripts/window.js`, args: ["fontsize", note, form, choice] };
}

// The actions menu (…, or ⌘K) of a window in `form` and `mode`, `collapsed`
// or not, whose note is `blank` or not: Collapse or Expand in a sticky window,
// or Stick to Desktop in a quick view, then Edit or View, Close, Move to Trash,
// Share… (the note's .md file) and Copy as Rich Text, each with its shortcut in
// brackets where it has one. An item that does nothing is
// greyed out (an item without an action): Edit / View in a collapsed window,
// and sharing and copying a blank note. `note` is the escaped ID.
function noteActionsMenu({ workflowFolder, note, form, mode, collapsed, blank }) {
  const script = (command) => ({
    type: "script",
    src: `${workflowFolder}/scripts/window.js`,
    args: [command, note, form, "{value:editor.text}"],
  });
  const item = (text, action, enabled = true) => (enabled ? { text, action } : { text });
  const sticky = form === "sticky";
  const switchTo = mode === "view" ? "Edit" : "View";
  return [
    sticky
      ? item(collapsed ? "Expand" : "Collapse", script("collapse"))
      : item("Stick to Desktop (⌘P)", script("stick")),
    item(`${switchTo} (⌘E)`, script("toggle"), !collapsed),
    item(sticky ? "Close (⌘W)" : "Close (⎋)", noteCloseAction(form)),
    { type: "separator" },
    item("Move to Trash", script("trash")),
    { type: "separator" },
    item("Share…", script("share"), !blank),
    item("Copy as Rich Text", script("copyrich"), !blank),
  ];
}

// The action that closes a window. A quick view's `finish` carries on to the
// stick route, so it sets `close_view`, for open.js to open nothing.
function noteCloseAction(form) {
  return { type: "json", src: { finish: form === "sticky" ? {} : { variables: { close_view: "1" } } } };
}

// A template with its directives resolved for a form and mode (see above),
// `icons`, whether the window can show note icons, and `collapsed`, whether
// it's a collapsed sticky window.
function resolveNoteTemplate(template, { form, mode, icons = true, collapsed = false, tokens, workflowFolder }) {
  const isToken = (value) => typeof value === "string" && Object.prototype.hasOwnProperty.call(tokens, value);
  const leftOut = (item) =>
    item &&
    typeof item === "object" &&
    ((item["@form"] && item["@form"] !== form) ||
      (item["@mode"] && item["@mode"] !== mode) ||
      (item["@needs"] === "icons" && !icons));
  function resolve(value, inArgs) {
    if (typeof value === "string") {
      if (isToken(value)) return inArgs ? String(tokens[value]) : tokens[value];
      return value;
    }
    if (Array.isArray(value)) {
      return value
        .filter((item) => !leftOut(item))
        .flatMap((item) => (isToken(item) && Array.isArray(tokens[item]) ? tokens[item] : [resolve(item, inArgs)]));
    }
    if (value === null || typeof value !== "object") return value;
    const merged = Object.assign({}, value, value[`@${form}`], value[`@${mode}`], collapsed ? value["@collapsed"] : null);
    const result = {};
    for (const [key, item] of Object.entries(merged)) {
      if (key.startsWith("@")) continue;
      result[key] = resolve(item, inArgs || key === "args");
    }
    if (typeof result.src === "string" && result.src.startsWith("scripts/") && result.type === "script") {
      result.src = `${workflowFolder}/${result.src}`;
    }
    return result;
  }
  return resolve(template, false);
}

// The templates that window.json's root view takes as placeholders, by id
// ({ "id": "content" } is filled with content.json): the note (the web view,
// the editor and the icon picker), the top row's two groups of buttons, the
// note's own look (its colour, icon and font size) at the left and the
// actions (Edit / View and Stick) at the right, and, in a sticky window, the
// note's title, shown while it's collapsed, the strip along the window's top
// that a double-click collapses or expands it from (under the top row's
// buttons), and the window's own buttons (its close button) at the top left;
// and the actions menu's button (…) at the top right.
const NOTE_WINDOW_PARTS = ["content", "customise", "actions", "collapsedtitle", "titlestrip", "windowbuttons", "menubutton"];

// A note window's whole ui.json: window.json, with its placeholders filled
// (NOTE_WINDOW_PARTS). `options` as for noteWindowTokens.
function noteWindowUi(options, variable = workflowVariable) {
  const ui = noteWindowPart(options, "window", variable);
  ui.window.root.components = ui.window.root.components.map((c) =>
    NOTE_WINDOW_PARTS.includes(c.id) ? noteWindowPart(options, c.id, variable) : c,
  );
  return ui;
}

// One of a window's templates ("window", or one of NOTE_WINDOW_PARTS),
// resolved for its form and mode: the customise group, for instance, for a
// replace action after a colour change. `options` as for noteWindowTokens.
function noteWindowPart(options, name, variable = workflowVariable) {
  const { workflowFolder, form, mode, icons = true } = options;
  const collapsed = form === "sticky" && Boolean(options.collapsed);
  const settings = { form, mode, icons, collapsed, tokens: noteWindowTokens(options, variable), workflowFolder };
  return resolveNoteTemplate(readNoteTemplate(workflowFolder, name), settings);
}

// The component with id `id` in a resolved template, or null.
function findNoteComponent(component, id) {
  if (component.id === id) return component;
  for (const child of component.components || []) {
    const found = findNoteComponent(child, id);
    if (found) return found;
  }
  return null;
}

// The mode a note's window opens in: Edit for a new or blank note; otherwise
// the mode its window was last in (its sidecar's `mode`, recorded when the
// mode is switched and when the window closes), or View for a note that has
// never been open in a window, such as a file added to the notes folder by
// another app. `note` is null for a new note.
function noteOpenMode(note, text) {
  if (!note || isBlankText(text)) return "edit";
  return note.meta.mode === "edit" ? "edit" : "view";
}

// Writes the window bundle of a note in `store` for a form ("quick" or
// "sticky") and returns its path. `note` is the note as the store read it, or
// null for a new note; `text` is the text the window opens with. `mode`
// ("edit" or "view"), if given, is the mode to open in, as when a quick view
// is sticky and its window carries on in the same mode; otherwise it's
// noteOpenMode's. A blank note opens in Edit either way. `appearance`, if
// given, is the appearance a quick view's button icons are drawn for
// (quickWindows works it out once for all its bundles); otherwise it's
// noteQuickAppearance's. A sticky window opens collapsed if its note was
// collapsed when its window last closed (see noteCollapsedHeight).
function writeNoteWindow(
  { store, workflowFolder, id, form, note, text, mode: requestedMode, appearance: quickAppearance },
  variable = workflowVariable,
) {
  const mode =
    (requestedMode === "edit" || requestedMode === "view") && !isBlankText(text)
      ? requestedMode
      : noteOpenMode(note, text);
  const meta = note ? note.meta : {};
  const ownFontSize = noteOwnFontSize(meta);
  const defaultFontSize = noteDefaultFontSize(variable);
  const palette = notePalette(variable);
  const colour = noteColourIn(palette, meta, variable).slot;
  const icons = noteIconsSupported(variable);
  const iconOf = noteIcon(meta, variable);
  const icon = iconOf ? iconOf.name : null;
  const appearance = form === "sticky" ? "light" : quickAppearance || noteQuickAppearance(variable);
  const collapsed = form === "sticky" ? noteCollapsedHeight(meta) : null;
  const ui = noteWindowUi(
    {
      workflowFolder,
      id,
      form,
      mode,
      text,
      ownFontSize,
      defaultFontSize,
      palette,
      colour,
      icon,
      appearance,
      icons,
      collapsed: collapsed !== null,
    },
    variable,
  );
  const script = notePageScript(
    mode === "view" ? text : null,
    noteContextColour({ palette, colour }).tint,
    noteShownFontSize({ ownFontSize, defaultFontSize }),
  );
  const page = notePageHtml({ workflowFolder, form, noteVersion: textHash(script) }, variable);
  const context = {
    folder: store.folder,
    ownFontSize,
    defaultFontSize,
    palette,
    colour,
    icon,
    appearance,
    icons,
    collapsed,
    textHash: textHash(text),
  };
  return writeNoteBundle(id, form, { ui, context, page, script }, variable);
}

// The options for noteWindowPart of an open window, from its bundle's
// context, so the parts it's given match its look.
function noteWindowOptions(context, { workflowFolder, id, form, mode }) {
  const {
    ownFontSize = null,
    defaultFontSize = FONT_SIZE.default,
    palette = noteDefaultPalette(),
    colour,
    icon = null,
    appearance = "light",
    icons = true,
    collapsed = null,
  } = context;
  return {
    workflowFolder,
    id,
    form,
    mode,
    ownFontSize,
    defaultFontSize,
    palette,
    colour,
    icon,
    appearance,
    icons,
    collapsed: collapsed !== null,
  };
}

// The colour of a window's note, from its bundle's `context` (its palette
// and its colour's slot): a palette colour.
function noteContextColour(context) {
  const palette = context.palette || noteDefaultPalette();
  return notePaletteColour(palette, context.colour) || notePaletteColour(palette, DEFAULT_COLOUR);
}

// Writes a note's window bundle and returns its path. Its files:
//   ui.json        the window (`ui`)
//   context.json   what the window's scripts need that Alfred doesn't give
//                  them (the UI's scripts only get the alfred_* variables, not
//                  User Configuration): { folder, ownFontSize,
//                  defaultFontSize, palette, colour, icon, appearance, icons,
//                  collapsed, textHash }, the notes folder, the window's look
//                  (the note's own font size or null, the `font_size`
//                  setting's, the palette from User Configuration, the slot
//                  of the note's colour, its icon's name, the
//                  appearance its button icons are drawn for, whether it can
//                  show note icons, see noteWindowTokens, and, for a
//                  collapsed sticky window, the height it expands to, or
//                  null) and a hash of the note's text
//                  as the window last had it (see textHash): the text it
//                  opened with, and then the text its page was last given
//                  (writeNotePage), so the window can tell when the note has
//                  changed since
//   view.html      the page (`page`, from notePageHtml)
//   note.js        the note for the page (`script`, from notePageScript)
// ui.json is written last, as it's the file Alfred opens.
function writeNoteBundle(id, form, { ui, context, page, script }, variable = workflowVariable) {
  const bundle = noteBundlePath(id, form, variable);
  ensureFolder(bundle, true);
  writeFileAtomically(`${bundle}/context.json`, JSON.stringify(context, null, 2) + "\n");
  writeFileAtomically(`${bundle}/view.html`, page);
  writeFileAtomically(`${bundle}/note.js`, script);
  writeFileAtomically(`${bundle}/ui.json`, JSON.stringify(ui, null, 2) + "\n");
  return bundle;
}

// The context written into a note's bundle for a form, or null.
function readNoteContext(id, form, variable = workflowVariable) {
  return readJsonObject(`${noteBundlePath(id, form, variable)}/context.json`);
}

// Merges `changes` into the context of a note's bundle for a form, for a
// window whose look has changed (its note's colour, say), so the parts it's given
// later match. Its ui.json is left as it is: the window has already read it.
function updateNoteContext(id, form, changes, variable = workflowVariable) {
  const context = readNoteContext(id, form, variable);
  if (!context) return;
  writeFileAtomically(
    `${noteBundlePath(id, form, variable)}/context.json`,
    JSON.stringify(Object.assign(context, changes), null, 2) + "\n",
  );
}

// Deletes a note's window bundles, quick and sticky, if it has them: for a
// note that's gone (deleted on close, or moved to the Trash). Its saved window
// position goes with them, as nothing will open from that path again.
function removeNoteBundle(id, variable = workflowVariable) {
  for (const form of ["quick", "sticky"]) {
    const bundle = noteBundlePath(id, form, variable);
    if ($.NSFileManager.defaultManager.fileExistsAtPath(bundle)) removeFile(bundle);
  }
}

// The files a window bundle is built from, besides the note: the templates,
// and this file, which builds them. A change to any (a workflow update) makes
// every quick bundle out of date.
const NOTE_WINDOW_SOURCES = [
  "ui/window.json",
  "ui/customise.json",
  "ui/actions.json",
  "ui/content.json",
  "ui/windowbuttons.json",
  "ui/collapsedtitle.json",
  "ui/titlestrip.json",
  "ui/menubutton.json",
  "ui/view.html",
  "ui/view.js",
  "scripts/lib.js",
  "scripts/titles.js",
];

// Quick views' bundles, for list.js. ↩ on a result opens its bundle straight
// from the Script Filter, with nothing in between: a Run Script or Conditional
// there makes Alfred hide its window and fade the view in (see "Quick notes
// and sticky notes" in DESIGN.md). So each note's quick bundle has to be ready
// before the results are shown.
//
// A bundle's fingerprint is a hash of everything it's built from: the note's
// text, its mode, colour, icon and font size (from its sidecar and the
// settings), the `font_size` setting (the menu's Default), the palette, the appearance of the quick view's button icons (from Alfred's theme;
// see noteQuickAppearance), whether the Mac can show note icons
// (noteIconsSupported), the notes and workflow folders, and the modification
// times of NOTE_WINDOW_SOURCES. The fingerprints are kept in quick/.index.json,
// read once per run, so a bundle is only rebuilt when its fingerprint changes:
// usually none, one after a note is edited, every one after a setting or the
// workflow changes.
//
//   bundleFor(note)     the quick bundle of a note from store.list(), rebuilt
//                       if it's out of date
//   bundleForNew(seed)  a quick bundle for a new note starting with `seed`
//                       (as newNoteText in titles.js makes it), with a new
//                       ID, a different one on each call in a run
//   finish(notes)       removes the bundles and fingerprints of notes that
//                       are gone, given every note in the folder, keeping any
//                       that's open (has a window state), and saves the index
function quickWindows(store, workflowFolder, readVariable = workflowVariable) {
  const fm = $.NSFileManager.defaultManager;
  const variable = cachedVariables(readVariable);
  const folder = noteWindowsFolder("quick", variable);
  const indexPath = `${folder}/.index.json`;
  const index = new Map(Object.entries(readJsonObject(indexPath) || {}));
  const entries = fm.contentsOfDirectoryAtPathError(folder, null);
  const bundles = new Set(entries.isNil() ? [] : ObjC.deepUnwrap(entries));
  const sources = NOTE_WINDOW_SOURCES.map((path) => {
    const date = fileDate(`${workflowFolder}/${path}`, "NSFileModificationDate");
    return date ? date.getTime() : 0;
  });
  const appearance = noteQuickAppearance(variable);
  const palette = notePalette(variable);
  const base = JSON.stringify([
    workflowFolder,
    store.folder,
    noteDefaultFontSize(variable),
    palette,
    appearance,
    noteIconsSupported(variable),
    sources,
  ]);
  let changed = false;
  const newIds = new Set();

  function bundleFor(note) {
    const icon = noteIcon(note.meta, variable);
    const fingerprint = textHash(
      [
        base,
        noteOpenMode(note, note.text),
        noteColourIn(palette, note.meta, variable).slot,
        icon ? icon.name : "",
        String(noteOwnFontSize(note.meta)),
        note.text,
      ].join("\0"),
    );
    if (index.get(note.id) === fingerprint && bundles.has(`${note.id}.alfredui`))
      return `${folder}/${note.id}.alfredui`;
    const bundle = writeNoteWindow(
      { store, workflowFolder, id: note.id, form: "quick", note, text: note.text, appearance },
      variable,
    );
    index.set(note.id, fingerprint);
    changed = true;
    return bundle;
  }

  // A new note's ID is the time the run started, so on each run within the
  // same second it's the same ID and bundle; a bundle from an earlier second
  // is removed by the next finish. A second new note in the same run (New note
  // from the clipboard, beside New note) gets the next ID, -2, even if writing
  // the first bundle took the clock into the next second.
  const started = new Date();
  function bundleForNew(seed) {
    const id = store.newId({ date: started, isTaken: (id) => newIds.has(id) || isNoteIdInUse(id, variable) });
    newIds.add(id);
    return writeNoteWindow(
      { store, workflowFolder, id, form: "quick", note: null, text: newNoteText(seed), appearance },
      variable,
    );
  }

  function finish(notes) {
    const ids = new Set(notes.map((note) => note.id));
    for (const id of index.keys()) {
      if (!ids.has(id)) {
        index.delete(id);
        changed = true;
      }
    }
    for (const name of bundles) {
      if (!name.endsWith(".alfredui")) continue;
      const id = name.slice(0, -".alfredui".length);
      if (ids.has(id) || newIds.has(id) || !isNoteId(id) || fm.fileExistsAtPath(noteStatePath(id, variable))) continue;
      removeFile(`${folder}/${name}`);
    }
    if (changed) {
      ensureFolder(folder, true);
      writeFileAtomically(indexPath, JSON.stringify(Object.fromEntries(index)) + "\n");
    }
  }

  return { bundleFor, bundleForNew, finish };
}

// A Script Filter result that creates a note starting with `text` (list.js's
// New note, and new.js's results), as newNoteText in titles.js makes it from
// `text`. Its arg is `bundle`, the quick view of the new note (quickWindows'
// bundleForNew), which ↩ opens inside Alfred. ⌘'s arg is the text itself, with
// the variable `new`, so open.js knows it isn't a note's ID, and sticks the
// new note. ⌥ and ⌃ do nothing: in the results list their actions take a
// note's ID or path.
function newNoteResult(title, subtitle, text, bundle) {
  const variables = { new: "1" };
  return {
    title,
    subtitle,
    arg: bundle,
    mods: {
      cmd: { subtitle: "Create it as a sticky note", arg: text, variables },
      alt: { subtitle, valid: false },
      ctrl: { subtitle, valid: false },
    },
  };
}

// The subtitle of a New note result for text typed after a keyword, which
// says whether the text starts the note as its heading (seedHeading in
// titles.js).
function newNoteSubtitle(text) {
  return seedHeading(text) === null ? "Create a note with this text" : "Create a note with this heading";
}

// A short hash of a string (cyrb53, 53 bits, in base 36), for fingerprints:
// not cryptographic, but a chance collision is negligible.
function textHash(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// ---------------------------------------------------------------------------
// The note's page
//
// View mode is a web view of the bundle's view.html, built from ui/view.html
// with ui/view.js inlined, which renders the note with the vendored
// markdown-it. The note's text comes from note.js beside it, as a script,
// since the page can't read files (XMLHttpRequest and fetch fail), and the
// page loads it as note.js?v=<version>, since WebKit keeps a script it has
// loaded under the same URL. The note's text never passes through ui.json, so
// it isn't escaped for Alfred UI's placeholders.
//
// The page reports that it has drawn, and clicks on task boxes, by changing
// its URL's fragment, which the web view's `changed` event passes to
// scripts/changed.sh (see ui/view.js).
//
// A quick view's page takes its colour and opacity from Alfred's theme, through
// the theme stylesheet that list.js writes (see noteThemeStylesheet).

const MARKDOWN_IT = "vendor/markdown-it/markdown-it.umd.min.js";

// A note's view.html, from ui/view.html: `form` ("quick" or "sticky") and
// `noteVersion`, the version of the bundle's note.js it was written with (the
// page uses it when its own URL has no ?v=).
function notePageHtml({ workflowFolder, form, noteVersion }, variable = workflowVariable) {
  const template = readText(`${workflowFolder}/ui/view.html`);
  const script = readText(`${workflowFolder}/ui/view.js`);
  if (template === null || script === null) throw new Error(`Can't read ${workflowFolder}/ui/view.html or view.js`);
  if (/<\/script/i.test(script))
    throw new Error("ui/view.js can't contain </script, as it's inlined in a <script> element");
  const theme = form === "quick" ? fileUrl(noteThemePath(variable)) : null;
  const values = {
    form,
    markdownIt: escapeHtml(fileUrl(`${workflowFolder}/${MARKDOWN_IT}`)),
    themeStylesheet: JSON.stringify(theme).replace(/</g, "\\u003c"),
    noteVersion,
    pageScript: script,
  };
  // One pass, so nothing in a value is taken for a token.
  return template.replace(/@(\w+)@/g, (token, name) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) throw new Error(`Unknown token in ui/view.html: ${token}`);
    return values[name];
  });
}

// A note's note.js: its `text` for the page (null for a window that opens in
// Edit, whose page shows nothing until it's switched to View), its colour's
// `tint`, for a sticky window's page, and the size of its text, `fontSize`,
// in points. The page's look comes from here, rather than from view.html, so
// a change to it only needs the page reloaded.
function notePageScript(text, tint, fontSize) {
  return `window.NOTE = ${JSON.stringify(text)};\nwindow.NOTE_TINT = ${JSON.stringify(tint)};\nwindow.NOTE_FONT_SIZE = ${JSON.stringify(Number(fontSize))};\n`;
}

// Gives the page of a note's open window `text`: rewrites its bundle's note.js
// (with the colour and font size in its context) and records the text's hash in its
// context, as the text a tick is checked against. Returns the URL that
// reloads the page with it, for an update of the web view's `src`: an
// absolute file:// URL (a relative one is taken for https://), with a
// version that's new every time, so the page reloads even when the text is
// the same, and loads note.js afresh.
function writeNotePage(id, form, text, variable = workflowVariable) {
  const bundle = noteBundlePath(id, form, variable);
  const context = readNoteContext(id, form, variable) || {};
  const script = notePageScript(text, noteContextColour(context).tint, noteShownFontSize(context));
  writeFileAtomically(`${bundle}/note.js`, script);
  updateNoteContext(id, form, { textHash: textHash(text) }, variable);
  return `${fileUrl(`${bundle}/view.html`)}?v=${textHash(script)}.${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Rich text: Copy as Rich Text in the actions menu
//
// A note's text rendered as the View page renders it, with markdown-it and
// ui/view.js's rule for task boxes, loaded here as the tests load them. The
// task boxes become ☐ and ☑, as rich text has no checkboxes, and the page is
// set in the system font at 13 pt, like a note, so pasted text looks like it.

let noteMarkdownRenderer = null;

// `text` (Markdown) as a whole HTML document, for rich text.
function noteRichHtml(workflowFolder, text) {
  if (!noteMarkdownRenderer) {
    for (const path of [`${workflowFolder}/${MARKDOWN_IT}`, `${workflowFolder}/ui/view.js`]) {
      const source = readText(path);
      if (source === null) throw new Error(`Can't read ${path}`);
      (0, eval)(source);
    }
    noteMarkdownRenderer = noteMarkdown(markdownit);
  }
  const body = noteMarkdownRenderer
    .render(text)
    .replace(/<input type="checkbox" data-line="\d+"( checked)?>/g, (box, checked) => (checked ? "☑ " : "☐ "));
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<style>body { font: 13px -apple-system, "Helvetica Neue", sans-serif; } li.task { list-style: none; }</style>',
    `</head><body>${body}</body></html>`,
  ].join("");
}

// `text` (Markdown) rendered (noteRichHtml) as rich text: { html, rtf }, the
// HTML and RTF data made from it by macOS's text system.
function noteRichText(workflowFolder, text) {
  ObjC.import("AppKit");
  const html = noteRichHtml(workflowFolder, text);
  const data = $(html).dataUsingEncoding($.NSUTF8StringEncoding);
  const options = $({ DocumentType: $.NSHTMLTextDocumentType, CharacterEncoding: $.NSUTF8StringEncoding });
  const rich = $.NSAttributedString.alloc.initWithDataOptionsDocumentAttributesError(data, options, null, null);
  if (rich.isNil()) throw new Error("Couldn't make rich text of the note");
  const rtf = rich.dataFromRangeDocumentAttributesError(
    $.NSMakeRange(0, rich.length),
    $({ DocumentType: $.NSRTFTextDocumentType }),
    null,
  );
  if (rtf.isNil()) throw new Error("Couldn't make RTF of the note");
  return { html, rtf };
}

// Puts a note on the clipboard as rich text: the RTF and HTML of its `text`
// rendered (noteRichText), for apps that paste formatting, such as Notes, Mail
// and Pages, and `text` itself as plain text, for those that don't.
function copyNoteAsRichText(workflowFolder, text) {
  const { html, rtf } = noteRichText(workflowFolder, text);
  const pasteboard = $.NSPasteboard.generalPasteboard;
  pasteboard.clearContents;
  pasteboard.setDataForType(rtf, $.NSPasteboardTypeRTF);
  pasteboard.setStringForType($(html), $.NSPasteboardTypeHTML);
  pasteboard.setStringForType($(text), $.NSPasteboardTypeString);
}

// A task box's line in a note: optional block quote markers and indent, a
// bullet or number, then the box. markdown-it's own rule for a task (in
// ui/view.js) is stricter, so a line the page ticks always matches.
const NOTE_TASK_LINE = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])(\][ \t])/;

// The note's `text` with the task box on line `line` (counting from 0)
// ticked (`done` true) or unticked, or null if that line isn't a task box in
// the other state.
function toggleNoteTask(text, line, done) {
  const lines = text.split("\n");
  const match = Number.isInteger(line) && line >= 0 && line < lines.length ? NOTE_TASK_LINE.exec(lines[line]) : null;
  if (!match || (match[2] !== " ") === done) return null;
  lines[line] = `${match[1]}${done ? "x" : " "}${match[3]}${lines[line].slice(match[0].length)}`;
  return lines.join("\n");
}

// The theme stylesheet: <cache>/theme.css, linked by every quick view's page,
// so a change of Alfred's theme rebuilds no bundles.
function noteThemePath(variable = workflowVariable) {
  const cache = variable("alfred_workflow_cache");
  if (!cache) throw new Error("alfred_workflow_cache isn't set");
  return `${expandPath(cache)}/theme.css`;
}

// The lowest opacity a quick view's web view is shown at, and the alpha of
// the system's label colour, in both appearances.
const THEME_MIN_OPACITY = 0.8;
const THEME_TEXT_ALPHA = 0.85;

// The theme stylesheet for Alfred's theme background, `background`
// ($alfred_theme_background, "rgba(r,g,b,a)", which Alfred gives a Script
// Filter). It sets the page's custom properties (see ui/view.html):
//   --panel     the page's background
//   --opacity   the web view's opacity, which the page reports once it has
//               drawn (see ui/view.js)
//   --text, --text-done, --link   stronger colours, below full opacity
//
// A web view can't be see-through (WebKit paints an opaque fill under the
// page), so a translucent theme is imitated: the panel is the theme's colour
// over the appearance's base (#1E1E1E in dark appearance, white in light) at
// the theme's alpha, and the web view is shown at that alpha, but no lower
// than THEME_MIN_OPACITY. The text fades with the view, so below full opacity
// it's drawn at THEME_TEXT_ALPHA ÷ opacity (at most 1), and links brighter, to
// land at its normal strength. A solid theme gets its exact colour at full
// opacity, with the system's colours. Without a theme colour, the page keeps
// its own colours at full opacity.
function noteThemeStylesheet(background) {
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(background || "");
  if (!match) return "/* No theme colour: the page's own colours, at full opacity. */\n";
  const clamp = (value, max) => Math.min(max, Math.max(0, value));
  const [r, g, b] = match.slice(1, 4).map((c) => clamp(Number(c), 255));
  const alpha = match[4] === undefined || isNaN(Number(match[4])) ? 1 : clamp(Number(match[4]), 1);
  const opacity = Math.max(THEME_MIN_OPACITY, alpha);
  const mix = (base) => `rgb(${[r, g, b].map((c) => Math.round(alpha * c + (1 - alpha) * base)).join(", ")})`;
  const lines = [
    `:root { --panel: ${mix(0x1e)}; --opacity: ${opacity}; }`,
    `@media (prefers-color-scheme: light) { :root { --panel: ${mix(0xff)}; } }`,
  ];
  if (opacity < 1) {
    const text = Math.min(1, THEME_TEXT_ALPHA / opacity);
    const done = text * 0.6;
    const rgba = (c, a) => `rgba(${c}, ${c}, ${c}, ${a.toFixed(2)})`;
    lines.push(
      `@media (prefers-color-scheme: dark) { :root { --text: ${rgba(255, text)}; --text-done: ${rgba(255, done)}; --link: #4DA3FF; } }`,
    );
    lines.push(
      `@media (prefers-color-scheme: light) { :root { --text: ${rgba(0, text)}; --text-done: ${rgba(0, done)}; --link: #0058D0; } }`,
    );
  }
  return lines.join("\n") + "\n";
}

// Writes the theme stylesheet for `background` (see noteThemeStylesheet), if
// it has changed. Returns whether it wrote it.
function writeNoteTheme(background, variable = workflowVariable) {
  const path = noteThemePath(variable);
  const css = noteThemeStylesheet(background);
  if (readText(path) === css) return false;
  ensureFolder($(path).stringByDeletingLastPathComponent.js, true);
  writeFileAtomically(path, css);
  return true;
}

// A file's file:// URL, percent-encoded.
function fileUrl(path) {
  return $.NSURL.fileURLWithPath(path).absoluteString.js;
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Window state
//
// Each open window's state is in <cache>/state/<id>.json, { form, pid, mode,
// collapsed }: its form ("quick" or "sticky"), the process it runs in (its
// Alfred UI helper's when sticky, Alfred's own when quick), its mode ("edit"
// or "view") and whether it's collapsed (a sticky window only; see
// "Collapsing" in window.js). The window's `launched` event writes it, the
// Edit / View toggle updates the mode, collapsing and expanding update
// `collapsed`, and `quit` removes it. A window whose process is killed
// leaves its state behind, so a sticky note counts as open only while its
// process is alive (stickyNotePid).
//
// Beside it, <id>.picker holds the name of the window's open drop-down ("icon"
// or "colour"), and exists only while one is open: it's written by
// scripts/picker.sh, which reads the state with zsh builtins but doesn't
// rewrite JSON. `launched` and `quit` remove it.

function noteStateFolder(variable = workflowVariable) {
  const cache = variable("alfred_workflow_cache");
  if (!cache) throw new Error("alfred_workflow_cache isn't set");
  return `${expandPath(cache)}/state`;
}

function noteStatePath(id, variable = workflowVariable) {
  if (!isNoteId(id)) throw new Error(`Not a note ID: ${JSON.stringify(id)}`);
  return `${noteStateFolder(variable)}/${id}.json`;
}

function readNoteState(id, variable = workflowVariable) {
  return readJsonObject(noteStatePath(id, variable));
}

function writeNoteState(id, state, variable = workflowVariable) {
  const path = noteStatePath(id, variable);
  ensureFolder($(path).stringByDeletingLastPathComponent.js, true);
  writeFileAtomically(path, JSON.stringify(state) + "\n");
}

function removeNoteState(id, variable = workflowVariable) {
  const path = noteStatePath(id, variable);
  if ($.NSFileManager.defaultManager.fileExistsAtPath(path)) removeFile(path);
  closeNotePickerState(id, variable);
}

// Closes a window's open drop-down in its state (see above), and returns
// whether one was open.
function closeNotePickerState(id, variable = workflowVariable) {
  const path = `${noteStatePath(id, variable).slice(0, -".json".length)}.picker`;
  if (!$.NSFileManager.defaultManager.fileExistsAtPath(path)) return false;
  removeFile(path);
  return true;
}

// The process ID of the note's sticky window, or null if it has none: its
// state says sticky, and that process is still an Alfred UI helper (so a
// process ID reused by another app doesn't count).
function stickyNotePid(id, variable = workflowVariable) {
  const state = readNoteState(id, variable);
  if (!state || state.form !== "sticky" || !Number.isInteger(state.pid)) return null;
  const app = runningApp(state.pid);
  if (!app || app.isTerminated) return null;
  const executable = app.executableURL.isNil() ? "" : app.executableURL.path.js;
  return executable.endsWith("/Alfred UI") ? state.pid : null;
}

// The IDs of the notes that have a sticky window (see stickyNotePid), from
// the state folder, listed once.
function stickyNoteIds(variable = workflowVariable) {
  const names =
    ObjC.deepUnwrap($.NSFileManager.defaultManager.contentsOfDirectoryAtPathError(noteStateFolder(variable), null)) ||
    [];
  const ids = names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -".json".length));
  return new Set(ids.filter((id) => isNoteId(id) && stickyNotePid(id, variable) !== null));
}

// The height in points that a note's collapsed sticky window expands back to,
// from its sidecar's `collapsed` (see "Collapsing" in window.js), or null if
// it isn't collapsed.
function noteCollapsedHeight(meta) {
  const height = meta && meta.collapsed;
  return typeof height === "number" && isFinite(height) && height > 0 ? Math.round(height) : null;
}

// A collapsed sticky window's sizes, as a copy: { height, title, titleFont,
// defaultHeight } (see NOTE_WINDOW_LAYOUT).
function noteCollapsedLayout() {
  return JSON.parse(JSON.stringify(NOTE_WINDOW_LAYOUT.collapsed));
}

// The height in points of the window of the process `pid` that's on screen,
// or null if it has none. CoreGraphics gives a window's bounds without any
// permission (only its title needs Screen Recording). A sticky window is
// borderless, so its height is its content's, as a `window` action's
// `resize` sets it.
function noteWindowHeight(pid) {
  ObjC.import("CoreGraphics");
  const onScreenOnly = 1;
  const windows = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(onScreenOnly, 0))) || [];
  const window = windows.find((w) => w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0 && w.kCGWindowBounds);
  return window ? Math.round(window.kCGWindowBounds.Height) : null;
}

// Brings the window of the Alfred UI process `pid` to the front.
function activateWindowProcess(pid) {
  const app = runningApp(pid);
  return Boolean(app && app.activateWithOptions($.NSApplicationActivateAllWindows));
}

// The running app with process ID `pid`, or null. AppKit is imported only
// here, so scripts that don't need it don't pay for loading it.
function runningApp(pid) {
  ObjC.import("AppKit");
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  return app.isNil() ? null : app;
}

// Ends the process of a note's sticky window, if it has one, without its
// `quit` event, so nothing writes the note back (for moving it to the
// Trash). Returns whether there was one.
function closeStickyNoteWindow(id, variable = workflowVariable) {
  const pid = stickyNotePid(id, variable);
  if (pid === null) return false;
  runningApp(pid).forceTerminate;
  removeNoteState(id, variable);
  return true;
}

// Whether `id` is in use by a note that's open but may not be saved yet: it
// has a sticky window bundle or a window state. For noteStore's newId. A
// quick bundle alone doesn't count: list.js writes one for each new note it
// offers, and reuses its ID within the same second.
function isNoteIdInUse(id, variable = workflowVariable) {
  const fm = $.NSFileManager.defaultManager;
  return (
    fm.fileExistsAtPath(noteBundlePath(id, "sticky", variable)) || fm.fileExistsAtPath(noteStatePath(id, variable))
  );
}

// The clipboard's text, for a new note, or null if it has none worth offering:
// no plain text, only whitespace, files copied in Finder (which also put their
// names on the clipboard as text), or text that the app copying it marked as
// concealed or transient (a password manager's, say), as Alfred's own
// clipboard history leaves out. `pasteboardName` is a named pasteboard to read
// instead of the general one, for testing.
function clipboardText(pasteboardName = "") {
  ObjC.import("AppKit");
  const pasteboard = pasteboardName
    ? $.NSPasteboard.pasteboardWithName(pasteboardName)
    : $.NSPasteboard.generalPasteboard;
  const types = pasteboard.types.isNil() ? [] : ObjC.deepUnwrap(pasteboard.types);
  const skip = ["public.file-url", "org.nspasteboard.ConcealedType", "org.nspasteboard.TransientType"];
  if (types.some((type) => skip.includes(type))) return null;
  const text = pasteboard.stringForType("public.utf8-plain-text");
  if (text.isNil() || isBlankText(text.js)) return null;
  return text.js;
}

// The JSON object in a file, or null if it's missing or isn't one.
function readJsonObject(path) {
  const text = readText(path);
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Files

// The file's text as UTF-8, falling back to the encoding Foundation detects;
// null if it's missing or unreadable.
function readText(path) {
  let text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  if (text.isNil()) text = $.NSString.stringWithContentsOfFileUsedEncodingError(path, null, null);
  return text.isNil() ? null : text.js;
}

// Writes `text` as UTF-8 to `path` so that no reader ever sees a partial file:
// the text goes to a hidden temporary file in the same folder, which then
// replaces the original. replaceItemAtURL keeps the original's birth time,
// permissions and extended attributes (Finder tags); Cocoa's own atomic write
// doesn't (tested). When several saves race, the last one to finish wins
// whole. The temporary file is written as data, not a string, so no
// com.apple.TextEncoding attribute is added.
function writeFileAtomically(path, text) {
  writeDataAtomically(path, $(text).dataUsingEncoding($.NSUTF8StringEncoding));
}

// As writeFileAtomically, for NSData (an image's, say).
function writeDataAtomically(path, data) {
  const fm = $.NSFileManager.defaultManager;
  const folder = $(path).stringByDeletingLastPathComponent.js;
  const temp = `${folder}/.scratchnstick-save-${$.NSUUID.UUID.UUIDString.js}.tmp`;
  if (!data.writeToFileAtomically(temp, false)) throw new Error(`Can't write ${temp}`);
  const error = $();
  let done = false;
  if (!fm.fileExistsAtPath(path)) {
    done = fm.moveItemAtPathToPathError(temp, path, error);
  }
  // Also covers a new file another save created after the check above.
  if (!done && fm.fileExistsAtPath(path)) {
    done = fm.replaceItemAtURLWithItemAtURLBackupItemNameOptionsResultingItemURLError(
      $.NSURL.fileURLWithPath(path),
      $.NSURL.fileURLWithPath(temp),
      $(), // no backup: $() is nil, while null would be NSNull, which crashes it
      0,
      null,
      error,
    );
  }
  if (!done) {
    fm.removeItemAtPathError(temp, null);
    throw new Error(`Can't save ${path}: ${errorText(error)}`);
  }
}

function removeFile(path) {
  const error = $();
  if (!$.NSFileManager.defaultManager.removeItemAtPathError(path, error)) {
    throw new Error(`Can't delete ${path}: ${errorText(error)}`);
  }
}

function fileDate(path, key) {
  const attributes = $.NSFileManager.defaultManager.attributesOfItemAtPathError(path, null);
  return attributes.isNil() ? null : jsDate(attributes.objectForKey(key));
}

function jsDate(nsDate) {
  return nsDate.isNil() ? null : new Date(nsDate.timeIntervalSince1970 * 1000);
}

// The description of an NSError from an out-parameter. Pass `$()` as the
// parameter, not `Ref()`: reading an NSError back from a Ref crashes
// osascript (tested on moveItemAtPath and copyItemAtPath).
function errorText(error) {
  return error && !error.isNil() ? error.localizedDescription.js : "unknown error";
}

// ---------------------------------------------------------------------------
// Dates

// A date as ISO 8601 in local time with its UTC offset, e.g.
// 2026-11-20T15:30:12+13:00, which Date() parses back exactly.
function formatLocalIsoDate(date) {
  const pad = (n) => String(Math.abs(n)).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${offset < 0 ? "-" : "+"}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  );
}

function parseDate(value) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return isNaN(date) ? null : date;
}

// ---------------------------------------------------------------------------
// Text

function isBlankText(text) {
  return /^\s*$/.test(text);
}

// A note's title and preview, as plain text, from its Markdown.
//
// The title is the first line with any text once Markdown markers are removed
// (cleanMarkdownLine), or "Untitled". The preview is the lines after it,
// cleaned the same way and joined: " | " before a heading, ": " after one,
// ", " between list items, and a space between other lines, so
// "### Decisions / - a / - b / ### Actions / - c" gives
// "Decisions: a, b | Actions: c". A note that's a single long line, not a
// heading, is split between the title and the preview where it reads well
// (splitTitleLine in titles.js). Both are truncated on whole characters
// (truncateText). A leading YAML front matter block, as other apps write, is
// skipped.
function noteSummary(text, { titleLength = TITLE_MAX_LENGTH, previewLength = PREVIEW_MAX_LENGTH } = {}) {
  let title = null;
  let titleIsHeading = false;
  let preview = "";
  let previewCount = 0;
  let previous = null;
  for (const raw of markdownBodyLines(text)) {
    const line = cleanMarkdownLine(raw);
    if (!line.text) continue;
    if (title === null) {
      title = line.text;
      titleIsHeading = line.isHeading;
      continue;
    }
    let separator = " ";
    if (previous === null) separator = "";
    else if (line.isHeading) separator = " | ";
    else if (previous.isHeading) separator = ": ";
    else if (line.isList && previous.isList) separator = ", ";
    preview += separator + line.text;
    previous = line;
    previewCount += graphemes(separator + line.text).length;
    if (previewCount > previewLength) break;
  }
  const split = title !== null && previous === null && !titleIsHeading ? splitTitleLine(title) : null;
  if (split) ({ title, rest: preview } = split);
  return {
    title: truncateText(title === null ? UNTITLED : title, titleLength),
    preview: truncateText(preview, previewLength),
  };
}

// The text's lines, without a leading YAML front matter block: a first line of
// `---`, a `key:` line next, and a closing `---` or `...` line.
function markdownBodyLines(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 2 && lines[0].trim() === "---" && /^[\w-]+\s*:/.test(lines[1])) {
    for (let i = 2; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === "---" || line === "...") return lines.slice(i + 1);
    }
  }
  return lines;
}

// One line of Markdown as plain text: { text, isList, isHeading }. Removes
// block markers (heading #s, > quotes, list bullets and numbers, task boxes)
// and inline markup (emphasis, code, links and images, escapes). Code fence
// lines, thematic breaks and setext underlines become empty. Only # headings
// count as headings: a setext heading's text comes before its underline.
function cleanMarkdownLine(line) {
  let s = line.trim();
  if (/^(```|~~~)/.test(s) || /^([-*_])(\s*\1){2,}$/.test(s) || /^=+$/.test(s)) {
    return { text: "", isList: false, isHeading: false };
  }
  s = s.replace(/^(>\s?)+/, "");
  const isHeading = /^#{1,6}(\s+|$)/.test(s);
  if (isHeading) s = s.replace(/^#{1,6}(\s+|$)/, "").replace(/\s+#+$/, "");
  let isList = false;
  const bullet = s.match(/^([-*+]|\d{1,9}[.)])(\s+|$)/);
  if (bullet) {
    isList = true;
    s = s.slice(bullet[0].length);
  }
  const task = s.match(/^\[[ xX]\](\s+|$)/);
  if (task) {
    isList = true;
    s = s.slice(task[0].length);
  }
  return { text: cleanInlineMarkdown(s).replace(/\s+/g, " ").trim(), isList, isHeading };
}

function cleanInlineMarkdown(s) {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(\S(?:.*?\S)?)\*\*/g, "$1")
    .replace(/~~(\S(?:.*?\S)?)~~/g, "$1")
    .replace(/(^|\W)__(\S(?:.*?\S)?)__(?=\W|$)/g, "$1$2")
    .replace(/(^|[^\w*])\*(\S(?:.*?\S)?)\*(?=[^\w*]|$)/g, "$1$2")
    .replace(/(^|\W)_(\S(?:.*?\S)?)_(?=\W|$)/g, "$1$2")
    .replace(/\\([\\`*_{}[\]()#+\-.!~>|])/g, "$1");
}

// `text` cut to at most `maxLength` characters, counting what a reader sees
// as one character (an emoji with modifiers, a letter with combining accents,
// a flag) as one, and never splitting one. A cut text ends with "…", which
// counts towards the length.
function truncateText(text, maxLength) {
  const characters = graphemes(text);
  if (characters.length <= maxLength) return text;
  return (
    characters
      .slice(0, Math.max(maxLength - 1, 0))
      .join("")
      .replace(/[\s,;:·|]+$/, "") + "…"
  );
}

let graphemeSegmenter = null;

// The text split into grapheme clusters. Falls back to code points where
// Intl.Segmenter is missing.
function graphemes(text) {
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return Array.from(text);
  if (!graphemeSegmenter) graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
}
