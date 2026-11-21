#!/usr/bin/osascript -l JavaScript

// Pulse script for a city's detail view (panel.alfredui): prints the JSON
// update that fills in the view with the city now, run when the view opens and
// every second while it's open.
//
// It's run through the link to it in the city's package (see panel.zsh): the
// package, the folder the link is in, holds the city's record in city.json,
// and the link resolves to the workflow folder, which holds lib/.

ObjC.import("Foundation");
ObjC.import("CoreFoundation");

const LIBS = ["lib/cities.js", "lib/time.js", "lib/sun.js", "lib/format.js", "lib/detail.js"];

function run() {
  const { packageDir, workflowDir } = scriptFolders();
  $.NSFileManager.defaultManager.changeCurrentDirectoryPath(workflowDir);
  LIBS.forEach(loadLib);

  const saved = readJson(`${packageDir}/city.json`);
  if (!saved) return JSON.stringify({});
  const info = describeCity(saved.city, currentTime(), { isLocal: saved.isLocal });
  return JSON.stringify(detailUpdate(info));
}

// The folder this script was run from (through the link), and the folder of
// the file it links to. osascript's arguments are its own path, "-l",
// "JavaScript", then the script's path, which may be relative to the working
// directory.
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
