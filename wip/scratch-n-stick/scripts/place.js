#!/usr/bin/osascript -l JavaScript

// Moves a sticky window that's opening back where it was left, in the
// background: argv[0] is its bundle's path, and argv[1] and argv[2] the top
// left it belongs at, in the Accessibility API's coordinates (from the top
// left of the primary screen, downwards). startStickyWindowPlacement in
// lib.js starts it from open.js, before the window opens; see "Sticky window
// positions" in lib.js for why it's needed.
//
// It leaves the process group it was started in, as move.js does, so nothing
// that stops open.js's run stops it. It waits up to WAIT_SECONDS for the
// window: the Alfred UI process launched with the bundle's path, and its
// window on screen. If the window isn't at the top left given (AppKit opened
// it on another screen), it moves it there, through the Accessibility API,
// and checks again, as AppKit may still be placing it; when it's there, it
// stops. AppKit saves the moved frame, as it does after any move.
//
// The Accessibility API needs the permission of the app that started it,
// Alfred, which most Alfred users have given. Without it, it does nothing
// and the window stays where AppKit put it. It needs nothing from lib.js,
// so it doesn't load it, and starts sooner.

ObjC.import("Foundation");
ObjC.import("CoreGraphics");
ObjC.import("ApplicationServices");
ObjC.import("unistd");

const WAIT_SECONDS = 10;
const POLL_MICROSECONDS = 30000;
const ATTEMPTS = 5;

function run(argv) {
  $.setsid();
  const [bundlePath, x, y] = [argv[0], Number(argv[1]), Number(argv[2])];
  if (!bundlePath || !isFinite(x) || !isFinite(y)) throw new Error("Give the bundle's path and the window's top left");
  ObjC.bindFunction("AXIsProcessTrusted", ["bool", []]);
  if (!$.AXIsProcessTrusted()) return;

  const deadline = Date.now() + WAIT_SECONDS * 1000;
  let pid = null;
  let bounds = null;
  while (Date.now() < deadline) {
    if (pid === null) pid = alfredUiProcess(bundlePath);
    if (pid !== null) bounds = windowBounds(pid);
    if (bounds) break;
    $.usleep(POLL_MICROSECONDS);
  }
  for (let attempt = 0; bounds && attempt < ATTEMPTS; attempt++) {
    if (Math.abs(bounds.X - x) < 1 && Math.abs(bounds.Y - y) < 1) return;
    if (!moveWindow(pid, x, y)) return;
    $.usleep(100000);
    bounds = windowBounds(pid);
  }
}

// The process ID of the Alfred UI helper launched with the bundle at
// `bundlePath`, or null if there's none: Alfred launches one per window,
// with the bundle's path as its argument.
function alfredUiProcess(bundlePath) {
  const task = $.NSTask.alloc.init;
  task.launchPath = "/bin/ps";
  task.arguments = $(["-axww", "-o", "pid=,args="]);
  const pipe = $.NSPipe.pipe;
  task.standardOutput = pipe;
  task.standardError = $.NSFileHandle.fileHandleWithNullDevice;
  task.launch;
  const data = pipe.fileHandleForReading.readDataToEndOfFile;
  task.waitUntilExit;
  const lines = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js.split("\n");
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    if (match && match[2].includes("/Alfred UI.app/Contents/MacOS/Alfred UI ") && match[2].includes(bundlePath)) {
      return Number(match[1]);
    }
  }
  return null;
}

// The bounds of the window of the process `pid` that's on screen ({ X, Y,
// Width, Height }, from the top left of the primary screen), or null if it
// has none. CoreGraphics gives them without any permission.
function windowBounds(pid) {
  const onScreenOnly = 1;
  const windows = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(onScreenOnly, 0))) || [];
  const window = windows.find((w) => w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0 && w.kCGWindowBounds);
  return window ? window.kCGWindowBounds : null;
}

// Moves the first window of the process `pid` so its top left is at `x`,
// `y`, through the Accessibility API. Returns whether it could.
function moveWindow(pid, x, y) {
  ObjC.bindFunction("AXUIElementCreateApplication", ["id", ["int"]]);
  ObjC.bindFunction("AXUIElementCopyAttributeValue", ["int", ["id", "id", "id *"]]);
  ObjC.bindFunction("AXUIElementSetAttributeValue", ["int", ["id", "id", "id"]]);
  ObjC.bindFunction("AXValueCreate", ["id", ["int", "void *"]]);
  const windows = Ref();
  if ($.AXUIElementCopyAttributeValue($.AXUIElementCreateApplication(pid), $("AXWindows"), windows) !== 0) return false;
  if (!windows[0] || windows[0].count === 0) return false;
  // AXValueCreate reads the point from a pointer, which JXA can't make from a
  // struct; an NSValue copies the point's bytes into a buffer instead.
  const point = $.NSMutableData.dataWithLength(16);
  $.NSValue.valueWithPoint($.NSMakePoint(x, y)).getValueSize(point.mutableBytes, 16);
  const cgPointType = 1;
  const position = $.AXValueCreate(cgPointType, point.mutableBytes);
  return $.AXUIElementSetAttributeValue(windows[0].objectAtIndex(0), $("AXPosition"), position) === 0;
}
