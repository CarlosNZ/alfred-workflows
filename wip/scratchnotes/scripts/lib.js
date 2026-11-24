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
      if (e.errorNumber === -1743) throw new Error("Alfred isn't allowed to control Finder. Allow it in System Settings › Privacy & Security › Automation.");
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
// Note windows
//
// A note opens in a window built from the templates in the workflow's ui/
// folder, written as its own bundle: <cache>/quick/<id>.alfredui for a quick
// view, <cache>/windows/<id>.alfredui for a pinned window, so each pinned note
// keeps its own saved position (AppKit saves a window's frame under a hash of
// its bundle's path). The window is in one of two forms, "quick" (inside
// Alfred's window) or "pinned" (its own window on the desktop), and one of two
// modes, "edit" (a textarea) or "view" (the note rendered in a web view).
//
// Both modes have the same layout, a stack filling the window: the web view,
// the textarea over it, and the top row's buttons over the top-right corner.
// The web view stays in the window for its whole life (a new one takes
// 100–250 ms to show anything): Edit fades it out and shows the textarea, and
// View hides the textarea and reloads the web view's page with the note (see
// writeNotePage).
//
// The templates are ui.json as Alfred UI reads it, with directives that
// resolveNoteTemplate resolves and removes:
//   "@form": "quick" | "pinned"   on an array element: kept in that form only
//   "@mode": "edit" | "view"      on an array element: kept in that mode only
//   "@quick", "@pinned", "@edit", "@view": { … }
//                                 properties merged into the object in that
//                                 form or mode
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

const FONT_SIZE = { min: 11, max: 20, default: 13 };
const WORD_JOINER = "⁠";

// The palette: Stickies' colours, from its asset catalogue. Each colour has a
// pale `tint` for a pinned note's background (always with dark text), a
// stronger `spine` (Stickies' menu swatches) and a `control` colour, for the
// colour button's dot; the results list's icons use the spine and control
// colours (dev/make-icons.js). In menu order, which is also ⌘1 to ⌘6. A note
// stores its colour's name, so the colours can be re-tuned without rewriting
// notes.
const NOTE_PALETTE = [
  { name: "yellow", label: "Yellow", heart: "💛", tint: "#FEF49C", spine: "#FEEA3D", control: "#DBC503" },
  { name: "blue", label: "Blue", heart: "🩵", tint: "#ADF4FF", spine: "#89F0FF", control: "#24D0E9" },
  { name: "green", label: "Green", heart: "💚", tint: "#B2FFA1", spine: "#83FE83", control: "#51BB51" },
  { name: "pink", label: "Pink", heart: "🩷", tint: "#FFC7C7", spine: "#FFB2B2", control: "#F87F7F" },
  { name: "purple", label: "Purple", heart: "💜", tint: "#B6CAFF", spine: "#9BB6FE", control: "#7D9BEB" },
  { name: "grey", label: "Grey", heart: "🩶", tint: "#EEEEEE", spine: "#DADADA", control: "#A8A8A8" },
];
const DEFAULT_COLOUR = "yellow";

// The palette, as copies of its colours: { name, label, heart, tint, spine,
// control }.
function notePalette() {
  return NOTE_PALETTE.map((colour) => Object.assign({}, colour));
}

// The palette's colour named `name`, or null if there's none.
function notePaletteColour(name) {
  const colour = NOTE_PALETTE.find((c) => c.name === name);
  return colour ? Object.assign({}, colour) : null;
}

// The colour of a note with metadata `meta`: its own, or, if it has none or
// one that isn't in the palette, the `default_colour` setting's, or yellow.
function noteColour(meta, variable = workflowVariable) {
  return notePaletteColour(meta && meta.colour) || noteDefaultColour(variable);
}

