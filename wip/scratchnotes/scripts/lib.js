// ScratchNotes shared code, loaded by every script with loadLib (see "Loading
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
const META_FOLDER = ".scratchnotes";
const TITLE_MAX_LENGTH = 80;
const PREVIEW_MAX_LENGTH = 100;
const UNTITLED = "Untitled";

// ---------------------------------------------------------------------------
// Configuration

// A workflow variable from the environment, or "" when it isn't set.
function workflowVariable(name) {
  const value = $.NSProcessInfo.processInfo.environment.objectForKey(name);
  return value.isNil() ? "" : value.js;
}

// The notes folder, created if it's missing. `notes_folder` from User
// Configuration if set; otherwise `notes/` in the workflow's data folder.
// A configured folder is only created if its parent exists, so a folder on an
// unmounted volume isn't recreated on the startup disk. `variable` reads a
// workflow variable, and is replaceable for tests.
function notesFolder(variable = workflowVariable) {
  const configured = variable("notes_folder").trim();
  if (configured) {
    const folder = expandPath(configured);
    ensureFolder(folder, false);
    return folder;
  }
  const data = variable("alfred_workflow_data");
  if (!data) throw new Error("No notes folder: neither notes_folder nor alfred_workflow_data is set");
  const folder = expandPath(data) + "/notes";
  ensureFolder(folder, true);
  return folder;
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
  const error = Ref();
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
// Metadata lives in a hidden sidecar per note, `.scratchnotes/<id>.json` in the
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
  // the first time.
  function trash(id) {
    const path = notePath(id);
    if (!fm.fileExistsAtPath(path)) return null;
    const item = Application("Finder").delete(Path(path));
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
// Note windows
//
// A note opens in a window built from the templates in the workflow's ui/
// folder, written as its own bundle, <cache>/windows/<id>.alfredui, so each
// pinned note keeps its own saved position (AppKit saves a window's frame under
// a hash of its bundle's path). The window is in one of two forms, "quick"
// (inside Alfred's window) or "pinned" (its own window on the desktop), and one
// of two modes, "edit" (a textarea) or "view" (a markdownarea).
//
// The templates are ui.json as Alfred UI reads it, with directives that
// resolveNoteTemplate resolves and removes:
//   "@form": "quick" | "pinned"   on an array element: kept in that form only
//   "@mode": "edit" | "view"      on an array element: kept in that mode only
//   "@quick", "@pinned", "@edit", "@view": { … }
//                                 properties merged into the object in that
//                                 form or mode
//   "@note", "@text", …           a whole string that's a token is replaced by
//                                 its value (see noteWindowTokens)
//   "src": "scripts/…"            an action's script, made absolute, since the
//                                 bundle isn't in the workflow folder
//
// Alfred UI expands {var:…} and {const:…} placeholders in every string it's
// given (in ui.json and in update and replace actions), and {value:…} and
// {data:…} in action arguments, so text from a note is escaped before it goes
// in (escapeForAlfredUi) and unescaped when it comes back.

const NOTE_TINT = "#FFF3B0";
const FONT_SIZE = { min: 11, max: 20, default: 13 };
const WORD_JOINER = "⁠";

// The window tint for a note with metadata `meta`.
// TO-DO: the note's colour from the palette (step 4).
function noteTint(meta) {
  return NOTE_TINT;
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

// The font size from the `font_size` setting, in points, within FONT_SIZE.
function noteFontSize(variable = workflowVariable) {
  const size = parseInt(variable("font_size"), 10);
  return isNaN(size) ? FONT_SIZE.default : Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, size));
}

// The folder of note window bundles in the workflow's cache folder.
function noteWindowsFolder(variable = workflowVariable) {
  const cache = variable("alfred_workflow_cache");
  if (!cache) throw new Error("alfred_workflow_cache isn't set");
  return `${expandPath(cache)}/windows`;
}

function noteBundlePath(id, variable = workflowVariable) {
  if (!isNoteId(id)) throw new Error(`Not a note ID: ${JSON.stringify(id)}`);
  return `${noteWindowsFolder(variable)}/${id}.alfredui`;
}

function readNoteTemplate(workflowFolder, name) {
  const path = `${workflowFolder}/ui/${name}.json`;
  const text = readText(path);
  if (text === null) throw new Error(`Can't read ${path}`);
  return JSON.parse(text);
}

// The values of the templates' tokens for a window, given:
//   workflowFolder, id, form, mode, text, fontSize, tint
function noteWindowTokens({ workflowFolder, id, form, mode, text = "", fontSize = FONT_SIZE.default, tint = NOTE_TINT }) {
  return {
    "@note": escapeForAlfredUi(id),
    "@form": form,
    "@mode": mode,
    "@text": escapeForAlfredUi(text),
    "@title": escapeForAlfredUi(noteSummary(text).title),
    "@tint": tint,
    "@fontSize": fontSize,
    "@iconPath": `${workflowFolder}/ui/appicon.png`,
  };
}

// A template with its directives resolved for a form and mode (see above).
function resolveNoteTemplate(template, { form, mode, tokens, workflowFolder }) {
  function resolve(value, inArgs) {
    if (typeof value === "string") {
      if (Object.prototype.hasOwnProperty.call(tokens, value)) return inArgs ? String(tokens[value]) : tokens[value];
      return value;
    }
    if (Array.isArray(value)) {
      return value
        .filter((item) => !(item && typeof item === "object" && ((item["@form"] && item["@form"] !== form) || (item["@mode"] && item["@mode"] !== mode))))
        .map((item) => resolve(item, inArgs));
    }
    if (value === null || typeof value !== "object") return value;
    const merged = Object.assign({}, value, value[`@${form}`], value[`@${mode}`]);
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

// A note window's whole ui.json. `options` as for noteWindowTokens.
function noteWindowUi(options) {
  const { workflowFolder, form, mode } = options;
  const settings = { form, mode, tokens: noteWindowTokens(options), workflowFolder };
  const ui = resolveNoteTemplate(readNoteTemplate(workflowFolder, "window"), settings);
  const parts = noteModeParts(options);
  ui.window.root.components = ui.window.root.components.map((c) => parts[c.id] || c);
  return ui;
}

// The parts of an open window that change with its mode, for a replace
// action: { toprow, content }. `options` as for noteWindowTokens.
function noteModeParts(options) {
  const { workflowFolder, form, mode } = options;
  const settings = { form, mode, tokens: noteWindowTokens(options), workflowFolder };
  return {
    toprow: resolveNoteTemplate(readNoteTemplate(workflowFolder, "toprow"), settings),
    content: resolveNoteTemplate(readNoteTemplate(workflowFolder, mode === "edit" ? "editor" : "viewer"), settings),
  };
}

// Writes a note's window bundle: its ui.json, and context.json, what the
// window's scripts need that Alfred doesn't give them (the UI's scripts only
// get the alfred_* variables, not User Configuration). Returns the bundle's
// path. `context` is { folder, fontSize, tint }: the notes folder, and the
// look the window opened with, for the parts the Edit / View toggle replaces.
function writeNoteBundle(id, ui, context, variable = workflowVariable) {
  const bundle = noteBundlePath(id, variable);
  ensureFolder(bundle, true);
  writeFileAtomically(`${bundle}/context.json`, JSON.stringify(context, null, 2) + "\n");
  writeFileAtomically(`${bundle}/ui.json`, JSON.stringify(ui, null, 2) + "\n");
  return bundle;
}

// The context open.js wrote into a note's bundle, or null.
function readNoteContext(id, variable = workflowVariable) {
  return readJsonObject(`${noteBundlePath(id, variable)}/context.json`);
}

// Deletes a note's window bundle, if it has one: for a note that's gone
// (deleted on close, or moved to the Trash). Its saved window position goes
// with it, as nothing will open from that path again.
function removeNoteBundle(id, variable = workflowVariable) {
  const bundle = noteBundlePath(id, variable);
  if ($.NSFileManager.defaultManager.fileExistsAtPath(bundle)) removeFile(bundle);
}

// ---------------------------------------------------------------------------
// Window state
//
// Each open window's state is in <cache>/state/<id>.json, { form, pid, mode }:
// its form ("quick" or "pinned"), the process it runs in (its Alfred UI
// helper's when pinned, Alfred's own when quick) and its mode ("edit" or
// "view"). The window's `launched` event writes it, the Edit / View toggle
// updates the mode, and `quit` removes it. A window whose process is killed
// leaves its state behind, so a pinned note counts as open only while its
// process is alive (pinnedNotePid).

function noteStatePath(id, variable = workflowVariable) {
  if (!isNoteId(id)) throw new Error(`Not a note ID: ${JSON.stringify(id)}`);
  const cache = variable("alfred_workflow_cache");
  if (!cache) throw new Error("alfred_workflow_cache isn't set");
  return `${expandPath(cache)}/state/${id}.json`;
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
}

// The process ID of the note's pinned window, or null if it has none: its
// state says pinned, and that process is still an Alfred UI helper (so a
// process ID reused by another app doesn't count).
function pinnedNotePid(id, variable = workflowVariable) {
  const state = readNoteState(id, variable);
  if (!state || state.form !== "pinned" || !Number.isInteger(state.pid)) return null;
  const app = runningApp(state.pid);
  if (!app || app.isTerminated) return null;
  const executable = app.executableURL.isNil() ? "" : app.executableURL.path.js;
  return executable.endsWith("/Alfred UI") ? state.pid : null;
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

// Ends the process of a note's pinned window, if it has one, without its
// `quit` event, so nothing writes the note back (for moving it to the
// Trash). Returns whether there was one.
function closePinnedNoteWindow(id, variable = workflowVariable) {
  const pid = pinnedNotePid(id, variable);
  if (pid === null) return false;
  runningApp(pid).forceTerminate;
  removeNoteState(id, variable);
  return true;
}

// Whether `id` is in use by a note that's open but may not be saved yet: it
// has a window bundle or window state. For noteStore's newId.
function isNoteIdInUse(id, variable = workflowVariable) {
  const fm = $.NSFileManager.defaultManager;
  return fm.fileExistsAtPath(noteBundlePath(id, variable)) || fm.fileExistsAtPath(noteStatePath(id, variable));
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
  const fm = $.NSFileManager.defaultManager;
  const folder = $(path).stringByDeletingLastPathComponent.js;
  const temp = `${folder}/.scratchnotes-save-${$.NSUUID.UUID.UUIDString.js}.tmp`;
  const data = $(text).dataUsingEncoding($.NSUTF8StringEncoding);
  if (!data.writeToFileAtomically(temp, false)) throw new Error(`Can't write ${temp}`);
  const error = Ref();
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
  const error = Ref();
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

function errorText(errorRef) {
  const error = errorRef[0];
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
// "Decisions: a, b | Actions: c". Both are truncated on whole characters
// (truncateText). A leading YAML front matter block, as other apps write, is
// skipped.
function noteSummary(text, { titleLength = TITLE_MAX_LENGTH, previewLength = PREVIEW_MAX_LENGTH } = {}) {
  let title = null;
  let preview = "";
  let previewCount = 0;
  let previous = null;
  for (const raw of markdownBodyLines(text)) {
    const line = cleanMarkdownLine(raw);
    if (!line.text) continue;
    if (title === null) {
      title = line.text;
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
