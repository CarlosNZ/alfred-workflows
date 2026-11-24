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
// `text` is the whole file. `meta` is the sidecar's object ({} without one).
// `modified` is the file's modification time; `created` is the sidecar's
// `created`, or the file's birth time for a note without one. Both are Dates.
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
    const meta = readMeta(id);
    const summary = noteSummary(text);
    return {
      id,
      path,
      fileName,
      text,
      meta,
      modified: jsDate(attributes.objectForKey("NSFileModificationDate")),
      created: parseDate(meta.created) || jsDate(attributes.objectForKey("NSFileCreationDate")),
      title: summary.title,
      preview: summary.preview,
    };
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
  // The sidecar gets `created` the first time a note is saved: now for a new
  // note, the file's birth time for one added by hand.
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
// cleaned the same way, list items joined with ", " and other lines with a
// space. Both are truncated on whole characters (truncateText). A leading YAML
// front matter block, as other apps write, is skipped.
function noteSummary(text, { titleLength = TITLE_MAX_LENGTH, previewLength = PREVIEW_MAX_LENGTH } = {}) {
  let title = null;
  let preview = "";
  let previewCount = 0;
  let previousWasList = false;
  for (const raw of markdownBodyLines(text)) {
    const line = cleanMarkdownLine(raw);
    if (!line.text) continue;
    if (title === null) {
      title = line.text;
      continue;
    }
    const separator = preview === "" ? "" : line.isList && previousWasList ? ", " : " ";
    preview += separator + line.text;
    previousWasList = line.isList;
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

// One line of Markdown as plain text: { text, isList }. Removes block markers
// (heading #s, > quotes, list bullets and numbers, task boxes) and inline
// markup (emphasis, code, links and images, escapes). Code fence lines,
// thematic breaks and setext underlines become empty.
function cleanMarkdownLine(line) {
  let s = line.trim();
  if (/^(```|~~~)/.test(s) || /^([-*_])(\s*\1){2,}$/.test(s) || /^=+$/.test(s)) return { text: "", isList: false };
  s = s.replace(/^(>\s?)+/, "");
  s = s.replace(/^#{1,6}(\s+|$)/, "").replace(/\s+#+$/, "");
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
  return { text: cleanInlineMarkdown(s).replace(/\s+/g, " ").trim(), isList };
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
      .replace(/[\s,;:·]+$/, "") + "…"
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
