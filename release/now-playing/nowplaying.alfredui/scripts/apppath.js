// Prints the path of the app with the given bundle identifier, or nothing
// if no such app is installed.
// Usage: osascript -l JavaScript apppath.js <bundle id>
ObjC.import('AppKit');

function run(argv) {
  const url = $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier(argv[0] || '');
  return url.isNil() ? '' : url.path.js;
}
