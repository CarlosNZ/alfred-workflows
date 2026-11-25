#!/usr/bin/osascript -l JavaScript

// Installs the sample notes, example1 to example8, in the current notes
// folder, replacing any notes with those IDs, so the samples can always be
// reset however they've been edited. Other notes aren't touched.
//
//   dev/install-samples.js            the notes folder Alfred uses
//   dev/install-samples.js <folder>   another folder (for testing)
//
// The notes folder is found as Alfred finds it (notesFolder in lib.js): the
// workflow variables if they're set (when Alfred runs it), otherwise the
// `notes_folder` saved in the workflow's prefs.plist, otherwise notes/ in the
// workflow's data folder.
//
// Each sample is reset whole: its text, its sidecar (rebuilt, so a colour set
// since is cleared) and its dates. The dates are spread from just now to two
// months ago, so the results list shows each kind of edit time.

ObjC.import("Foundation");

const SAMPLES = [
  { age: "20s", text: "# ☕ Café ideas\n\n- Flat white with oat milk\n- Try the **Ethiopian** single origin\n- Ask about the crème brûlée\n" },
  {
    age: "12m",
    text:
      "Thoughts on the garden\n\nThe tomatoes along the north fence never get enough sun, so next spring they should move to the raised bed by the shed, where the beans were this year. The beans can climb the fence instead; they cope with shade much better, and it frees up the bed for something hungrier.\n",
  },
  { age: "2h", text: "# Shopping\n- milk\n- eggs\n- flour\n- [ ] birthday card for Sam\n- [x] batteries (AA)\n" },
  { age: "5h", text: "021 555 0199 — plumber, call back after 3pm\nRef: job #4471\n" },
  {
    age: "1d",
    text:
      "## Team meeting\n\n### Decisions\n- Ship the beta on **Friday**\n- Move stand-up to 9:30\n\n### Actions\n- [ ] Carl: write release notes\n- [ ] Update the [roadmap](https://example.com/roadmap)\n",
  },
  { age: "3d", text: '```zsh\nfind . -name "*.md" -mtime -7 | xargs wc -l\n```\nCounts lines in Markdown files changed this week.\n' },
  { age: "6d", text: '> "The best way to get a good idea is to have lots of ideas."\n> — Linus Pauling\n' },
  { age: "60d", text: "Books to read\n1. The Overstory\n2. Piranesi\n3. Klara and the Sun\n" },
];

const SECONDS = { s: 1, m: 60, h: 3600, d: 86400 };

function run(argv) {
  loadLib(argv, "../scripts/lib.js");
  loadLib(argv, "../scripts/titles.js");
  const workflow = $(scriptFolder(argv)).stringByDeletingLastPathComponent.js;
  const store = noteStore(argv[0] ? expandPath(argv[0]) : notesFolder(variableOutsideAlfred(workflow)));
  const now = Date.now();
  const lines = [`Notes folder: ${store.folder}`];
  SAMPLES.forEach((sample, index) => {
    const id = `example${index + 1}`;
    const existed = store.exists(id);
    const date = new Date(now - Number(sample.age.slice(0, -1)) * SECONDS[sample.age.slice(-1)] * 1000);
    writeFileAtomically(store.notePath(id), sample.text);
    setFileDates(store.notePath(id), date);
    store.updateMeta(id, Object.fromEntries(Object.keys(store.readMeta(id)).map((key) => [key, null])));
    store.updateMeta(id, { created: formatLocalIsoDate(date) });
    lines.push(`${existed ? "replaced" : "added   "} ${id}  ${noteSummary(sample.text).title}`);
  });
  return lines.join("\n");
}

// Reads a workflow variable as Alfred would set it: from the environment when
// Alfred runs this, otherwise from the User Configuration saved in prefs.plist,
// with the data folder worked out from the bundle ID.
function variableOutsideAlfred(workflow) {
  const prefs = $.NSDictionary.dictionaryWithContentsOfFile(`${workflow}/prefs.plist`);
  const bundleId = $.NSDictionary.dictionaryWithContentsOfFile(`${workflow}/info.plist`).objectForKey("bundleid").js;
  const fallback = {
    alfred_workflow_data: `${$.NSHomeDirectory().js}/Library/Application Support/Alfred/Workflow Data/${bundleId}`,
  };
  return (name) => {
    const fromEnvironment = workflowVariable(name);
    if (fromEnvironment) return fromEnvironment;
    const saved = prefs.isNil() ? $() : prefs.objectForKey(name);
    return !saved.isNil() && saved.js ? saved.js : fallback[name] || "";
  };
}

function setFileDates(path, date) {
  const attributes = $.NSMutableDictionary.dictionary;
  const nsDate = $.NSDate.dateWithTimeIntervalSince1970(date.getTime() / 1000);
  attributes.setObjectForKey(nsDate, "NSFileCreationDate");
  attributes.setObjectForKey(nsDate, "NSFileModificationDate");
  $.NSFileManager.defaultManager.setAttributesOfItemAtPathError(attributes, path, null);
}

function scriptFolder(argv) {
  const args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments);
  let script = args[args.length - argv.length - 1];
  if (!script.startsWith("/")) script = `${$.NSFileManager.defaultManager.currentDirectoryPath.js}/${script}`;
  return $(script).stringByDeletingLastPathComponent.stringByStandardizingPath.js;
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
