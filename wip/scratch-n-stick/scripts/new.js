#!/usr/bin/osascript -l JavaScript

// Script Filter for the new-note keyword: offers a new note starting with
// argv[0], the text typed after the keyword. With no text, "New note" (blank)
// comes first, then "New note from clipboard" when the clipboard has text
// (see clipboardText in lib.js).
//
// The results work as the results list's New note does (see newNoteResult in
// lib.js): ↩ opens the new note in a quick view inside Alfred, from a bundle
// written here before the results are shown, so the view replaces the results
// seamlessly; ⌘↩ sticks it (open.js).
//
// With argv[1] "sticky", for the new sticky note keyword, the results are
// "New sticky note", and so on, and ↩ and ⌘↩ swap: ↩ sticks the new note and
// ⌘↩ opens its quick view.
//
// The variable `scratchnstick_pasteboard` names a pasteboard to read instead of
// the clipboard, for dev/test-list.sh.

ObjC.import("Foundation");

function run(argv) {
  const workflowFolder = $(loadLib(argv, "lib.js")).stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.js;
  loadLib(argv, "titles.js");
  const text = (argv[0] || "").trim();
  const sticky = argv[1] === "sticky";
  const noun = sticky ? "sticky note" : "note";
  // A colour in User Configuration that can't be read shows what's wrong in
  // place of the results, as a new note's window needs the palette.
  const paletteProblems = notePaletteProblemItems();
  if (paletteProblems.length) return output(paletteProblems);
  let quick;
  try {
    // The notes may have to move to a newly configured folder first.
    const move = checkNotesFolderMove({ workflowFolder, showFailure: true });
    if (move.status !== "ready") return notesFolderMoveOutput(move);
    quick = quickWindows(noteStore(), workflowFolder);
  } catch (e) {
    return output([notesFolderErrorItem(e)]);
  }
  // Quick views' pages take their colour from Alfred's theme, which Alfred
  // gives a Script Filter (see noteThemeStylesheet in lib.js).
  attempt(() => writeNoteTheme(workflowVariable("alfred_theme_background")));
  const bundle = (text) => attempt(() => quick.bundleForNew(text)) || "";
  const result = (title, subtitle, text) => newNoteResult(title, subtitle, text, bundle(text), { sticky });
  if (text) return output([result(`New ${noun}: ${text}`, newNoteSubtitle(text, noun), text)]);
  const items = [result(`New ${noun}`, `Create a blank ${noun}`, "")];
  const clipboard = attempt(() => clipboardText(workflowVariable("scratchnstick_pasteboard")));
  if (clipboard) items.push(result(`New ${noun} from clipboard`, truncateText(clipboard.trim().replace(/\s+/g, " "), 100), clipboard));
  return output(items);
}

// What `fn` returns, or null if it throws, logging the error (to Alfred's
// debugger). A quick bundle that can't be written leaves the quick view's arg
// empty, so that key (↩, or ⌘↩ for a sticky note) does nothing, while the
// other still sticks the note.
function attempt(fn) {
  try {
    return fn();
  } catch (e) {
    console.log(e.message);
    return null;
  }
}

function output(items) {
  return JSON.stringify({ items });
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
