#!/usr/bin/osascript -l JavaScript
// Opens Apple's AirDrop panel with the given items loaded, for the user to pick a device.
//
// Each argument is a file or folder path, a URL, or text. Text is written to a .txt file in
// $alfred_workflow_cache and that file is sent. Prints an error message to stdout when the
// panel can't be shown (for the workflow's notification), and nothing otherwise. Progress goes
// to stderr, which Alfred's debugger shows.
//
// The process has to stay running while the panel is open, as the panel belongs to it. Once a
// device is picked, the transfer belongs to the system's AirDrop daemon (sharingd) and finishes
// whether or not this process is still running, so the script exits as soon as the panel closes.
// See DEVELOPMENT.md.

ObjC.import('AppKit');

const PANEL_WAIT = 30;     // seconds to wait for the panel to appear
const PANEL_TIMEOUT = 600; // seconds before giving up on a panel left open
const TEXT_KEEP = 86400;   // seconds to keep text files written for earlier runs
const TEXT_NAME_MAX = 40;  // characters of the text's first line used as its file name

const fm = $.NSFileManager.defaultManager;

function log(msg) {
  $.NSFileHandle.fileHandleWithStandardError.writeData($(msg + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
}

function env(name) {
  const v = $.NSProcessInfo.processInfo.environment.objectForKey(name);
  return v.isNil() ? '' : v.js;
}

function isFile(path) {
  return path.startsWith('/') && fm.fileExistsAtPath(path);
}

function isURL(text) {
  return /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(text);
}

// Alfred may pass several files as one tab-separated argument. Split it only when every part is
// an existing file, so text that happens to contain tabs is sent as it is.
function expandArgs(argv) {
  if (argv.length === 1 && argv[0].includes('\t')) {
    const parts = argv[0].split('\t');
    if (parts.every(isFile)) return parts;
  }
  return argv;
}

// Each run writes its text files into a folder of its own, as the AirDrop daemon may still be
// reading an earlier run's files. Folders older than TEXT_KEEP are removed.
function textFolder() {
  const base = (env('alfred_workflow_cache') || $.NSTemporaryDirectory().js.replace(/\/$/, '')) + '/text';
  const old = fm.contentsOfDirectoryAtPathError(base, $());
  if (!old.isNil()) {
    for (let i = 0; i < old.count; i++) {
      const path = base + '/' + old.objectAtIndex(i).js;
      const modified = fm.attributesOfItemAtPathError(path, $()).fileModificationDate;
      if (modified && -modified.timeIntervalSinceNow > TEXT_KEEP) fm.removeItemAtPathError(path, $());
    }
  }
  const folder = base + '/' + $.NSUUID.UUID.UUIDString.js;
  fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(folder, true, $(), $());
  return folder;
}

// The file name is what the recipient sees, so it's taken from the text's first line.
function textFileName(text, taken) {
  const firstLine = text.trim().split('\n')[0];
  let name = firstLine.replace(/[\/:\\\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (name.length > TEXT_NAME_MAX) name = name.slice(0, TEXT_NAME_MAX).trim() + '…';
  if (!name || name.startsWith('.')) name = 'Text';
  let candidate = name;
  for (let n = 2; taken.has(candidate); n++) candidate = name + ' ' + n;
  taken.add(candidate);
  return candidate + '.txt';
}

function toItems(args) {
  const items = $.NSMutableArray.array;
  let folder = null;
  const taken = new Set();
  for (const arg of args) {
    if (isFile(arg)) {
      items.addObject($.NSURL.fileURLWithPath(arg));
    } else if (isURL(arg.trim()) && !$.NSURL.URLWithString(arg.trim()).isNil()) {
      items.addObject($.NSURL.URLWithString(arg.trim()));
    } else if (arg.trim()) {
      folder = folder || textFolder();
      const path = folder + '/' + textFileName(arg, taken);
      if (!$(arg).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, $())) {
        throw new Error('Couldn’t write the text to a file in the workflow’s cache folder.');
      }
      items.addObject($.NSURL.fileURLWithPath(path));
    }
  }
  return items;
}

function runLoopFor(seconds) {
  $.NSRunLoop.currentRunLoop.runModeBeforeDate($.NSDefaultRunLoopMode, $.NSDate.dateWithTimeIntervalSinceNow(seconds));
}

function visibleWindows(app) {
  const windows = app.windows;
  let count = 0;
  for (let i = 0; i < windows.count; i++) if (windows.objectAtIndex(i).isVisible) count++;
  return count;
}

// The panel's windows belong to this process, which Alfred starts in the background, and macOS
// doesn't always let it become the active app, so the windows are raised explicitly.
function raiseWindows(app) {
  const windows = app.windows;
  for (let i = 0; i < windows.count; i++) {
    const w = windows.objectAtIndex(i);
    if (w.isVisible) w.orderFrontRegardless;
  }
}

function run(argv) {
  const args = expandArgs(argv);
  log('items: ' + JSON.stringify(args));
  if (args.length === 0) return 'Nothing to send.';

  let items;
  try { items = toItems(args); } catch (e) { return e.message; }
  if (items.count === 0) return 'Nothing to send.';

  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);

  const service = $.NSSharingService.sharingServiceNamed($.NSSharingServiceNameSendViaAirDrop);
  if (service.isNil()) return 'AirDrop isn’t available on this Mac.';
  if (!service.canPerformWithItems(items)) return 'AirDrop can’t send these items. Check that Wi-Fi and Bluetooth are on.';

  app.activateIgnoringOtherApps(true);
  service.performWithItems(items);

  // Finished when the panel has appeared and closed again (Done or Cancel, which the sharing
  // service's delegate reports the same way), or if it doesn't appear at all.
  const start = Date.now();
  let shown = false;
  while (true) {
    runLoopFor(0.25);
    const elapsed = (Date.now() - start) / 1000;
    const visible = visibleWindows(app) > 0;
    if (visible && !shown) { shown = true; raiseWindows(app); log('panel shown after ' + elapsed.toFixed(1) + 's'); }
    // A bare return prints nothing, where returning '' would print a newline.
    if (shown && !visible) { log('panel closed after ' + elapsed.toFixed(1) + 's'); return; }
    if (!shown && elapsed > PANEL_WAIT) return 'The AirDrop panel didn’t open.';
    if (elapsed > PANEL_TIMEOUT) { log('panel left open; closing it'); return; }
  }
}
