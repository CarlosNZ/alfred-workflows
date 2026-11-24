#!/usr/bin/osascript -l JavaScript

// Tests for lib.js's storage functions, run by test-storage.sh, which makes
// the temporary folder every command works in. Never point it at a real notes
// folder.
//
//   test-storage.js loader                  prints the lib.js it loaded
//   test-storage.js test <temp folder>      the unit tests
//   test-storage.js save <folder> <id> <file>  saves the file's text as a note
//   test-storage.js trash <temp folder>     moves a note it creates to the Trash

ObjC.import("Foundation");
ObjC.import("stdlib");

let passed = 0;
let failed = 0;

function run(argv) {
  const libPath = loadLib(argv, "../scripts/lib.js");
  const [command, ...args] = argv;
  if (command === "loader") return print(`loaded ${libPath} (noteStore: ${typeof noteStore})`);
  if (command === "save") return print(noteStore(args[0]).save(args[1], readText(args[2])));
  if (!args[0] || !args[0].includes("scratchnotes-test.")) throw new Error("Give the temporary folder test-storage.sh made");
  if (command === "test") {
    testConfiguration(args[0]);
    testIds(freshStore(args[0], "ids"));
    testSave(freshStore(args[0], "save"));
    testMeta(freshStore(args[0], "meta"));
    testSummary();
    testUnicode(freshStore(args[0], "unicode"));
    testEmpty(freshStore(args[0], "empty"));
    testList(freshStore(args[0], "list"));
    timeList(freshStore(args[0], "timing"));
  } else if (command === "trash") {
    testTrash(freshStore(args[0], "trash"));
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
  print(`${passed} passed, ${failed} failed`);
  if (failed) $.exit(1);
}

// ---------------------------------------------------------------------------

function testConfiguration(root) {
  section("Configuration");
  const variables = (values) => (name) => values[name] || "";
  makeFolder(`${root}/config`);

  const configured = `${root}/config/notes`;
  eq("notes_folder is used, trailing slash removed", notesFolder(variables({ notes_folder: configured + "/" })), configured);
  check("notes_folder is created", isFolder(configured));
  throws(
    "notes_folder whose parent is missing isn't created",
    () => notesFolder(variables({ notes_folder: `${root}/no-such-volume/notes` })),
    /doesn't exist/,
  );
  check("…and nothing was created", !exists(`${root}/no-such-volume`));
  writeRaw(`${root}/config/a-file`, "x");
  throws("notes_folder that's a file", () => notesFolder(variables({ notes_folder: `${root}/config/a-file` })), /Not a folder/);

  const data = `${root}/data/Workflow Data/bundle`;
  eq("default is notes/ in the data folder", notesFolder(variables({ alfred_workflow_data: data, notes_folder: "  " })), `${data}/notes`);
  check("default folder is created with its parents", isFolder(`${data}/notes`));
  throws("no notes_folder and no data folder", () => notesFolder(variables({})), /neither/);
  eq("~ is expanded", expandPath("~/ScratchNotes"), `${$.NSHomeDirectory().js}/ScratchNotes`);
}

function testIds(store) {
  section("IDs");
  const date = new Date(2026, 10, 20, 15, 3, 2);
  eq("formatNoteId is local time, zero padded", formatNoteId(date), "20261120-150302");
  check("default date is now", /^\d{8}-\d{6}$/.test(store.newId()));
  for (const id of ["20261120-150302", "20261120-150302-2", "shopping", "Café ☕", "a b"]) check(`isNoteId(${JSON.stringify(id)})`, isNoteId(id));
  for (const id of ["", ".hidden", "a/b", "..", "../x", "a\0b", 42, null]) check(`!isNoteId(${JSON.stringify(id)})`, !isNoteId(id));
  eq("noteIdFromFileName", ["a.md", "B.MD", "c.Md", ".x.md", "a.txt", ".md", "md"].map(noteIdFromFileName), ["a", "B", "c", null, null, null, null]);

  eq("free ID is the time", store.newId({ date }), "20261120-150302");
  writeRaw(`${store.folder}/20261120-150302.md`, "x");
  eq("taken by a note: -2", store.newId({ date }), "20261120-150302-2");
  makeFolder(`${store.folder}/.scratchnotes`);
  writeRaw(`${store.folder}/.scratchnotes/20261120-150302-2.json`, "{}");
  eq("taken by a sidecar (trashed note): -3", store.newId({ date }), "20261120-150302-3");
  eq("taken by isTaken (open, unsaved): -4", store.newId({ date, isTaken: (id) => id.endsWith("-3") }), "20261120-150302-4");
  const other = new Date(2026, 10, 21, 9, 0, 0);
  writeRaw(`${store.folder}/20261121-090000.MD`, "x");
  eq("taken by a .MD note", store.newId({ date: other }), "20261121-090000-2");
}

function testSave(store) {
  section("Saving");
  const id = "save-test";
  const path = `${store.folder}/${id}.md`;
  eq("blank new note isn't written", store.save(id, "  \n\t"), "blank");
  check("…no file", !exists(path));
  check("…no sidecar", !exists(`${store.folder}/.scratchnotes/${id}.json`));

  const before = Date.now();
  eq("new note", store.save(id, "# Hello\n"), "created");
  eq("…text is exact", readText(path), "# Hello\n");
  const created = parseDate(store.readMeta(id).created);
  check("…sidecar has created, now", created && Math.abs(created - before) < 5000, store.readMeta(id).created);
  check("…created has a UTC offset", /[+-]\d\d:\d\d$/.test(store.readMeta(id).created));

  setDate(path, "NSFileModificationDate", new Date(2020, 0, 1));
  eq("same text", store.save(id, "# Hello\n"), "unchanged");
  eq("…modification time kept", fileDate(path, "NSFileModificationDate").getFullYear(), 2020);

  setDate(path, "NSFileCreationDate", new Date(2021, 0, 1, 12, 0, 0));
  setTags(path, ["Red"]);
  const createdMeta = store.readMeta(id).created;
  eq("changed text", store.save(id, "# Hello\nworld\n"), "saved");
  eq("…text is exact", readText(path), "# Hello\nworld\n");
  eq("…birth time kept", fileDate(path, "NSFileCreationDate").getTime(), new Date(2021, 0, 1, 12, 0, 0).getTime());
  eq("…Finder tags kept", tags(path), ["Red"]);
  check("…modification time is now", Date.now() - fileDate(path, "NSFileModificationDate") < 5000);
  eq("…sidecar's created unchanged", store.readMeta(id).created, createdMeta);
  check("…no com.apple.TextEncoding attribute", !xattrNames(path).includes("com.apple.TextEncoding"), xattrNames(path));

  eq("blank text over an existing note is saved", store.save(id, ""), "saved");
  check("…file kept, empty", exists(path) && readText(path) === "");

  const exotic = "line one\r\nline two\r\n👨‍👩‍👧‍👦 Cafe\u0301 🇳🇿 \u00a0\n";
  store.save(id, exotic);
  eq("CRLF, emoji and decomposed accents round trip byte for byte", readText(path), exotic);

  writeRaw(`${store.folder}/hand.md`, "added by hand");
  const handBirth = new Date(2022, 5, 1, 8, 30, 0);
  setDate(`${store.folder}/hand.md`, "NSFileCreationDate", handBirth);
  eq("note added by hand: created is its birth time", store.read("hand").created.getTime(), handBirth.getTime());
  store.save("hand", "edited");
  eq("…first save records the birth time as created", store.readMeta("hand").created, formatLocalIsoDate(handBirth));

  throws("ID with a slash", () => store.save("../escape", "x"), /Not a note ID/);
  throws("hidden ID", () => store.save(".hidden", "x"), /Not a note ID/);
  eq("no temporary files left", leftoverTemps(store.folder), []);
}

function testMeta(store) {
  section("Metadata sidecars");
  const id = "meta-test";
  const path = `${store.folder}/${id}.md`;
  const sidecar = `${store.folder}/.scratchnotes/${id}.json`;
  writeRaw(path, "# Note\n");
  eq("no sidecar: {}", store.readMeta(id), {});
  eq("no sidecar: read().meta is {}", store.read(id).meta, {});

  setDate(path, "NSFileModificationDate", new Date(2020, 0, 1));
  eq("updateMeta returns the merged object", store.updateMeta(id, { colour: "yellow" }), { colour: "yellow" });
  eq("…read back", store.read(id).meta.colour, "yellow");
  eq("…note's modification time untouched", fileDate(path, "NSFileModificationDate").getFullYear(), 2020);
  eq("…note's text untouched", readText(path), "# Note\n");
  check("…sidecar is JSON ending in a newline", readText(sidecar).endsWith("}\n"));

  const foreign = { colour: "blue", "x-other-app": { nested: [1, 2, { a: "b" }] }, tags: ["a", "b"], n: 3.5, flag: false };
  writeRaw(sidecar, JSON.stringify(foreign));
  store.updateMeta(id, { colour: "pink" });
  eq("unknown keys kept on update", store.readMeta(id), { ...foreign, colour: "pink" });
  store.updateMeta(id, { colour: null });
  check("null removes a key", !("colour" in store.readMeta(id)) && store.readMeta(id).flag === false);
  store.updateMeta(id, { "x-other-app": null, tags: undefined, n: null, flag: null });
  check("removing the last key removes the sidecar", !exists(sidecar));

  store.updateMeta("not-saved-yet", { colour: "green" });
  check("sidecar for a note not saved yet", exists(`${store.folder}/.scratchnotes/not-saved-yet.json`));

  writeRaw(sidecar, "{not json");
  eq("corrupt sidecar reads as {}", store.readMeta(id), {});
  check("…note still reads, created from birth time", store.read(id).created instanceof Date);
  writeRaw(sidecar, "[1, 2]");
  eq("non-object JSON reads as {}", store.readMeta(id), {});
  eq("no temporary files left", leftoverTemps(store.folder), []);
}

function testSummary() {
  section("Titles and previews");
  const cases = [
    ["heading and list", "# Shopping\n- milk\n- **eggs**\n- [ ] flour\n", "Shopping", "milk, eggs, flour"],
    ["empty", "", "Untitled", ""],
    ["whitespace only", "  \n\n\t\n", "Untitled", ""],
    ["blank lines first, closed heading", "\n\n## Heading ##\ntext", "Heading", "text"],
    ["code fence", "```js\nconst a = 1;\n```\n", "const a = 1;", ""],
    ["thematic break first", "---\n\nAfter the rule", "After the rule", ""],
    ["setext heading", "Title\n=====\nBody", "Title", "Body"],
    ["quote", "> quoted *words*\n> more", "quoted words", "more"],
    ["links and images", "[Docs](https://x.y) and ![alt text](a.png)", "Docs and alt text", ""],
    ["autolink, code, strike", "<https://x.y> `code` ~~gone~~", "https://x.y code gone", ""],
    ["snake_case and maths kept", "snake_case_name 2*3*4", "snake_case_name 2*3*4", ""],
    ["underscore emphasis", "an _italic_ and __bold__ word", "an italic and bold word", ""],
    ["escapes", "\\# not a heading \\*", "# not a heading *", ""],
    ["numbered and task list", "Todo\n1. one\n2) two\n- [x] three", "Todo", "one, two, three"],
    ["prose joins with spaces", "Title\nLine two\nline three", "Title", "Line two line three"],
    ["list then prose", "T\n- a\n- b\nAfter", "T", "a, b After"],
    ["bare bullet line skipped", "-\n#\nReal", "Real", ""],
    ["other app's front matter skipped", "---\ntitle: x\ntags:\n  - a\n---\n# Real title\nBody", "Real title", "Body"],
    ["front matter without closing line is text", "---\ntitle: x\n", "title: x", ""],
    ["CRLF", "Title\r\nBody\r\n", "Title", "Body"],
  ];
  for (const [name, text, title, preview] of cases) eq(name, noteSummary(text), { title, preview });
}

function testUnicode(store) {
  section("Unicode");
  const family = "👨‍👩‍👧‍👦";
  eq("emoji title intact", noteSummary(`🛒 Shopping ${family}\n- milk`).title, `🛒 Shopping ${family}`);
  eq("short text not truncated", truncateText("Café", 4), "Café");

  const families = truncateText(family.repeat(50), 10);
  eq("ZWJ sequences cut whole", families, family.repeat(9) + "…");
  const flags = truncateText("🇳🇿".repeat(50), 10);
  eq("flags cut whole", flags, "🇳🇿".repeat(9) + "…");
  const combining = truncateText("e\u0301".repeat(50), 10);
  eq("combining accents stay on their letter", combining, "e\u0301".repeat(9) + "…");
  eq("skin tones cut whole", truncateText("👍🏽".repeat(20), 3), "👍🏽👍🏽…");
  eq("trailing space and comma dropped before …", truncateText("milk, eggs, flour", 7), "milk…");

  const longTitle = noteSummary("word ".repeat(100)).title;
  eq("title capped at 80 characters", graphemes(longTitle).length, 80);
  check("…ends with …", longTitle.endsWith("…"));
  const preview = noteSummary("T\n" + "🙂 ".repeat(300)).preview;
  eq("preview capped at 100 characters", graphemes(preview).length, 100);
  eq("custom lengths", noteSummary("Title here\nPreview text", { titleLength: 5, previewLength: 4 }), { title: "Titl…", preview: "Pre…" });

  const nfd = "Cafe\u0301 ☕";
  const nfc = "Caf\u00e9 ☕";
  writeRaw(`${store.folder}/${nfd}.md`, `${family} Family note\nbody`);
  const listed = store.list().filter((n) => n.id.normalize("NFC") === nfc);
  eq("decomposed filename is listed", listed.length, 1);
  eq("…with its title", listed[0] && listed[0].title, `${family} Family note`);
  eq("read by the composed ID", store.read(nfc) && store.read(nfc).title, `${family} Family note`);
  store.save(nfc, "edited");
  eq("save by the composed ID keeps one file", store.list().filter((n) => n.id.normalize("NFC") === nfc).length, 1);
  eq("…with the new text", store.read(nfd).text, "edited");
}

function testEmpty(store) {
  section("Empty notes");
  store.save("full", "text");
  eq("note with text isn't deleted", store.deleteIfEmpty("full"), false);
  check("…still there", store.exists("full"));

  store.save("emptied", "x");
  store.save("emptied", " \n\t\u00a0\n");
  store.updateMeta("emptied", { colour: "blue" });
  eq("whitespace-only note is deleted", store.deleteIfEmpty("emptied"), true);
  check("…file gone", !store.exists("emptied"));
  check("…sidecar gone", !exists(`${store.folder}/.scratchnotes/emptied.json`));

  store.updateMeta("never-saved", { colour: "green" });
  eq("never-saved note with a colour: deleted", store.deleteIfEmpty("never-saved"), true);
  check("…sidecar gone", !exists(`${store.folder}/.scratchnotes/never-saved.json`));
  eq("nothing at all: counts as deleted", store.deleteIfEmpty("nothing"), true);
}

function testList(store) {
  section("Listing");
  const note = (name, text, year) => {
    writeRaw(`${store.folder}/${name}`, text);
    setDate(`${store.folder}/${name}`, "NSFileModificationDate", new Date(year, 0, 1));
  };
  note("a.md", "A", 2020);
  note("b.md", "B", 2023);
  note("c.md", "C", 2021);
  note("Upper.MD", "Upper", 2022);
  writeRaw(`${store.folder}/.hidden.md`, "hidden");
  writeRaw(`${store.folder}/notes.txt`, "text file");
  makeFolder(`${store.folder}/sub`);
  writeRaw(`${store.folder}/sub/inner.md`, "inner");
  makeFolder(`${store.folder}/folder.md`);
  store.updateMeta("a", { colour: "yellow" });
  eq("only top-level, non-hidden .md files, last edited first", store.list().map((n) => n.id), ["b", "Upper", "c", "a"]);
  eq("note objects carry meta", store.list().find((n) => n.id === "a").meta, { colour: "yellow" });
  const b = store.read("b");
  check(
    "note object fields",
    b.path === `${store.folder}/b.md` && b.fileName === "b.md" && b.text === "B" && b.title === "B" && b.preview === "" && b.modified.getFullYear() === 2023,
  );
  eq("missing note reads as null", store.read("missing"), null);
  store.save("Upper", "changed");
  check("saving a .MD note keeps its filename", entries(store.folder).includes("Upper.MD") && !entries(store.folder).includes("Upper.md"));
  eq("…and the save shows", store.read("Upper").text, "changed");
}

function timeList(store) {
  section("Timing");
  for (let i = 0; i < 300; i++) writeRaw(`${store.folder}/note-${i}.md`, `# Note ${i}\n- item one\n- item two\n\nSome text here.\n`.repeat(3));
  const start = Date.now();
  const count = store.list().length;
  eq("300 notes listed", count, 300);
  print(`info list() of 300 notes: ${Date.now() - start} ms`);
}

function testTrash(store) {
  section("Trash");
  const id = `scratchnotes-test-${$.NSUUID.UUID.UUIDString.js}`;
  store.save(id, `Created by ScratchNotes' test-storage.sh, which moved it to the Trash.\n`);
  store.updateMeta(id, { colour: "blue" });
  const trashed = store.trash(id);
  check("note is gone from the folder", !store.exists(id));
  check("its sidecar stays (for Put Back)", exists(`${store.folder}/.scratchnotes/${id}.json`));
  const trashFolder = `${$.NSHomeDirectory().js}/.Trash/`;
  check("Finder says it's in the Trash", typeof trashed === "string" && trashed.startsWith(trashFolder), trashed);
  eq("trashing a missing note returns null", store.trash("missing"), null);
  // Removes only the file this test put in the Trash.
  const name = trashed ? $(trashed).lastPathComponent.js : "";
  if (trashed && trashed.startsWith(trashFolder) && name.startsWith("scratchnotes-test-") && !name.includes("/")) {
    const removed = $.NSFileManager.defaultManager.removeItemAtPathError(trashed, null);
    print(removed ? `info removed ${trashed} from the Trash` : `info couldn't remove ${trashed} from the Trash; delete it by hand`);
  }
}

// ---------------------------------------------------------------------------
// Test helpers

function section(name) {
  print(`\n# ${name}`);
}

function check(name, condition, detail) {
  if (condition) {
    passed++;
    print(`ok    ${name}`);
  } else {
    failed++;
    print(`FAIL  ${name}${detail === undefined ? "" : ` (${typeof detail === "string" ? detail : JSON.stringify(detail)})`}`);
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, a === e ? undefined : `got ${a}, expected ${e}`);
}

function throws(name, fn, pattern) {
  try {
    fn();
    check(name, false, "didn't throw");
  } catch (e) {
    check(name, pattern.test(String(e.message)), String(e.message));
  }
}

function print(line) {
  $.NSFileHandle.fileHandleWithStandardOutput.writeData($(line + "\n").dataUsingEncoding($.NSUTF8StringEncoding));
}

function freshStore(root, name) {
  makeFolder(`${root}/${name}`);
  return noteStore(`${root}/${name}`);
}

function makeFolder(path) {
  $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(path, true, $(), null);
}

function writeRaw(path, text) {
  $(text).dataUsingEncoding($.NSUTF8StringEncoding).writeToFileAtomically(path, false);
}

function exists(path) {
  return $.NSFileManager.defaultManager.fileExistsAtPath(path);
}

function isFolder(path) {
  const folder = Ref();
  return $.NSFileManager.defaultManager.fileExistsAtPathIsDirectory(path, folder) && folder[0];
}

function entries(folder) {
  return ObjC.deepUnwrap($.NSFileManager.defaultManager.contentsOfDirectoryAtPathError(folder, null));
}

function leftoverTemps(folder) {
  const names = entries(folder).concat(exists(`${folder}/.scratchnotes`) ? entries(`${folder}/.scratchnotes`) : []);
  return names.filter((name) => name.startsWith(".scratchnotes-save-"));
}

function setDate(path, key, date) {
  const attributes = $.NSMutableDictionary.dictionary;
  attributes.setObjectForKey($.NSDate.dateWithTimeIntervalSince1970(date.getTime() / 1000), key);
  $.NSFileManager.defaultManager.setAttributesOfItemAtPathError(attributes, path, null);
}

function setTags(path, names) {
  $.NSURL.fileURLWithPath(path).setResourceValueForKeyError($(names), $.NSURLTagNamesKey, null);
}

function tags(path) {
  const value = Ref();
  $.NSURL.fileURLWithPath(path).getResourceValueForKeyError(value, $.NSURLTagNamesKey, null);
  return value[0] && !value[0].isNil() ? ObjC.deepUnwrap(value[0]) : [];
}

function xattrNames(path) {
  const task = $.NSTask.alloc.init;
  const pipe = $.NSPipe.pipe;
  task.launchPath = "/usr/bin/xattr";
  task.arguments = $([path]);
  task.standardOutput = pipe;
  task.launch;
  task.waitUntilExit;
  const output = $.NSString.alloc.initWithDataEncoding(pipe.fileHandleForReading.readDataToEndOfFile, $.NSUTF8StringEncoding).js;
  return output.split("\n").filter(Boolean);
}

// ---------------------------------------------------------------------------

// Runs lib.js from this script's own folder, wherever the script is run from
// (JXA has no require). The script's path is the argument osascript was given
// just before argv; relative paths are from the working directory. Returns the
// path it loaded. The same function is in every script in scripts/, with
// "lib.js" as the path.
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
