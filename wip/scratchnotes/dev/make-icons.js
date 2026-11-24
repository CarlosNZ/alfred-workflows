#!/usr/bin/osascript -l JavaScript

// Draws the results list's icons, icons/<colour>.png, one per palette colour
// (notePalette in scripts/lib.js): a dot filled with the colour's spine colour
// and ringed in its control colour, so pale colours such as yellow and grey
// still show on light and dark Alfred themes. Run after changing the palette:
// dev/make-icons.js

ObjC.import("AppKit");

const SIZE = 256; // pixels
const DIAMETER = 168; // the dot, within the square
const RING = 12; // the ring's width

function run(argv) {
  const workflowFolder = $(loadLib(argv, "../scripts/lib.js")).stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.js;
  const folder = `${workflowFolder}/icons`;
  $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(folder, true, $(), null);
  const written = [];
  for (const colour of notePalette()) {
    const path = `${folder}/${colour.name}.png`;
    writePng(drawDot(colour), path);
    written.push(path);
  }
  return written.join("\n");
}

function drawDot(colour) {
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    $(), SIZE, SIZE, 8, 4, true, false, $.NSCalibratedRGBColorSpace, 0, 0,
  );
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep));
  const inset = (SIZE - DIAMETER) / 2 + RING / 2;
  const dot = $.NSBezierPath.bezierPathWithOvalInRect($.NSMakeRect(inset, inset, SIZE - 2 * inset, SIZE - 2 * inset));
  hexColour(colour.spine).setFill;
  dot.fill;
  hexColour(colour.control).setStroke;
  dot.lineWidth = RING;
  dot.stroke;
  $.NSGraphicsContext.restoreGraphicsState;
  return rep;
}

function hexColour(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return $.NSColor.colorWithSRGBRedGreenBlueAlpha(r, g, b, 1);
}

function writePng(rep, path) {
  const data = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
  if (!data.writeToFileAtomically(path, true)) throw new Error(`Can't write ${path}`);
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
