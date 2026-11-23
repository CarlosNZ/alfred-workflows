#!/usr/bin/osascript -l JavaScript

// Draws the Clock app's sunrise and sunset symbols for the detail view's sun
// times, saved as icons/symbol-sunrise.png and icons/symbol-sunset.png: the SF
// Symbols sunrise.fill and sunset.fill, with the arrow and horizon in
// SUN_ARROW_COLOUR and the sun in SUN_SYMBOL_COLOUR (both in lib/panel.js).
// Alfred UI can only tint a symbol one colour, so the two-colour version is
// drawn here, with AppKit's palette rendering, and shown as a file.
//
// Each is drawn at the times' font size (FONTS.sunTimes), which is how big a
// symbol is inline in text, at 3× for Retina, on a canvas of the symbol's own
// size, so it lines up in the view as the symbol itself would. That size must
// be SUN_SYMBOL_SIZE, the image views' size, or it stops with an error.
//
// Run from the workflow folder:  resources/make-sun-symbols.js

ObjC.import("Foundation");
ObjC.import("AppKit");

const SCALE = 3;
const SYMBOLS = { sunrise: "sunrise.fill", sunset: "sunset.fill" };

function run() {
  const source = $.NSString.stringWithContentsOfFileEncodingError("lib/panel.js", $.NSUTF8StringEncoding, null);
  if (source.isNil()) throw new Error("Can't load lib/panel.js (run from the workflow folder)");
  // The file's last value is the constants', since a const isn't visible outside eval.
  const look = (0, eval)(
    `${source.js}\n({ size: SUN_SYMBOL_SIZE, pointSize: FONTS.sunTimes.size, arrow: SUN_ARROW_COLOUR, sun: SUN_SYMBOL_COLOUR })`,
  );

  $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError("icons", true, $(), null);
  const written = Object.entries(SYMBOLS).map(([name, symbol]) => {
    const path = `icons/symbol-${name}.png`;
    drawSymbol(symbol, look, path);
    return path;
  });
  return `Wrote ${written.join(", ")}`;
}

// Draws a symbol in the look's two colours to a PNG at `path`. In palette
// rendering, the first colour is for the symbol's primary layer (the arrow and
// horizon) and the second for its secondary layer (the sun).
function drawSymbol(symbol, look, path) {
  const base = $.NSImage.imageWithSystemSymbolNameAccessibilityDescription(symbol, $());
  if (base.isNil()) throw new Error(`No SF Symbol ${symbol}`);
  const config = $.NSImageSymbolConfiguration.configurationWithPointSizeWeight(look.pointSize, $.NSFontWeightRegular)
    .configurationByApplyingConfiguration($.NSImageSymbolConfiguration.configurationWithPaletteColors($([colour(look.arrow), colour(look.sun)])));
  const image = base.imageWithSymbolConfiguration(config);
  const size = image.size;
  if (size.width !== look.size.width || size.height !== look.size.height) {
    throw new Error(
      `${symbol} at ${look.pointSize}pt is ${size.width}×${size.height}, not SUN_SYMBOL_SIZE (${look.size.width}×${look.size.height}): update SUN_SYMBOL_SIZE`,
    );
  }

  const bitmap = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    null,
    size.width * SCALE,
    size.height * SCALE,
    8,
    4,
    true,
    false,
    $.NSDeviceRGBColorSpace,
    0,
    0,
  );
  bitmap.size = size;
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(bitmap));
  image.drawInRect($.NSMakeRect(0, 0, size.width, size.height));
  $.NSGraphicsContext.restoreGraphicsState;
  const png = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
  if (!png.writeToFileAtomically(path, true)) throw new Error(`Can't write ${path}`);
}

// An NSColor from a panel colour in hex RGB or RGBA ("#F5C451", "#FFFFFFA6").
function colour(hex) {
  const parts = hex.replace("#", "").match(/../g).map((part) => parseInt(part, 16) / 255);
  return $.NSColor.colorWithDeviceRedGreenBlueAlpha(parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1);
}
