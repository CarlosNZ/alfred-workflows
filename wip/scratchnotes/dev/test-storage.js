#!/usr/bin/osascript -l JavaScript

// Tests for lib.js's storage functions, run by test-storage.sh, which makes
// the temporary folder every command works in. Never point it at a real notes
// folder.
//
//   test-storage.js loader                  prints the lib.js it loaded
//   test-storage.js test <temp folder>      the unit tests
//   test-storage.js save <folder> <id> <file>  saves the file's text as a note
//   test-storage.js trash <temp folder>     moves a note it creates to the Trash
//   test-storage.js move-volume <temp folder> <volume folder>
//                                           moves notes between two volumes

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
    testMoveNotes(args[0]);
    testMoveCheck(args[0]);
    timeMove(args[0]);
  } else if (command === "trash") {
    testTrash(freshStore(args[0], "trash"));
  } else if (command === "move-volume") {
    testMoveVolume(args[0], args[1]);
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
  let missing = null;
  try {
    notesFolder(variables({ notes_folder: configured }));
  } catch (e) {
    missing = e.missingFolder;
  }
  eq("a missing notes_folder throws, with missingFolder its path", missing, configured);
  check("…and isn't created", !exists(configured));
  makeFolder(configured);
  eq("notes_folder is used, trailing slash removed", notesFolder(variables({ notes_folder: configured + "/" })), configured);
  throws("notes_folder whose parent is missing", () => notesFolder(variables({ notes_folder: `${root}/no-such-volume/notes` })), /Missing notes folder/);
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
  check("note added by hand has no sidecar yet", !exists(`${store.folder}/.scratchnotes/hand.json`));
  eq("…created is its birth time", store.read("hand").created.getTime(), handBirth.getTime());
  eq("…first read records the birth time in a sidecar", store.readMeta("hand").created, formatLocalIsoDate(handBirth));
  store.save("hand", "edited");
  eq("…a save leaves it", store.readMeta("hand").created, formatLocalIsoDate(handBirth));
  writeRaw(`${store.folder}/hand2.md`, "added by hand, never read");
  setDate(`${store.folder}/hand2.md`, "NSFileCreationDate", handBirth);
  store.save("hand2", "saved before it was read");
  eq("note saved before it's read: first save records its birth time", store.readMeta("hand2").created, formatLocalIsoDate(handBirth));

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
  eq("no sidecar: readMeta is {}", store.readMeta(id), {});
  const birth = formatLocalIsoDate(fileDate(path, "NSFileCreationDate"));
  eq("no sidecar: read() records created", store.read(id).meta, { created: birth });

  setDate(path, "NSFileModificationDate", new Date(2020, 0, 1));
  eq("updateMeta returns the merged object", store.updateMeta(id, { colour: "yellow" }), { created: birth, colour: "yellow" });
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
  eq("…and reading doesn't overwrite it", readText(sidecar), "{not json");
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
    ["headings: ': ' after, ' | ' before", "## Meeting\n### Decisions\n- a\n- b\n### Actions\n- c", "Meeting", "Decisions: a, b | Actions: c"],
    ["heading after prose", "T\nSome text\n## Next\nmore", "T", "Some text | Next: more"],
    ["consecutive headings", "T\n## A\n## B\nx", "T", "A | B: x"],
    ["heading at the end", "T\ntext\n## Last", "T", "text | Last"],
    ["# inside a line isn't a heading", "T\nissue #12\nnext", "T", "issue #12 next"],
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
  eq("trailing | dropped before …", truncateText("a, b | Actions", 7), "a, b…");

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
  eq("listing gave the notes without sidecars one, and nothing else", entries(`${store.folder}/.scratchnotes`).sort(), ["Upper.json", "a.json", "b.json", "c.json"]);
  check("…recording created", typeof store.readMeta("b").created === "string");
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
  let start = Date.now();
  const count = store.list().length;
  eq("300 notes listed", count, 300);
  print(`info list() of 300 notes, first time (writing 300 sidecars): ${Date.now() - start} ms`);
  start = Date.now();
  store.list();
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

function testMoveNotes(root) {
  section("Moving notes");
  const from = `${root}/move/from`;
  const to = `${root}/move/to`;
  makeFolder(from);
  makeFolder(`${to}/.scratchnotes`);
  const note = (folder, name, text, meta) => {
    writeRaw(`${folder}/${name}`, text);
    if (meta) writeRaw(`${folder}/.scratchnotes/${noteIdFromFileName(name)}.json`, JSON.stringify(meta));
  };
  makeFolder(`${from}/.scratchnotes`);
  note(from, "plain.md", "Plain", { colour: "blue" });
  note(from, "bare.md", "No sidecar");
  note(from, "Upper.MD", "Upper case extension", { colour: "green" });
  note(from, "clash.md", "From clash", { colour: "green" });
  note(from, "clash-2.md", "From clash-2");
  note(from, "same.md", "Same text", { colour: "pink" });
  note(from, "same2.md", "Same text 2", { colour: "pink" });
  note(from, "sidecar.md", "Its ID is taken by a sidecar alone", { colour: "purple" });
  note(from, "resumed.md", "Its sidecar was copied by a move that stopped", { colour: "blue" });
  note(from, "Café.md".normalize("NFD"), "Decomposed name");
  writeRaw(`${from}/.scratchnotes/orphan.json`, JSON.stringify({ colour: "grey" }));
  writeRaw(`${from}/notes.txt`, "Not a note");
  writeRaw(`${from}/.hidden.md`, "Hidden");
  makeFolder(`${from}/sub`);
  writeRaw(`${from}/sub/inside.md`, "In a subfolder");
  const birth = new Date(2021, 0, 1, 12, 0, 0);
  const modified = new Date(2022, 5, 1, 9, 30, 0);
  setDate(`${from}/plain.md`, "NSFileCreationDate", birth);
  setDate(`${from}/plain.md`, "NSFileModificationDate", modified);
  setTags(`${from}/plain.md`, ["Red"]);

  note(to, "clash.md", "To clash");
  note(to, "clash-2.md", "To clash-2");
  note(to, "upper.md", "Lower case, the same file name as Upper.MD on a case-insensitive volume");
  note(to, "same.md", "Same text");
  note(to, "same2.md", "Same text 2", { colour: "yellow" });
  note(to, "Café.md".normalize("NFC"), "Composed name");
  writeRaw(`${to}/.scratchnotes/sidecar.json`, JSON.stringify({ colour: "red" }));
  writeRaw(`${to}/.scratchnotes/resumed.json`, JSON.stringify({ colour: "blue" }));
  writeRaw(`${to}/.scratchnotes-move-stopped.tmp`, "A partial copy");
  writeRaw(`${to}/.scratchnotes/.scratchnotes-move-stopped.tmp`, "A partial copy");

  const result = moveNotes(from, to);
  eq("only other files, hidden files and subfolders are left behind, without .scratchnotes", entries(from).sort(), [".hidden.md", "notes.txt", "sub"]);
  const notes = entries(to).filter((name) => !name.startsWith(".")).map((name) => name.normalize("NFC")).sort();
  eq(
    "the new folder's notes",
    notes,
    ["Café-2.md", "Café.md", "Upper-2.MD", "bare.md", "clash-2-2.md", "clash-2.md", "clash-3.md", "clash.md", "plain.md", "resumed.md", "same.md", "same2.md", "sidecar-2.md", "upper.md"],
  );
  const text = (name) => readText(`${to}/${name}`);
  const meta = (id) => readJsonObject(`${to}/.scratchnotes/${id}.json`);
  eq("a clash takes the next free suffix: clash-3, past the new folder's clash-2", [text("clash-3.md"), meta("clash-3")], ["From clash", { colour: "green" }]);
  eq("a suffixed ID clashing gets its own suffix: clash-2-2", text("clash-2-2.md"), "From clash-2");
  eq("the new folder's own notes are untouched", [text("clash.md"), text("clash-2.md"), meta("clash")], ["To clash", "To clash-2", null]);
  eq("extension case is kept, and Upper.MD clashes with upper.md", [text("Upper-2.MD"), meta("Upper-2")], ["Upper case extension", { colour: "green" }]);
  eq("a decomposed name clashes with the composed one", text("Café-2.md".normalize("NFD")) || text("Café-2.md"), "Decomposed name");
  eq("same text: one copy kept, and the sidecar moves when it has none", [text("same.md"), meta("same")], ["Same text", { colour: "pink" }]);
  eq("same text: the new folder's sidecar is kept", meta("same2"), { colour: "yellow" });
  eq("an ID taken by a sidecar alone: renamed with its own sidecar", [text("sidecar-2.md"), meta("sidecar-2"), meta("sidecar")], ["Its ID is taken by a sidecar alone", { colour: "purple" }, { colour: "red" }]);
  eq("a sidecar a stopped move copied doesn't take the ID", [text("resumed.md"), meta("resumed")], ["Its sidecar was copied by a move that stopped", { colour: "blue" }]);
  eq("a note without a sidecar moves without one", [text("bare.md"), exists(`${to}/.scratchnotes/bare.json`)], ["No sidecar", false]);
  eq("a sidecar without a note isn't moved", exists(`${to}/.scratchnotes/orphan.json`), false);
  eq("modification and birth times, and Finder tags, are kept", [fileDate(`${to}/plain.md`, "NSFileModificationDate").getTime(), fileDate(`${to}/plain.md`, "NSFileCreationDate").getTime(), tags(`${to}/plain.md`)], [modified.getTime(), birth.getTime(), ["Red"]]);
  eq("a stopped move's temporary files are deleted", entries(to).concat(entries(`${to}/.scratchnotes`)).filter((name) => name.startsWith(".scratchnotes-move-")), []);
  eq("moved and duplicates", [result.moved, result.duplicates], [8, 2]);
  eq("renamed", result.renamed.map(([a, b]) => `${a.normalize("NFC")}→${b.normalize("NFC")}`).sort(), ["Café→Café-2", "Upper→Upper-2", "clash-2→clash-2-2", "clash→clash-3", "sidecar→sidecar-2"]);
  eq("running it again moves nothing", moveNotes(from, to), { moved: 0, renamed: [], duplicates: 0 });

  // A move stopped after a note was copied but before the old one was deleted.
  note(from, "copied.md", "Copied, not yet deleted");
  makeFolder(`${from}/.scratchnotes`);
  writeRaw(`${from}/.scratchnotes/copied.json`, JSON.stringify({ colour: "orange" }));
  note(to, "copied.md", "Copied, not yet deleted");
  writeRaw(`${to}/.scratchnotes/copied.json`, JSON.stringify({ colour: "orange" }));
  eq("a stopped move is finished: the copy left behind is deleted", [moveNotes(from, to).duplicates, exists(`${from}/copied.md`), exists(`${from}/.scratchnotes`), meta("copied")], [1, false, false, { colour: "orange" }]);

  const before = entries(to).sort();
  note(from, "taken.md", "Can't move");
  const locked = `${root}/move/locked`;
  makeFolder(locked);
  $.NSFileManager.defaultManager.setAttributesOfItemAtPathError($({ NSFilePosixPermissions: 0o555 }), locked, null);
  throws("a note that can't be moved: throws, naming it", () => moveNotes(from, locked), /taken\.md/);
  check("…and it stays where it was", exists(`${from}/taken.md`));
  $.NSFileManager.defaultManager.setAttributesOfItemAtPathError($({ NSFilePosixPermissions: 0o755 }), locked, null);
  eq("…and nothing else changed", entries(to).sort(), before);

  check("same folder: a path through a symlink", (() => {
    $.NSFileManager.defaultManager.createSymbolicLinkAtPathWithDestinationPathError(`${root}/move/link`, to, null);
    return isSameFolder(`${root}/move/link`, to);
  })());
  check("same folder: a path differing in case (a case-insensitive volume)", isSameFolder(`${root}/move/TO`, to));
  check("different folders", !isSameFolder(from, to));
  check("a missing folder is never the same", !isSameFolder(`${root}/move/missing`, `${root}/move/missing`));
  eq("removeFolderIfEmpty: kept with a file in it, removed with only .DS_Store", [removeFolderIfEmpty(from), exists(from), (() => {
    makeFolder(`${root}/move/empty`);
    writeRaw(`${root}/move/empty/.DS_Store`, "");
    return removeFolderIfEmpty(`${root}/move/empty`);
  })(), exists(`${root}/move/empty`)], [false, true, true, false]);
}

function testMoveCheck(root) {
  section("Noticing a move");
  const data = `${root}/check/data`;
  const cache = `${root}/check/cache`;
  const a = `${root}/check/a`;
  makeFolder(a);
  let started = [];
  const settings = (notesFolder) => (name) => ({ alfred_workflow_data: data, alfred_workflow_cache: cache, notes_folder: notesFolder })[name] || "";
  const check_ = (notesFolder, showFailure = false) => {
    started = [];
    return checkNotesFolderMove({ workflowFolder: "/nowhere", showFailure, start: (from, to) => started.push([from, to]), variable: settings(notesFolder) });
  };
  const record = () => readLastNotesFolder(settings(""));
  const defaultFolder = `${data}/notes`;

  eq("first run: ready", check_("").status, "ready");
  eq("…records the folder, the default one, which is created", [record(), isFolder(defaultFolder)], [defaultFolder, true]);
  eq("the same folder again: ready, nothing started", [check_("").status, started], ["ready", []]);
  eq("a new folder: a move from the recorded folder starts", [check_(a).status, started], ["moving", [[defaultFolder, a]]]);
  eq("…and the record stays until the move finishes", record(), defaultFolder);
  eq("a missing new folder: ready, nothing started (notesFolder then says it's missing)", [check_(`${root}/check/missing`).status, started, record()], ["ready", [], defaultFolder]);

  writeMoveFailure({ from: defaultFolder, to: a, error: "The disk is full" }, settings(a));
  eq("a failed move, in a Script Filter: the failure, once, nothing started", [check_(a, true), started], [{ status: "failed", error: "The disk is full" }, []]);
  eq("…then the next run tries again", [check_(a, true).status, started], ["moving", [[defaultFolder, a]]]);
  writeMoveFailure({ from: defaultFolder, to: a, error: "The disk is full" }, settings(a));
  eq("a failed move, elsewhere (open.js): tries again, and the failure stays for the list", [check_(a).status, started.length, readMoveFailure(settings(a)).error], ["moving", 1, "The disk is full"]);
  writeMoveFailure({ from: defaultFolder, to: `${root}/check/other`, error: "Old" }, settings(a));
  eq("a failure of a different move is ignored", [check_(a, true).status, started.length], ["moving", 1]);

  check("the lock: taken", takeMoveLock(settings(a)));
  eq("…while held: moving, nothing started", [check_(a).status, started], ["moving", []]);
  check("…can't be taken twice", !takeMoveLock(settings(a)));
  releaseMoveLock(settings(a));
  check("…released", !exists(`${cache}/move.lock`));
  makeFolder(`${cache}/move.lock`);
  check("a lock with no process ID yet counts as held", isMoveLockHeld(settings(a)));
  writeRaw(`${cache}/move.lock/pid`, "999999\n");
  check("a lock whose process has gone is stale", !isMoveLockHeld(settings(a)));
  check("…and is taken over", takeMoveLock(settings(a)) && readText(`${cache}/move.lock/pid`).trim() !== "999999");
  releaseMoveLock(settings(a));

  writeLastNotesFolder(`${root}/check/gone`, settings(a));
  eq("a missing old folder: ready, nothing started, the record is the new folder", [check_(a).status, started, record()], ["ready", [], a]);
  $.NSFileManager.defaultManager.createSymbolicLinkAtPathWithDestinationPathError(`${root}/check/link`, a, null);
  eq("the same folder by another path: ready, and the record takes the new path", [check_(`${root}/check/link`).status, started, record()], ["ready", [], `${root}/check/link`]);
  eq("no record and a missing configured folder: nothing recorded", (() => {
    removeFile(`${data}/last-notes-folder`);
    check_(`${root}/check/missing`);
    return record();
  })(), null);
}

function timeMove(root) {
  section("Timing a move");
  const from = `${root}/timing-move/from`;
  const to = `${root}/timing-move/to`;
  makeFolder(`${from}/.scratchnotes`);
  makeFolder(to);
  for (let i = 0; i < 1000; i++) {
    writeRaw(`${from}/note-${i}.md`, `# Note ${i}\nSome text.\n`);
    writeRaw(`${from}/.scratchnotes/note-${i}.json`, JSON.stringify({ created: "2026-11-25T12:00:00+13:00", colour: "blue" }));
  }
  const start = Date.now();
  const result = moveNotes(from, to);
  const ms = Date.now() - start;
  eq("1,000 notes with sidecars moved", [result.moved, entries(to).length, entries(`${to}/.scratchnotes`).length], [1000, 1001, 1000]);
  print(`info moveNotes of 1,000 notes with sidecars, within a volume: ${ms} ms`);
}

// Moves notes from the temporary folder to a folder on another volume (a
// disk image test-storage.sh attaches), and back.
function testMoveVolume(root, volume) {
  section("Moving notes to another volume");
  const from = `${root}/volume-from`;
  const to = `${volume}/notes`;
  makeFolder(`${from}/.scratchnotes`);
  makeFolder(to);
  check("the two folders are on different volumes", volumeIdentity(from) !== volumeIdentity(to));
  writeRaw(`${from}/plain.md`, "Plain");
  writeRaw(`${from}/.scratchnotes/plain.json`, JSON.stringify({ colour: "blue" }));
  writeRaw(`${from}/clash.md`, "From clash");
  writeRaw(`${to}/clash.md`, "To clash");
  const birth = new Date(2021, 0, 1, 12, 0, 0);
  const modified = new Date(2022, 5, 1, 9, 30, 0);
  setDate(`${from}/plain.md`, "NSFileCreationDate", birth);
  setDate(`${from}/plain.md`, "NSFileModificationDate", modified);
  setTags(`${from}/plain.md`, ["Red"]);
  eq("moved", moveNotes(from, to), { moved: 2, renamed: [["clash", "clash-2"]], duplicates: 0 });
  eq("the old folder is empty", entries(from), []);
  eq("the notes and sidecar are there", [readText(`${to}/plain.md`), readText(`${to}/clash-2.md`), readJsonObject(`${to}/.scratchnotes/plain.json`)], ["Plain", "From clash", { colour: "blue" }]);
  eq("modification and birth times, and Finder tags, are kept", [fileDate(`${to}/plain.md`, "NSFileModificationDate").getTime(), fileDate(`${to}/plain.md`, "NSFileCreationDate").getTime(), tags(`${to}/plain.md`)], [modified.getTime(), birth.getTime(), ["Red"]]);
  eq("no temporary files are left", entries(to).concat(entries(`${to}/.scratchnotes`)).filter((name) => name.startsWith(".scratchnotes-move-")), []);
  eq("and back again", moveNotes(to, from).moved, 3);
  eq("…with the times kept", [fileDate(`${from}/plain.md`, "NSFileModificationDate").getTime(), fileDate(`${from}/plain.md`, "NSFileCreationDate").getTime()], [modified.getTime(), birth.getTime()]);
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
