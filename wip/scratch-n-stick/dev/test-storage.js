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
  loadLib(argv, "../scripts/text-rules.js");
  const [command, ...args] = argv;
  if (command === "loader") return print(`loaded ${libPath} (noteStore: ${typeof noteStore})`);
  if (command === "save") return print(noteStore(args[0]).save(args[1], readText(args[2])));
  if (!args[0] || !args[0].includes("scratchnstick-test.")) throw new Error("Give the temporary folder test-storage.sh made");
  if (command === "test") {
    testConfiguration(args[0]);
    testIds(freshStore(args[0], "ids"));
    testSave(freshStore(args[0], "save"));
    testMeta(freshStore(args[0], "meta"));
    testSummary();
    testTitles();
    testUnicode(freshStore(args[0], "unicode"));
    testEmpty(freshStore(args[0], "empty"));
    testList(freshStore(args[0], "list"));
    testSweep(freshStore(args[0], "sweep"));
    testDailySweep(args[0]);
    testExamples(args[0]);
    testShippedExamples($(libPath).stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.js);
    timeList(freshStore(args[0], "timing"));
    timeSweep(freshStore(args[0], "timing-sweep"));
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
  eq("~ is expanded", expandPath("~/ScratchnStick"), `${$.NSHomeDirectory().js}/ScratchnStick`);
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
  makeFolder(`${store.folder}/.scratchnstick`);
  writeRaw(`${store.folder}/.scratchnstick/20261120-150302-2.json`, "{}");
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
  check("…no sidecar", !exists(`${store.folder}/.scratchnstick/${id}.json`));

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
  check("note added by hand has no sidecar yet", !exists(`${store.folder}/.scratchnstick/hand.json`));
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
  const sidecar = `${store.folder}/.scratchnstick/${id}.json`;
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
  check("sidecar for a note not saved yet", exists(`${store.folder}/.scratchnstick/not-saved-yet.json`));

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

// text-rules.js, with its tuning as shipped (SPLIT_LENGTH 65, and so on): a case
// whose split moves when a boundary is tuned needs its expected values updated.
function testTitles() {
  section("Titles: a single long line split");
  const splits = [
    ["sentence", "Call the plumber tomorrow morning. The kitchen tap is dripping again and the washer needs replacing.", "Call the plumber tomorrow morning.", "The kitchen tap is dripping again and the washer needs replacing."],
    ["question", "Should we move the team offsite to March? Venue availability is better then and half the team is away.", "Should we move the team offsite to March?", "Venue availability is better then and half the team is away."],
    ["as many sentences as fit", "Buy milk. Call mum. Then go to the gym and do the long session on the rower before dinner.", "Buy milk. Call mum.", "Then go to the gym and do the long session on the rower before dinner."],
    ["no break after an abbreviation", "Remind Mr. Jones to send the invoice. He promised it last Tuesday and accounts are chasing us.", "Remind Mr. Jones to send the invoice.", "He promised it last Tuesday and accounts are chasing us."],
    ["decimals and URLs aren't sentence ends", "Version 2.5 of the app ships on Friday. Release notes are at https://example.com/releases/2.5 for a read.", "Version 2.5 of the app ships on Friday.", "Release notes are at https://example.com/releases/2.5 for a read."],
    ["a short first sentence gives way to a comma", "Hi Sam. Thanks for the notes from yesterday, I've added the action items to the tracker and assigned owners.", "Hi Sam. Thanks for the notes from yesterday,", "I've added the action items to the tracker and assigned owners."],
    ["a short sentence with no punctuation break", "Note to self. Remember the password for the router is on the sticker underneath the box in the hallway", "Note to self.", "Remember the password for the router is on the sticker underneath the box in the hallway"],
    ["semicolon", "The figures look better than expected in every region; the board will want a breakdown by product line.", "The figures look better than expected in every region;", "the board will want a breakdown by product line."],
    ["colon", "Things to sort out before the holiday next week: passports, pet sitter, the car's MOT, and cancelling the milk", "Things to sort out before the holiday next week:", "passports, pet sitter, the car's MOT, and cancelling the milk"],
    ["dash, which goes", "Remember to book the venue for the spring fundraiser — the deposit is due by the end of March this year", "Remember to book the venue for the spring fundraiser", "the deposit is due by the end of March this year"],
    ["spaced hyphen as a dash", "Remember to book the venue for the spring fundraiser - the deposit is due by the end of March this year", "Remember to book the venue for the spring fundraiser", "the deposit is due by the end of March this year"],
    ["; : or a dash before a later comma", "Order more of the printer paper and toner today; the office runs out by Friday, and the supplier is slow", "Order more of the printer paper and toner today;", "the office runs out by Friday, and the supplier is slow"],
    ["the last comma that fits", "Check with Dr. Patel, Mrs. Okafor and the St. John's team, e.g. about cover, before we publish the rota.", "Check with Dr. Patel, Mrs. Okafor and the St. John's team,", "e.g. about cover, before we publish the rota."],
    ["list item marker removed first", "- [ ] Email the school about the trip. Ask about the consent form and the dietary requirements by Friday.", "Email the school about the trip.", "Ask about the consent form and the dietary requirements by Friday."],
    ["Markdown removed first", "**Call the plumber** tomorrow morning. The kitchen tap is dripping again and the washer needs replacing.", "Call the plumber tomorrow morning.", "The kitchen tap is dripping again and the washer needs replacing."],
  ];
  for (const [name, text, title, preview] of splits) eq(name, noteSummary(text), { title, preview });

  section("Titles: not split");
  const longRunOn = "idea for the blog post about how we migrated the whole notes system to plain markdown files and what we learned";
  const notSplit = [
    ["65 characters or fewer", "Buy milk. Also pick up the dry cleaning on the way back from work", "Buy milk. Also pick up the dry cleaning on the way back from work", ""],
    ["no sentence or punctuation break", longRunOn, longRunOn.slice(0, 79) + "…", ""],
    ["a comma too early", "Right, so the plan for the weekend is to drive up on Saturday morning and come back on Sunday", "Right, so the plan for the weekend is to drive up on Saturday morning and come…", ""],
    ["a break past the limit", "We need to decide on the final venue for the conference by the end of this month. Or lose it.", "We need to decide on the final venue for the conference by the end of this mont…", ""],
    ["an abbreviation's full stop isn't a break", "Ask Dr. Patel about the test results and whether the follow-up appointment needs moving", "Ask Dr. Patel about the test results and whether the follow-up appointment need…", ""],
    ["a heading", "# Planning document for the migration of the customer database. Owner: the data team, by Friday", "Planning document for the migration of the customer database. Owner: the data t…", ""],
    ["more than one line", "Shopping for the dinner party on Saturday night. Now eight people instead of six as planned.\n- lamb", "Shopping for the dinner party on Saturday night. Now eight people instead of si…", "lamb"],
  ];
  for (const [name, text, title, preview] of notSplit) eq(name, noteSummary(text), { title, preview });
  // macOS's sentence splitter only ends a sentence before a capital letter.
  eq("splitTitleLine: null at 65 characters", splitTitleLine("a".repeat(30) + ". " + "B".repeat(33)), null);
  eq("splitTitleLine: split at 66", splitTitleLine("a".repeat(30) + ". " + "B".repeat(34)), { title: "a".repeat(30) + ".", rest: "B".repeat(34) });
  eq("no sentence break before a lower-case letter", splitTitleLine("a".repeat(30) + ". " + "b".repeat(34)), null);
  const family = "👨‍👩‍👧‍👦";
  eq("emoji count as one character", splitTitleLine(`${family.repeat(40)}. ${"B".repeat(30)}`), { title: `${family.repeat(40)}.`, rest: "B".repeat(30) });
  const huge = "Call the plumber tomorrow morning. Then " + "word ".repeat(200000);
  const started = Date.now();
  const hugeSplit = splitTitleLine(huge);
  check("a very long line splits quickly", hugeSplit && hugeSplit.title === "Call the plumber tomorrow morning." && Date.now() - started < 200, `${Date.now() - started} ms`);

  section("Titles: text starting a new note");
  const seeds = [
    ["short text: a heading, then an empty line", "buy milk", "# buy milk\n\n"],
    ["trimmed", "  Trip to Lisbon \n", "# Trip to Lisbon\n\n"],
    ["a question", "What should we do about the garage?", "# What should we do about the garage?\n\n"],
    ["a trailing colon dropped", "Things to buy:", "# Things to buy\n\n"],
    ["an ellipsis isn't a full stop", "Ideas for the party...", "# Ideas for the party...\n\n"],
    ["an abbreviation isn't a sentence break", "Questions for Dr. Patel", "# Questions for Dr. Patel\n\n"],
    ["emoji", "🛒 Shopping", "# 🛒 Shopping\n\n"],
    ["60 characters", "a".repeat(60), `# ${"a".repeat(60)}\n\n`],
    ["61 characters: kept", "a".repeat(61), "a".repeat(61)],
    ["ends with a full stop: kept", "Remember to call the bank.", "Remember to call the bank."],
    ["two sentences: kept", "Call Bob! Ask about the invoice", "Call Bob! Ask about the invoice"],
    ["more than one line: kept exactly", "Plan\n\n  - one  \n", "Plan\n\n  - one  \n"],
    ["a heading already: kept", "## Plan", "## Plan"],
    ["a list item: kept", "- milk", "- milk"],
    ["a numbered item: kept", "1. first", "1. first"],
    ["a quote: kept", "> quoted", "> quoted"],
    ["a thematic break: kept", "---", "---"],
    ["a URL: kept", "https://example.com/page", "https://example.com/page"],
    ["www: kept", "www.example.com", "www.example.com"],
    ["an email address: kept", "someone@example.com", "someone@example.com"],
    ["a path: kept", "~/Documents/notes", "~/Documents/notes"],
    ["an absolute path: kept", "/usr/local/bin", "/usr/local/bin"],
    ["empty", "", ""],
    ["whitespace: kept", "  \n", "  \n"],
  ];
  for (const [name, seed, text] of seeds) eq(name, newNoteText(seed), text);
  eq("seedHeading: the heading or null", [seedHeading(" Trip "), seedHeading("Trip.")], ["Trip", null]);
  eq("newNoteSubtitle: heading or text", [newNoteSubtitle("buy milk"), newNoteSubtitle("Buy milk.")], ["Create a note with this heading", "Create a note with this text"]);

  // Round metrics, so sizes can be worked out by hand: characters 10 pt wide,
  // lines 20 pt tall, 34 pt of insets across and 44 down, so the usual
  // 360 × 288 holds 32 columns and 12 lines. On a 1440 × 900 screen the caps
  // are 576 × 630 (NOTE_MAX_WIDTH_FRACTION, NOTE_MAX_HEIGHT_FRACTION).
  section("Titles: a new sticky note's size");
  const metrics = (screen = { width: 1440, height: 900 }, scroller = 0) => ({
    font: { column: 10, line: 20 },
    insets: { top: 34, right: 15, bottom: 10, left: 19 },
    minimum: { width: 360, height: 288 },
    screen,
    scroller,
  });
  const fit = (text, ...rest) => fittedNoteSize(text, metrics(...rest));
  const lines = (count, line) => Array.from({ length: count }, (_, i) => line.replace("#", i + 1)).join("\n");
  const fence = (body) => "```\n" + body + "\n```";
  eq("blank: the usual size", fit(""), { width: 360, height: 288 });
  eq("a heading: the usual size", fit(newNoteText("buy milk")), { width: 360, height: 288 });
  eq("12 lines fit", fit(lines(12, "- item #")), { width: 360, height: 288 });
  eq("13 short lines: taller, not wider", fit(lines(13, "- item #")), { width: 360, height: 304 });
  eq("a 32-column line fits", fit("a".repeat(32)), { width: 360, height: 288 });
  eq("a long word wraps rather than widening", fit("https://example.com/" + "a".repeat(80)), { width: 360, height: 288 });
  eq("code: as wide as its longest line", fit(fence(lines(3, "x".repeat(50)))), { width: 534, height: 288 });
  eq("a table: as wide as its longest row", fit("| a | b |\n|" + "-".repeat(40) + "|"), { width: 454, height: 288 });
  eq("code wider than the cap: the cap", fit(fence("x".repeat(70))), { width: 576, height: 288 });
  eq("wide characters: two columns by default", fit(fence("中".repeat(20))), { width: 434, height: 288 });
  eq("emoji: two columns by default", fit(fence("🙂".repeat(20))), { width: 434, height: 288 });
  const ownWidths = Object.assign(metrics(), { font: { column: 10, line: 20, wide: 16, emoji: 23 } });
  eq("wide characters and emoji at the font's widths", [fittedNoteSize(fence("中".repeat(30)), ownWidths), fittedNoteSize(fence("🙂".repeat(20)), ownWidths)], [{ width: 514, height: 288 }, { width: 494, height: 288 }]);
  eq("© and ™ are one column", fit(fence("©™".repeat(20))), { width: 434, height: 288 });
  eq("a tab is TAB_STOP wide", fit(fence("\t".repeat(10) + "x".repeat(20))), { width: 514, height: 288 });
  // 150 four-letter words: at 424 pt (39 columns) 8 to a line, 19 lines,
  // 424 pt tall; a column narrower, 7 to a line, 22 lines, 484 pt tall.
  eq("prose widens until it's no taller than it's wide (NOTE_SHAPE 1)", fit("word ".repeat(150).trim()), { width: 424, height: 424 });
  eq("long text: the caps", fit("word ".repeat(5000)), { width: 576, height: 630 });
  eq("a wide screen: 800 pt at most", fit("word ".repeat(5000), { width: 3440, height: 1410 }), { width: 800, height: 987 });
  eq("a small screen: never below the usual size", fit("word ".repeat(5000), { width: 600, height: 300 }), { width: 360, height: 288 });
  eq("scrolling text leaves room for a scroll bar", fit(lines(100, "x"), undefined, 15), { width: 375, height: 630 });
  eq("…but not overlay scroll bars", fit(lines(100, "x")), { width: 360, height: 630 });
  const fitStarted = Date.now();
  fit("word ".repeat(200000));
  check("very long text sizes quickly", Date.now() - fitStarted < 300, `${Date.now() - fitStarted} ms`);
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
  check("…sidecar gone", !exists(`${store.folder}/.scratchnstick/emptied.json`));

  store.updateMeta("never-saved", { colour: "green" });
  eq("never-saved note with a colour: deleted", store.deleteIfEmpty("never-saved"), true);
  check("…sidecar gone", !exists(`${store.folder}/.scratchnstick/never-saved.json`));
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
  eq("listing gave the notes without sidecars one, and nothing else", entries(`${store.folder}/.scratchnstick`).sort(), ["Upper.json", "a.json", "b.json", "c.json"]);
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

function testSweep(store) {
  section("Sweeping sidecars");
  const day = 24 * 60 * 60 * 1000;
  const now = new Date(2026, 10, 27, 12, 0, 0);
  const sidecar = (id) => `${store.folder}/.scratchnstick/${id}.json`;
  const meta = (id) => readJsonObject(sidecar(id));
  const writeMeta = (id, value) => writeRaw(sidecar(id), typeof value === "string" ? value : JSON.stringify(value));
  makeFolder(`${store.folder}/.scratchnstick`);
  writeRaw(`${store.folder}/kept.md`, "A note");
  writeMeta("kept", { colour: 2 });
  writeRaw(`${store.folder}/Upper.MD`, "Upper case extension");
  writeMeta("Upper", { colour: 3 });
  writeRaw(`${store.folder}/${"Café".normalize("NFD")}.md`, "Decomposed name");
  writeMeta("Café".normalize("NFC"), { colour: 4 });
  writeMeta("new-orphan", { colour: 5, icon: "star" });
  writeMeta("recent", { colour: 1, trashed: formatLocalIsoDate(new Date(now - 10 * day)) });
  writeMeta("old", { colour: 1, trashed: formatLocalIsoDate(new Date(now - 30 * day)) });
  writeMeta("bad-date", { trashed: "yesterday" });
  writeMeta("corrupt", "{not json");
  writeMeta("open-unsaved", { colour: 6 });
  writeRaw(`${store.folder}/.scratchnstick/.scratchnstick-save-x.tmp`, "{}");
  writeRaw(`${store.folder}/.scratchnstick/notes.txt`, "not a sidecar");
  const isInUse = (id) => id === "open-unsaved";

  eq("a sweep dates the sidecars without a note and no date, and deletes those gone 30 days", store.sweepSidecars({ now, isInUse }), { stamped: 2, deleted: 1 });
  eq("…dated now, keeping the rest", meta("new-orphan"), { colour: 5, icon: "star", trashed: formatLocalIsoDate(now) });
  eq("…a date that can't be read is dated now", meta("bad-date"), { trashed: formatLocalIsoDate(now) });
  check("…gone 30 days: deleted", !exists(sidecar("old")));
  eq("…gone 10 days: kept as it was", meta("recent").trashed, formatLocalIsoDate(new Date(now - 10 * day)));
  eq("…notes' own sidecars untouched, whatever the name's case or normalisation", [meta("kept"), meta("Upper"), meta("Café".normalize("NFC"))], [{ colour: 2 }, { colour: 3 }, { colour: 4 }]);
  eq("…a sidecar that can't be read is left alone", readText(sidecar("corrupt")), "{not json");
  eq("…so is a note open but not saved yet", meta("open-unsaved"), { colour: 6 });
  check("…and other files", exists(`${store.folder}/.scratchnstick/.scratchnstick-save-x.tmp`) && exists(`${store.folder}/.scratchnstick/notes.txt`));

  eq("a day later: nothing more to do", store.sweepSidecars({ now: new Date(now.getTime() + day), isInUse }), { stamped: 0, deleted: 0 });
  eq("20 days later: the one gone 30 days is deleted", store.sweepSidecars({ now: new Date(now.getTime() + 20 * day), isInUse }), { stamped: 0, deleted: 1 });
  check("…the one gone 10 days", !exists(sidecar("recent")) && exists(sidecar("new-orphan")));
  eq("30 days after they were dated: the rest are deleted", store.sweepSidecars({ now: new Date(now.getTime() + 30 * day), isInUse }), { stamped: 0, deleted: 2 });
  eq("…leaving the notes', the unreadable one and the open note's", entries(`${store.folder}/.scratchnstick`).filter((name) => name.endsWith(".json")).map((name) => name.normalize("NFC")).sort(), ["Café.json", "Upper.json", "corrupt.json", "kept.json", "open-unsaved.json"]);

  writeMeta("kept", { colour: 2, trashed: formatLocalIsoDate(new Date(now - 40 * day)) });
  eq("a note that's back: listing removes its date", [store.list().find((n) => n.id === "kept").meta, meta("kept")], [{ colour: 2 }, { colour: 2 }]);
  writeMeta("kept", { trashed: formatLocalIsoDate(new Date(now - 40 * day)) });
  eq("…and the sidecar, if that was all it held", [store.read("kept").meta, exists(sidecar("kept"))], [{}, false]);
  writeMeta("kept", { colour: 2, trashed: formatLocalIsoDate(new Date(now - 40 * day)) });
  eq("a sweep leaves a dated sidecar alone while its note is there", [store.sweepSidecars({ now, isInUse }).deleted, exists(sidecar("kept"))], [0, true]);
  const empty = freshStore(store.folder, "empty");
  eq("no sidecars folder: nothing to do", empty.sweepSidecars({ now, isInUse }), { stamped: 0, deleted: 0 });
}

function testDailySweep(root) {
  section("Sweeping once a day");
  const data = `${root}/daily/data`;
  const settings = (name) => ({ alfred_workflow_data: data, alfred_workflow_cache: `${root}/daily/cache` })[name] || "";
  const store = freshStore(root, "daily/notes");
  makeFolder(`${store.folder}/.scratchnstick`);
  const orphan = (id) => writeRaw(`${store.folder}/.scratchnstick/${id}.json`, JSON.stringify({ colour: 1 }));
  const state = () => readJsonObject(`${data}/state.json`);
  const morning = new Date(2026, 10, 27, 8, 0, 0);
  writeLastNotesFolder(store.folder, settings);
  orphan("first");

  eq("the first run sweeps", sweepSidecarsDaily(store, { now: morning, variable: settings }), { stamped: 1, deleted: 0 });
  eq("…recording when, and keeping the notes folder's record", state(), { lastNotesFolder: store.folder, lastSidecarSweep: formatLocalIsoDate(morning) });
  orphan("second");
  eq("later the same day: no sweep", sweepSidecarsDaily(store, { now: new Date(2026, 10, 27, 23, 59, 0), variable: settings }), null);
  eq("…and nothing written", state().lastSidecarSweep, formatLocalIsoDate(morning));
  const midnight = new Date(2026, 10, 28, 0, 0, 0);
  eq("just after midnight: a sweep", sweepSidecarsDaily(store, { now: midnight, variable: settings }), { stamped: 1, deleted: 0 });
  eq("a clock set back a day: a sweep", sweepSidecarsDaily(store, { now: morning, variable: settings }), { stamped: 0, deleted: 0 });
  writeLastNotesFolder(`${root}/daily/other`, settings);
  eq("writing the notes folder's record keeps the sweep's", state(), { lastNotesFolder: `${root}/daily/other`, lastSidecarSweep: formatLocalIsoDate(morning) });
  writeRaw(`${data}/state.json`, "{not json");
  eq("an unreadable state: no record, and a sweep", [readLastNotesFolder(settings), sweepSidecarsDaily(store, { now: morning, variable: settings })], [null, { stamped: 0, deleted: 0 }]);
}

function testExamples(root) {
  section("Example notes");
  const source = `${root}/examples/source`;
  makeFolder(`${source}/.scratchnstick`);
  const shipped = { "example-1-welcome": { icon: "sticky-note" }, "example-2-tasks": { colour: 2, mode: "view" }, "example-10-last": { colour: 6 } };
  for (const [id, meta] of Object.entries(shipped)) {
    writeRaw(`${source}/${id}.md`, `# ${id}\n`);
    writeRaw(`${source}/.scratchnstick/${id}.json`, JSON.stringify(meta));
  }
  writeRaw(`${source}/example-3-no-sidecar.md`, "# No sidecar\n");
  for (const name of ["example-x-unnumbered.md", "example-4-text.txt", "notes.md", ".example-5-hidden.md"]) writeRaw(`${source}/${name}`, "x");
  const ids = ["example-1-welcome", "example-2-tasks", "example-3-no-sidecar", "example-10-last"];
  eq("examples are example-<n>-<name>.md, in order of <n> as a number", exampleNoteIds(source), ids);
  eq("…none in a missing folder", exampleNoteIds(`${root}/examples/none`), []);

  const now = new Date(2026, 10, 27, 9, 30, 15, 600);
  const second = (n) => new Date(2026, 10, 27, 9, 30, 15 - n);
  const store = freshStore(root, "examples/notes");
  eq("into an empty folder: every example", store.installExamples(source, { now }), ids);
  eq("…with its text", ids.map((id) => readText(`${store.folder}/${id}.md`)), ids.map((id) => readText(`${source}/${id}.md`)));
  eq("…dated a second apart, the first newest, in whole seconds", ids.map((id) => fileDate(`${store.folder}/${id}.md`, "NSFileModificationDate").getTime()), ids.map((_, i) => second(i).getTime()));
  eq("…born then too", ids.map((id) => fileDate(`${store.folder}/${id}.md`, "NSFileCreationDate").getTime()), ids.map((_, i) => second(i).getTime()));
  eq("…with the shipped sidecar and created", store.readMeta("example-2-tasks"), { colour: 2, mode: "view", created: formatLocalIsoDate(second(1)) });
  eq("…or only created without one", store.readMeta("example-3-no-sidecar"), { created: formatLocalIsoDate(second(2)) });
  eq("…and listed in their order", store.list().map((note) => note.id), ids);

  writeRaw(`${store.folder}/example-1-welcome.md`, "# Welcome, edited\n");
  store.updateMeta("example-1-welcome", { colour: 4 });
  const edited = fileDate(`${store.folder}/example-1-welcome.md`, "NSFileModificationDate");
  writeRaw(`${store.folder}/mine.md`, "# Mine\n");
  removeFile(`${store.folder}/example-2-tasks.md`);
  store.updateMeta("example-2-tasks", { colour: 5, trashed: "2026-11-26T10:00:00+13:00" });
  const later = new Date(2026, 11, 1, 12, 0, 0);
  eq("again: only the examples that are missing", store.installExamples(source, { now: later }), ["example-2-tasks"]);
  eq("…an example still there keeps its text", readText(`${store.folder}/example-1-welcome.md`), "# Welcome, edited\n");
  eq("…and its sidecar", store.readMeta("example-1-welcome"), { icon: "sticky-note", created: formatLocalIsoDate(second(0)), colour: 4 });
  eq("…and its date", fileDate(`${store.folder}/example-1-welcome.md`, "NSFileModificationDate").getTime(), edited.getTime());
  eq("…a trashed example's leftover sidecar is replaced", store.readMeta("example-2-tasks"), { colour: 2, mode: "view", created: formatLocalIsoDate(new Date(2026, 11, 1, 11, 59, 59)) });
  eq("…the user's notes are left alone", readText(`${store.folder}/mine.md`), "# Mine\n");

  section("Example notes, once");
  const data = `${root}/examples/data`;
  const settings = (name) => ({ alfred_workflow_data: data })[name] || "";
  const workflow = `${root}/examples/workflow`;
  makeFolder(workflow);
  $.NSFileManager.defaultManager.copyItemAtPathToPathError(source, `${workflow}/examples`, null);
  const once = freshStore(root, "examples/once");
  writeRaw(`${once.folder}/mine.md`, "# Mine\n");
  writeLastNotesFolder(once.folder, settings);
  eq("the first run adds them, beside the user's notes", installExamplesOnce(once, workflow, { now, variable: settings }), ids);
  eq("…recording when, and keeping the rest of the state", readJsonObject(`${data}/state.json`), { lastNotesFolder: once.folder, examplesInstalled: formatLocalIsoDate(now) });
  removeFile(`${once.folder}/example-3-no-sidecar.md`);
  eq("later runs don't, even with one deleted", installExamplesOnce(once, workflow, { now: later, variable: settings }), null);
  removeFile(`${data}/state.json`);
  eq("with the state gone, the missing ones come back", installExamplesOnce(once, workflow, { now: later, variable: settings }), ["example-3-no-sidecar"]);
  eq("…beside the rest", once.list().map((note) => note.id).sort(), ids.concat("mine").sort());

  const broken = `${root}/examples/broken`;
  makeFolder(`${broken}/examples/example-2-folder.md`);
  writeRaw(`${broken}/examples/example-1-fine.md`, "# Fine\n");
  writeRaw(`${broken}/examples/example-3-after.md`, "# After\n");
  const brokenData = `${root}/examples/broken-data`;
  const brokenSettings = (name) => ({ alfred_workflow_data: brokenData })[name] || "";
  const partial = freshStore(root, "examples/partial");
  throws("an example that can't be read throws", () => installExamplesOnce(partial, broken, { now, variable: brokenSettings }), /Can't read the example note example-2-folder/);
  eq("…after adding the ones before it", partial.list().map((note) => note.id), ["example-1-fine"]);
  eq("…and nothing is recorded, so the next run tries again", readWorkflowState(brokenSettings).examplesInstalled, undefined);
}

// The examples the workflow ships: numbered from 1 with no gaps, each with a
// sidecar holding only settings a note can have, all valid, and nothing else
// in the folder.
function testShippedExamples(workflowFolder) {
  section("The shipped examples");
  const source = `${workflowFolder}/examples`;
  const ids = exampleNoteIds(source);
  check("there are examples", ids.length > 0);
  eq("…numbered 1 to n", ids.map((id) => Number(/^example-(\d+)-/.exec(id)[1])), ids.map((_, i) => i + 1));
  eq("…and nothing else in the folder", entries(source).sort(), ids.map((id) => `${id}.md`).concat(".scratchnstick").sort());
  eq("…or in .scratchnstick", entries(`${source}/.scratchnstick`).sort(), ids.map((id) => `${id}.json`).sort());
  const icons = new Set(noteIcons().map((icon) => icon.name));
  const sizes = noteFontSizes();
  const slots = noteDefaultPalette().map((colour) => colour.slot);
  for (const id of ids) {
    const meta = readJsonObject(`${source}/.scratchnstick/${id}.json`);
    const problems = [];
    if (meta === null) problems.push("no sidecar");
    for (const [key, value] of Object.entries(meta || {})) {
      if (key === "colour" ? !slots.includes(value) : key === "icon" ? !icons.has(value) : key === "fontSize" ? !sizes.includes(value) : key === "mode" ? !["edit", "view"].includes(value) : true) problems.push(`${key}: ${JSON.stringify(value)}`);
    }
    eq(`the sidecar of ${id}`, problems, []);
  }
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

function timeSweep(store) {
  const day = 24 * 60 * 60 * 1000;
  const now = new Date();
  makeFolder(`${store.folder}/.scratchnstick`);
  for (let i = 0; i < 1100; i++) {
    const id = `note-${i}`;
    if (i < 1000) writeRaw(`${store.folder}/${id}.md`, `# Note ${i}\nSome text.\n`);
    const meta = { created: "2026-11-25T12:00:00+13:00", colour: 2 };
    if (i >= 1050) meta.trashed = formatLocalIsoDate(new Date(now - 40 * day));
    writeRaw(`${store.folder}/.scratchnstick/${id}.json`, JSON.stringify(meta));
  }
  let start = Date.now();
  const result = store.sweepSidecars({ now, isInUse: () => false });
  print(`info sweepSidecars of 1,000 notes and 1,100 sidecars (50 to date, 50 to delete): ${Date.now() - start} ms`);
  eq("1,000 notes and 100 sidecars without one: 50 dated, 50 deleted", result, { stamped: 50, deleted: 50 });
  start = Date.now();
  store.sweepSidecars({ now, isInUse: () => false });
  print(`info sweepSidecars again, with nothing to do: ${Date.now() - start} ms`);
}

function testTrash(store) {
  section("Trash");
  const id = `scratchnstick-test-${$.NSUUID.UUID.UUIDString.js}`;
  store.save(id, `Created by Scratch'n'Stick's test-storage.sh, which moved it to the Trash.\n`);
  store.updateMeta(id, { colour: "blue" });
  const trashed = store.trash(id);
  check("note is gone from the folder", !store.exists(id));
  check("its sidecar stays (for Put Back)", exists(`${store.folder}/.scratchnstick/${id}.json`));
  const stamped = parseDate(store.readMeta(id).trashed);
  check("…recording when it was trashed, and keeping the rest", stamped && Date.now() - stamped < 60000 && store.readMeta(id).colour === "blue", store.readMeta(id));
  const trashFolder = `${$.NSHomeDirectory().js}/.Trash/`;
  check("Finder says it's in the Trash", typeof trashed === "string" && trashed.startsWith(trashFolder), trashed);
  eq("trashing a missing note returns null", store.trash("missing"), null);
  // Removes only the file this test put in the Trash.
  const name = trashed ? $(trashed).lastPathComponent.js : "";
  if (trashed && trashed.startsWith(trashFolder) && name.startsWith("scratchnstick-test-") && !name.includes("/")) {
    const removed = $.NSFileManager.defaultManager.removeItemAtPathError(trashed, null);
    print(removed ? `info removed ${trashed} from the Trash` : `info couldn't remove ${trashed} from the Trash; delete it by hand`);
  }
}

function testMoveNotes(root) {
  section("Moving notes");
  const from = `${root}/move/from`;
  const to = `${root}/move/to`;
  makeFolder(from);
  makeFolder(`${to}/.scratchnstick`);
  const note = (folder, name, text, meta) => {
    writeRaw(`${folder}/${name}`, text);
    if (meta) writeRaw(`${folder}/.scratchnstick/${noteIdFromFileName(name)}.json`, JSON.stringify(meta));
  };
  makeFolder(`${from}/.scratchnstick`);
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
  writeRaw(`${from}/.scratchnstick/orphan.json`, JSON.stringify({ colour: "grey" }));
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
  writeRaw(`${to}/.scratchnstick/sidecar.json`, JSON.stringify({ colour: "red" }));
  writeRaw(`${to}/.scratchnstick/resumed.json`, JSON.stringify({ colour: "blue" }));
  writeRaw(`${to}/.scratchnstick-move-stopped.tmp`, "A partial copy");
  writeRaw(`${to}/.scratchnstick/.scratchnstick-move-stopped.tmp`, "A partial copy");

  const result = moveNotes(from, to);
  eq("only other files, hidden files and subfolders are left behind, without .scratchnstick", entries(from).sort(), [".hidden.md", "notes.txt", "sub"]);
  const notes = entries(to).filter((name) => !name.startsWith(".")).map((name) => name.normalize("NFC")).sort();
  eq(
    "the new folder's notes",
    notes,
    ["Café-2.md", "Café.md", "Upper-2.MD", "bare.md", "clash-2-2.md", "clash-2.md", "clash-3.md", "clash.md", "plain.md", "resumed.md", "same.md", "same2.md", "sidecar-2.md", "upper.md"],
  );
  const text = (name) => readText(`${to}/${name}`);
  const meta = (id) => readJsonObject(`${to}/.scratchnstick/${id}.json`);
  eq("a clash takes the next free suffix: clash-3, past the new folder's clash-2", [text("clash-3.md"), meta("clash-3")], ["From clash", { colour: "green" }]);
  eq("a suffixed ID clashing gets its own suffix: clash-2-2", text("clash-2-2.md"), "From clash-2");
  eq("the new folder's own notes are untouched", [text("clash.md"), text("clash-2.md"), meta("clash")], ["To clash", "To clash-2", null]);
  eq("extension case is kept, and Upper.MD clashes with upper.md", [text("Upper-2.MD"), meta("Upper-2")], ["Upper case extension", { colour: "green" }]);
  eq("a decomposed name clashes with the composed one", text("Café-2.md".normalize("NFD")) || text("Café-2.md"), "Decomposed name");
  eq("same text: one copy kept, and the sidecar moves when it has none", [text("same.md"), meta("same")], ["Same text", { colour: "pink" }]);
  eq("same text: the new folder's sidecar is kept", meta("same2"), { colour: "yellow" });
  eq("an ID taken by a sidecar alone: renamed with its own sidecar", [text("sidecar-2.md"), meta("sidecar-2"), meta("sidecar")], ["Its ID is taken by a sidecar alone", { colour: "purple" }, { colour: "red" }]);
  eq("a sidecar a stopped move copied doesn't take the ID", [text("resumed.md"), meta("resumed")], ["Its sidecar was copied by a move that stopped", { colour: "blue" }]);
  eq("a note without a sidecar moves without one", [text("bare.md"), exists(`${to}/.scratchnstick/bare.json`)], ["No sidecar", false]);
  eq("a sidecar without a note isn't moved", exists(`${to}/.scratchnstick/orphan.json`), false);
  eq("modification and birth times, and Finder tags, are kept", [fileDate(`${to}/plain.md`, "NSFileModificationDate").getTime(), fileDate(`${to}/plain.md`, "NSFileCreationDate").getTime(), tags(`${to}/plain.md`)], [modified.getTime(), birth.getTime(), ["Red"]]);
  eq("a stopped move's temporary files are deleted", entries(to).concat(entries(`${to}/.scratchnstick`)).filter((name) => name.startsWith(".scratchnstick-move-")), []);
  eq("moved and duplicates", [result.moved, result.duplicates], [8, 2]);
  eq("renamed", result.renamed.map(([a, b]) => `${a.normalize("NFC")}→${b.normalize("NFC")}`).sort(), ["Café→Café-2", "Upper→Upper-2", "clash-2→clash-2-2", "clash→clash-3", "sidecar→sidecar-2"]);
  eq("running it again moves nothing", moveNotes(from, to), { moved: 0, renamed: [], duplicates: 0 });

  // A move stopped after a note was copied but before the old one was deleted.
  note(from, "copied.md", "Copied, not yet deleted");
  makeFolder(`${from}/.scratchnstick`);
  writeRaw(`${from}/.scratchnstick/copied.json`, JSON.stringify({ colour: "orange" }));
  note(to, "copied.md", "Copied, not yet deleted");
  writeRaw(`${to}/.scratchnstick/copied.json`, JSON.stringify({ colour: "orange" }));
  eq("a stopped move is finished: the copy left behind is deleted", [moveNotes(from, to).duplicates, exists(`${from}/copied.md`), exists(`${from}/.scratchnstick`), meta("copied")], [1, false, false, { colour: "orange" }]);

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
  let notified = [];
  const settings = (notesFolder) => (name) => ({ alfred_workflow_data: data, alfred_workflow_cache: cache, notes_folder: notesFolder })[name] || "";
  const check_ = (notesFolder, showFailure = false) => {
    started = [];
    notified = [];
    return checkNotesFolderMove({ workflowFolder: "/nowhere", showFailure, start: (from, to) => started.push([from, to]), notify: (text) => notified.push(text), variable: settings(notesFolder) });
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
  eq("a failed move, in a Script Filter: the failure, nothing started", [check_(a, true), started], [{ status: "failed", error: "The disk is full" }, []]);
  eq("…marked as shown, and kept, so move.js knows a retry failing the same way is no news", readMoveFailure(settings(a)), { from: defaultFolder, to: a, error: "The disk is full", shown: true });
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
  eq("…with a notification saying why", notified, [`Your notes are now kept in ${$(a).stringByAbbreviatingWithTildeInPath.js}. No notes were moved, as the old folder, ${$(`${root}/check/gone`).stringByAbbreviatingWithTildeInPath.js}, wasn't found.`]);
  eq("…and no notification otherwise", [check_(a), notified], [{ status: "ready" }, []]);
  $.NSFileManager.defaultManager.createSymbolicLinkAtPathWithDestinationPathError(`${root}/check/link`, a, null);
  eq("the same folder by another path: ready, and the record takes the new path", [check_(`${root}/check/link`).status, started, record()], ["ready", [], `${root}/check/link`]);
  const message = (moved, renamed, duplicates, to) => notesMovedMessage({ moved, renamed: Array(renamed).fill(["a", "a-2"]), duplicates }, to, settings(""));
  eq("the message for a move: notes, and the default folder by name", message(1, 0, 0, defaultFolder), "Moved 1 note to the workflow's data folder.");
  eq("…several, with ~ for the home folder, counting duplicates", message(40, 0, 2, `${$.NSHomeDirectory().js}/Notes`), "Moved 42 notes to ~/Notes.");
  eq("…some renamed", message(5, 2, 0, "/Volumes/Disk/Notes"), "Moved 5 notes to /Volumes/Disk/Notes. 2 were renamed, as their names were taken there.");
  eq("…one renamed", message(5, 1, 0, "/Volumes/Disk/Notes"), "Moved 5 notes to /Volumes/Disk/Notes. 1 was renamed, as its name was taken there.");
  eq("…none to move", message(0, 0, 0, "/Volumes/Disk/Notes"), "Your notes are now kept in /Volumes/Disk/Notes. There were no notes to move.");
  eq("no record and a missing configured folder: nothing recorded", (() => {
    removeFile(`${data}/state.json`);
    check_(`${root}/check/missing`);
    return record();
  })(), null);
}

function timeMove(root) {
  section("Timing a move");
  const from = `${root}/timing-move/from`;
  const to = `${root}/timing-move/to`;
  makeFolder(`${from}/.scratchnstick`);
  makeFolder(to);
  for (let i = 0; i < 1000; i++) {
    writeRaw(`${from}/note-${i}.md`, `# Note ${i}\nSome text.\n`);
    writeRaw(`${from}/.scratchnstick/note-${i}.json`, JSON.stringify({ created: "2026-11-25T12:00:00+13:00", colour: "blue" }));
  }
  const start = Date.now();
  const result = moveNotes(from, to);
  const ms = Date.now() - start;
  eq("1,000 notes with sidecars moved", [result.moved, entries(to).length, entries(`${to}/.scratchnstick`).length], [1000, 1001, 1000]);
  print(`info moveNotes of 1,000 notes with sidecars, within a volume: ${ms} ms`);
}

// Moves notes from the temporary folder to a folder on another volume (a
// disk image test-storage.sh attaches), and back.
function testMoveVolume(root, volume) {
  section("Moving notes to another volume");
  const from = `${root}/volume-from`;
  const to = `${volume}/notes`;
  makeFolder(`${from}/.scratchnstick`);
  makeFolder(to);
  check("the two folders are on different volumes", volumeIdentity(from) !== volumeIdentity(to));
  writeRaw(`${from}/plain.md`, "Plain");
  writeRaw(`${from}/.scratchnstick/plain.json`, JSON.stringify({ colour: "blue" }));
  writeRaw(`${from}/clash.md`, "From clash");
  writeRaw(`${to}/clash.md`, "To clash");
  const birth = new Date(2021, 0, 1, 12, 0, 0);
  const modified = new Date(2022, 5, 1, 9, 30, 0);
  setDate(`${from}/plain.md`, "NSFileCreationDate", birth);
  setDate(`${from}/plain.md`, "NSFileModificationDate", modified);
  setTags(`${from}/plain.md`, ["Red"]);
  eq("moved", moveNotes(from, to), { moved: 2, renamed: [["clash", "clash-2"]], duplicates: 0 });
  eq("the old folder is empty", entries(from), []);
  eq("the notes and sidecar are there", [readText(`${to}/plain.md`), readText(`${to}/clash-2.md`), readJsonObject(`${to}/.scratchnstick/plain.json`)], ["Plain", "From clash", { colour: "blue" }]);
  eq("modification and birth times, and Finder tags, are kept", [fileDate(`${to}/plain.md`, "NSFileModificationDate").getTime(), fileDate(`${to}/plain.md`, "NSFileCreationDate").getTime(), tags(`${to}/plain.md`)], [modified.getTime(), birth.getTime(), ["Red"]]);
  eq("no temporary files are left", entries(to).concat(entries(`${to}/.scratchnstick`)).filter((name) => name.startsWith(".scratchnstick-move-")), []);
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
  const names = entries(folder).concat(exists(`${folder}/.scratchnstick`) ? entries(`${folder}/.scratchnstick`) : []);
  return names.filter((name) => name.startsWith(".scratchnstick-save-"));
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
