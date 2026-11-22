#!/usr/bin/osascript -l JavaScript

// Draws a placeholder icon for each working status: a rounded square in a
// plain colour with the status's word on it, saved as
// icons/status-<status>.png. The phases of the day have designed icons, from
// make-phase-icons.js.
//
// Run from the workflow folder:  resources/make-placeholder-icons.js
//
// TO-DO: replace with designed icons.

ObjC.import("Foundation");
ObjC.import("AppKit");

const SIZE = 256;
const MARGIN = 16;

// The working statuses (workingStatus in lib/time.js), with their words as in
// WORKING_STATUS_WORDS in lib/format.js, and colours as a traffic light, with
// grey for the weekend.
const WORKING_STATUSES = [
  { status: "morning", word: "Early morning", colours: ["#F2B63D", "#1B2240"] },
  { status: "working", word: "Working", colours: ["#3DAA5C", "#FFFFFF"] },
  { status: "evening", word: "Evening", colours: ["#F2B63D", "#1B2240"] },
  { status: "asleep", word: "Asleep", colours: ["#D9453D", "#FFFFFF"] },
  { status: "weekend", word: "Weekend", colours: ["#9AA0A6", "#FFFFFF"] },
];

function run() {
  $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
    "icons",
    true,
    $(),
    null,
  );
  const written = WORKING_STATUSES.map(({ status, word, colours }) => {
    const path = `icons/status-${status}.png`;
    drawIcon(path, word, colours);
    return path;
  });
  return `Wrote ${written.join(", ")}`;
}

function colour(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return $.NSColor.colorWithSRGBRedGreenBlueAlpha(r, g, b, 1);
}

// Draws a rounded square in `background` with `word` centred on it, as large
// as fits the width, and writes it to `path` as a PNG.
function drawIcon(path, word, [background, foreground]) {
  const bitmap = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    null,
    SIZE,
    SIZE,
    8,
    4,
    true,
    false,
    $.NSDeviceRGBColorSpace,
    0,
    0,
  );
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(bitmap));

  colour(background).setFill;
  $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius($.NSMakeRect(4, 4, SIZE - 8, SIZE - 8), 48, 48).fill;

  const text = $(word);
  let fontSize = 72;
  let attributes;
  for (;;) {
    // Keys are the values of NSFontAttributeName and
    // NSForegroundColorAttributeName, which JXA doesn't expose.
    attributes = $.NSMutableDictionary.dictionary;
    attributes.setObjectForKey($.NSFont.boldSystemFontOfSize(fontSize), "NSFont");
    attributes.setObjectForKey(colour(foreground), "NSColor");
    if (text.sizeWithAttributes(attributes).width <= SIZE - 2 * MARGIN || fontSize <= 12) break;
    fontSize -= 2;
  }
  const size = text.sizeWithAttributes(attributes);
  text.drawAtPointWithAttributes($.NSMakePoint((SIZE - size.width) / 2, (SIZE - size.height) / 2), attributes);

  $.NSGraphicsContext.restoreGraphicsState;
  const png = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
  if (!png.writeToFileAtomically(path, true)) throw new Error(`Can't write ${path}`);
}