function noteDefaultColour(variable = workflowVariable) {
  return notePaletteColour(variable("default_colour")) || notePaletteColour(DEFAULT_COLOUR);
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

// The folder of a form's window bundles in the workflow's cache folder:
// quick/ for quick views (kept up to date by list.js, see quickWindows) and
// windows/ for pinned windows. Separate folders keep list.js from ever
// rewriting an open pinned window's bundle, and each pinned window's saved
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

// The values of the templates' tokens for a window, given:
//   workflowFolder, id, form, mode, text, fontSize, colour (a palette name)
function noteWindowTokens({ workflowFolder, id, form, mode, text = "", fontSize = FONT_SIZE.default, colour = DEFAULT_COLOUR }) {
  const current = notePaletteColour(colour) || notePaletteColour(DEFAULT_COLOUR);
  const note = escapeForAlfredUi(id);
  return {
    "@note": note,
    "@form": form,
    "@mode": mode,
    "@text": escapeForAlfredUi(text),
    "@title": escapeForAlfredUi(noteSummary(text).title),
    "@tint": current.tint,
    "@colourDot": current.control,
    "@colourMenu": NOTE_PALETTE.map((c) => ({
      text: noteColourMenuText(c),
      state: c.name === current.name ? "on" : "off",
      action: noteColourAction({ workflowFolder, note, form, colour: c }),
    })),
    "@colourShortcuts": NOTE_PALETTE.map((c, i) => ({
      shortcut: `⌘${i + 1}`,
      action: noteColourAction({ workflowFolder, note, form, colour: c }),
    })),
    "@fontSize": fontSize,
    "@iconPath": `${workflowFolder}/ui/appicon.png`,
  };
}

// The action that gives a window's note colour `colour` (a palette colour),
// for its menu item and shortcut: window.js colour, which records it and
// updates the top row. A pinned window's tint is updated first, so it changes
// at once rather than after the script. `note` is the escaped ID.
function noteColourAction({ workflowFolder, note, form, colour }) {
  const script = { type: "script", src: `${workflowFolder}/scripts/window.js`, args: ["colour", note, form, colour.name] };
  if (form !== "pinned") return script;
  return [{ type: "json", src: { update: { ids: { note: { background: colour.tint } } } } }, script];
}

// A colour's menu item text: its heart and name. Three of the hearts are
// Emoji 15, which macOS has from 13.3; before that, just the name.
let hasEmoji15 = null;
function noteColourMenuText(colour) {
  if (hasEmoji15 === null) {
    const version = $.NSProcessInfo.processInfo.operatingSystemVersion;
    const [major, minor] = [Number(version.majorVersion), Number(version.minorVersion)];
    hasEmoji15 = major > 13 || (major === 13 && minor >= 3);
  }
  return hasEmoji15 ? `${colour.heart} ${colour.label}` : colour.label;
}

// A template with its directives resolved for a form and mode (see above).
function resolveNoteTemplate(template, { form, mode, tokens, workflowFolder }) {
  const isToken = (value) => typeof value === "string" && Object.prototype.hasOwnProperty.call(tokens, value);
  function resolve(value, inArgs) {
    if (typeof value === "string") {
      if (isToken(value)) return inArgs ? String(tokens[value]) : tokens[value];
      return value;
    }
    if (Array.isArray(value)) {
      return value
        .filter((item) => !(item && typeof item === "object" && ((item["@form"] && item["@form"] !== form) || (item["@mode"] && item["@mode"] !== mode))))
        .flatMap((item) => (isToken(item) && Array.isArray(tokens[item]) ? tokens[item] : [resolve(item, inArgs)]));
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

// A note window's whole ui.json: window.json, with its { "id": "content" }
// and { "id": "toprow" } placeholders filled. `options` as for
// noteWindowTokens.
function noteWindowUi(options) {
  const ui = noteWindowPart(options, "window");
  ui.window.root.components = ui.window.root.components.map((c) => (c.id === "content" || c.id === "toprow" ? noteWindowPart(options, c.id) : c));
  return ui;
}

// One of a window's templates ("window", "toprow" or "content"), resolved for
// its form and mode: the top row, for instance, for a replace action after a
// colour change. `options` as for noteWindowTokens.
function noteWindowPart(options, name) {
  const { workflowFolder, form, mode } = options;
  const settings = { form, mode, tokens: noteWindowTokens(options), workflowFolder };
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
// the mode it was last switched to (its sidecar's `mode`), or the `open_mode`
// setting's (View by default). `note` is null for a new note.
function noteOpenMode(note, text, variable = workflowVariable) {
  if (!note || isBlankText(text)) return "edit";
  if (note.meta.mode === "edit" || note.meta.mode === "view") return note.meta.mode;
  return variable("open_mode") === "edit" ? "edit" : "view";
}

// Writes the window bundle of a note in `store` for a form ("quick" or
// "pinned") and returns its path. `note` is the note as the store read it, or
// null for a new note; `text` is the text the window opens with.
function writeNoteWindow({ store, workflowFolder, id, form, note, text }, variable = workflowVariable) {
  const mode = noteOpenMode(note, text, variable);
  const fontSize = noteFontSize(variable);
  const colour = noteColour(note ? note.meta : {}, variable).name;
  const ui = noteWindowUi({ workflowFolder, id, form, mode, text, fontSize, colour });
  const script = notePageScript(mode === "view" ? text : null, colour);
  const page = notePageHtml({ workflowFolder, form, fontSize, noteVersion: textHash(script) }, variable);
  const context = { folder: store.folder, fontSize, colour, textHash: textHash(text) };
  return writeNoteBundle(id, form, { ui, context, page, script }, variable);
}

// Writes a note's window bundle and returns its path. Its files:
//   ui.json        the window (`ui`)
//   context.json   what the window's scripts need that Alfred doesn't give
//                  them (the UI's scripts only get the alfred_* variables, not
//                  User Configuration): { folder, fontSize, colour, textHash },
//                  the notes folder, the window's look (the font size and the
//                  note's colour's name) and a hash of the note's text as the
//                  window last had it (see textHash): the text it opened with,
//                  and then the text its page was last given (writeNotePage),
//                  so the window can tell when the note has changed since
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
// window whose look has changed (its note's colour), so the parts it's given
// later match. Its ui.json is left as it is: the window has already read it.
function updateNoteContext(id, form, changes, variable = workflowVariable) {
  const context = readNoteContext(id, form, variable);
  if (!context) return;
  writeFileAtomically(`${noteBundlePath(id, form, variable)}/context.json`, JSON.stringify(Object.assign(context, changes), null, 2) + "\n");
}

// Deletes a note's window bundles, quick and pinned, if it has them: for a
// note that's gone (deleted on close, or moved to the Trash). Its saved window
// position goes with them, as nothing will open from that path again.
function removeNoteBundle(id, variable = workflowVariable) {
  for (const form of ["quick", "pinned"]) {
    const bundle = noteBundlePath(id, form, variable);
    if ($.NSFileManager.defaultManager.fileExistsAtPath(bundle)) removeFile(bundle);
  }
}

// The files a window bundle is built from, besides the note: the templates,
// and this file, which builds them. A change to any (a workflow update) makes
// every quick bundle out of date.
const NOTE_WINDOW_SOURCES = ["ui/window.json", "ui/toprow.json", "ui/content.json", "ui/view.html", "ui/view.js", "scripts/lib.js"];

// Quick views' bundles, for list.js. ↩ on a result opens its bundle straight
// from the Script Filter, with nothing in between: a Run Script or Conditional
// there makes Alfred hide its window and fade the view in (see "Quick notes
// and pinned notes" in DESIGN.md). So each note's quick bundle has to be ready
// before the results are shown.
//
// A bundle's fingerprint is a hash of everything it's built from: the note's
// text, its mode and colour (from its sidecar and the settings), the font size,
// the notes and workflow folders, and the modification times of
// NOTE_WINDOW_SOURCES. The fingerprints are kept in quick/.index.json, read
// once per run, so a bundle is only rebuilt when its fingerprint changes:
// usually none, one after a note is edited, every one after a setting or the
// workflow changes.
//
//   bundleFor(note)     the quick bundle of a note from store.list(), rebuilt
//                       if it's out of date
//   bundleForNew(text)  a quick bundle for a new note starting with `text`,
//                       with a new ID
//   finish(notes)       removes the bundles and fingerprints of notes that
//                       are gone, given every note in the folder, keeping any
//                       that's open (has a window state), and saves the index
function quickWindows(store, workflowFolder, readVariable = workflowVariable) {
  const fm = $.NSFileManager.defaultManager;
  // Each variable is read once: through the ObjC bridge, a read per note adds
  // up over hundreds of notes on every keystroke.
  const variables = new Map();
  const variable = (name) => {
    if (!variables.has(name)) variables.set(name, readVariable(name));
    return variables.get(name);
  };
  const folder = noteWindowsFolder("quick", variable);
  const indexPath = `${folder}/.index.json`;
  const index = new Map(Object.entries(readJsonObject(indexPath) || {}));
  const entries = fm.contentsOfDirectoryAtPathError(folder, null);
  const bundles = new Set(entries.isNil() ? [] : ObjC.deepUnwrap(entries));
  const sources = NOTE_WINDOW_SOURCES.map((path) => {
    const date = fileDate(`${workflowFolder}/${path}`, "NSFileModificationDate");
    return date ? date.getTime() : 0;
  });
  const base = JSON.stringify([workflowFolder, store.folder, noteFontSize(variable), variable("open_mode"), sources]);
  let changed = false;
  let newId = null;

  function bundleFor(note) {
    const fingerprint = textHash([base, noteOpenMode(note, note.text, variable), noteColour(note.meta, variable).name, note.text].join("\0"));
    if (index.get(note.id) === fingerprint && bundles.has(`${note.id}.alfredui`)) return `${folder}/${note.id}.alfredui`;
    const bundle = writeNoteWindow({ store, workflowFolder, id: note.id, form: "quick", note, text: note.text }, variable);
    index.set(note.id, fingerprint);
    changed = true;
    return bundle;
  }

  // A new note's ID is the time, so on each run within the same second it's
  // the same ID and bundle; a bundle from an earlier second is removed by the
  // next finish.
  function bundleForNew(text) {
    newId = store.newId({ isTaken: (id) => isNoteIdInUse(id, variable) });
    return writeNoteWindow({ store, workflowFolder, id: newId, form: "quick", note: null, text }, variable);
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
      if (ids.has(id) || id === newId || !isNoteId(id) || fm.fileExistsAtPath(noteStatePath(id, variable))) continue;
      removeFile(`${folder}/${name}`);
    }
    if (changed) {
      ensureFolder(folder, true);
      writeFileAtomically(indexPath, JSON.stringify(Object.fromEntries(index)) + "\n");
    }
  }

  return { bundleFor, bundleForNew, finish };
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

// A note's view.html, from ui/view.html: `form` ("quick" or "pinned"),
// `fontSize` (points), and `noteVersion`, the version of the bundle's note.js
// it was written with (the page uses it when its own URL has no ?v=).
function notePageHtml({ workflowFolder, form, fontSize, noteVersion }, variable = workflowVariable) {
  const template = readText(`${workflowFolder}/ui/view.html`);
  const script = readText(`${workflowFolder}/ui/view.js`);
  if (template === null || script === null) throw new Error(`Can't read ${workflowFolder}/ui/view.html or view.js`);
  if (/<\/script/i.test(script)) throw new Error("ui/view.js can't contain </script, as it's inlined in a <script> element");
  const theme = form === "quick" ? fileUrl(noteThemePath(variable)) : null;
  const values = {
    form,
    fontSize: String(Number(fontSize)),
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
// Edit, whose page shows nothing until it's switched to View) and the tint of
// the colour named `colour`, for a pinned window's page.
function notePageScript(text, colour) {
  const tint = (notePaletteColour(colour) || notePaletteColour(DEFAULT_COLOUR)).tint;
  return `window.NOTE = ${JSON.stringify(text)};\nwindow.NOTE_TINT = ${JSON.stringify(tint)};\n`;
}

// Gives the page of a note's open window `text`: rewrites its bundle's note.js
// (with the colour in its context) and records the text's hash in its
// context, as the text a tick is checked against. Returns the URL that
// reloads the page with it, for an update of the web view's `src`: an
// absolute file:// URL (a relative one is taken for https://), with a
// version that's new every time, so the page reloads even when the text is
// the same, and loads note.js afresh.
function writeNotePage(id, form, text, variable = workflowVariable) {
  const bundle = noteBundlePath(id, form, variable);
  const context = readNoteContext(id, form, variable) || {};
  const script = notePageScript(text, context.colour);
  writeFileAtomically(`${bundle}/note.js`, script);
  updateNoteContext(id, form, { textHash: textHash(text) }, variable);
  return `${fileUrl(`${bundle}/view.html`)}?v=${textHash(script)}.${Date.now().toString(36)}`;
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
    lines.push(`@media (prefers-color-scheme: dark) { :root { --text: ${rgba(255, text)}; --text-done: ${rgba(255, done)}; --link: #4DA3FF; } }`);
    lines.push(`@media (prefers-color-scheme: light) { :root { --text: ${rgba(0, text)}; --text-done: ${rgba(0, done)}; --link: #0058D0; } }`);
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
// Each open window's state is in <cache>/state/<id>.json, { form, pid, mode }:
// its form ("quick" or "pinned"), the process it runs in (its Alfred UI
// helper's when pinned, Alfred's own when quick) and its mode ("edit" or
// "view"). The window's `launched` event writes it, the Edit / View toggle
// updates the mode, and `quit` removes it. A window whose process is killed
// leaves its state behind, so a pinned note counts as open only while its
// process is alive (pinnedNotePid).

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

// The IDs of the notes that have a pinned window (see pinnedNotePid), from
// the state folder, listed once.
function pinnedNoteIds(variable = workflowVariable) {
  const names = ObjC.deepUnwrap($.NSFileManager.defaultManager.contentsOfDirectoryAtPathError(noteStateFolder(variable), null)) || [];
  const ids = names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -".json".length));
  return new Set(ids.filter((id) => isNoteId(id) && pinnedNotePid(id, variable) !== null));
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
// has a pinned window bundle or a window state. For noteStore's newId. A
// quick bundle alone doesn't count: list.js writes one for each new note it
// offers, and reuses its ID within the same second.
function isNoteIdInUse(id, variable = workflowVariable) {
  const fm = $.NSFileManager.defaultManager;
  return fm.fileExistsAtPath(noteBundlePath(id, "pinned", variable)) || fm.fileExistsAtPath(noteStatePath(id, variable));
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
