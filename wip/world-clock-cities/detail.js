#!/usr/bin/osascript -l JavaScript

// Pulse script for a city's detail view: prints the JSON update that fills in
// the view, run when the view opens and every second while it's open.
//
// It's run through the link to it in the city's package (see panel.zsh): the
// package, the folder the link is in, holds the city's record in city.json,
// and the link resolves to the workflow folder, which holds lib/. The
// package is in panels/ in the workflow's cache folder, with shown-time.json,
// the time the results last showed (saveShownTime in lib/detail.js), and
// next to images/, which holds the city's picture.
//
// With the arguments `ui <launch> <picture> <clockChange>`, it prints that
// variant of the view's ui.json instead (see lib/panel.js), for panel.zsh.
// <picture> and <clockChange> are 1 or 0.
//
// With the argument `back`, run by ⌫ in the inline view, it shows Alfred's
// results again, by searching for what the view was opened from (search.txt
// in the package, see panel.zsh), or finishes the view if there's none.

ObjC.import("Foundation");
ObjC.import("CoreFoundation");
ObjC.import("AppKit");

const LIBS = ["lib/cities.js", "lib/time.js", "lib/sun.js", "lib/format.js", "lib/pictures.js", "lib/detail.js", "lib/panel.js"];

function run(argv) {
  const { packageDir, workflowDir } = scriptFolders();
  if (argv[0] === "back") return backToResults(packageDir);
  $.NSFileManager.defaultManager.changeCurrentDirectoryPath(workflowDir);
  LIBS.forEach(loadLib);

  if (argv[0] === "ui") {
    const [launch, picture, clockChange] = argv.slice(1);
    return JSON.stringify(panelUi({ launch, picture: picture === "1", clockChange: clockChange === "1" }), null, 2);
  }

  const saved = readJson(`${packageDir}/city.json`);
  if (!saved) return JSON.stringify({});
  // The time and the Mac's zone as the results last had them, including the
  // testing overrides (WCC_NOW and TZ), which this process doesn't see.
  const shown = readJson(`${packageDir}/../shown-time.json`) || {};
  const now = currentTime(shown.testNow);
  const typed = shown.typed || null;
  const moment = detailMoment(typed, now);
  const macZone = shown.testTimeZone || macTimeZone();
  const info = describeCity(saved.city, moment, { isLocal: saved.isLocal, now, macZone });
  const imagesDir = $(`${packageDir}/../../images`).stringByStandardizingPath.js;
  const ui = readJson(`${packageDir}/ui.json`);
  const update = detailUpdate(info, {
    typed,
    now,
    picture: pictureState(imagesDir, citySlug(saved.city)),
    iconsDir: `${workflowDir}/icons`,
    layout: { picture: layoutHasComponent(ui, "picture") },
  });
  return JSON.stringify({ ...update, ...windowResize(packageDir, ui) });
}

// For a detail window (a package named …-window.alfredui, see panel.zsh), a
// JSON Action giving it the size in its layout (`ui`, the package's ui.json):
// frameautosave restores the window's saved size over the size in its
// layout, which would keep the size of whichever layout it last had. The
// layout is the one the window opened with, since panel.zsh doesn't relink an
// open window's. Never for the inline view, which would resize Alfred's own
// window.
function windowResize(packageDir, ui) {
  if (!packageDir.endsWith("-window.alfredui")) return {};
  const size = ui && ui.window && ui.window.size;
  return size ? { window: { resize: windowSizeFromLayout(size) } } : {};
}

// The folder this script was run from (through the link), and the folder of
// the file it links to. osascript's arguments are its own path, "-l",
// "JavaScript", then the script's path, which may be relative to the working
// directory.
// Starts a search in Alfred for the package's search.txt, which replaces the
// inline view with those results, and prints no JSON Action. Without a search, a
// finish action, which hides Alfred.
function backToResults(packageDir) {
  const search = $.NSString.stringWithContentsOfFileEncodingError(`${packageDir}/search.txt`, $.NSUTF8StringEncoding, null);
  if (search.isNil() || search.js === "") return JSON.stringify({ finish: {} });
  // From a process of its own, not waited for: Alfred runs this script from
  // the view and waits for it to end, so asking Alfred to search from here
  // and waiting for its reply would deadlock (tested: Alfred hung). The
  // search goes in as an argument, not into the script's source.
  $.NSTask.launchedTaskWithLaunchPathArguments("/usr/bin/osascript", [
    "-e",
    "on run argv",
    "-e",
    'tell application id "com.runningwithcrayons.Alfred" to search (item 1 of argv)',
    "-e",
    "end run",
    search.js,
  ]);
  return JSON.stringify({});
}

function scriptFolders() {
  const path = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments)[3];
  const url = $.NSURL.fileURLWithPath(path);
  return {
    packageDir: url.URLByDeletingLastPathComponent.path.js,
    workflowDir: url.URLByResolvingSymlinksInPath.URLByDeletingLastPathComponent.path.js,
  };
}

function readJson(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  return text.isNil() ? null : JSON.parse(text.js);
}

// Runs a file from lib/ in the global scope, as results.js does (see loadLib
// there).
function loadLib(file) {
  const source = $.NSString.stringWithContentsOfFileEncodingError(file, $.NSUTF8StringEncoding, null);
  if (source.isNil()) throw new Error(`Can't load ${file}`);
  (0, eval)(source.js);
}
