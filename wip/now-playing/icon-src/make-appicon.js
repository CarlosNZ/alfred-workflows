#!/usr/bin/osascript -l JavaScript
// Builds nowplaying.alfredui/appicon.png, the panel's app icon (see README, "App icon and name").
//
// icon.png is a tile that fills its canvas, with its own corner rounding. macOS app
// icons sit on the icon grid instead: an 824px tile on a 1024px canvas, cut to a
// squircle (continuous corners), with a soft drop shadow in the transparent margin.
// This finds the tile's edges in icon.png, scales the tile to cover the squircle
// with a little overscan (so icon.png's own corners and edge shading are cut away),
// masks it to the squircle and adds the shadow. The canvas is sized so the tile
// keeps icon.png's resolution.

ObjC.import('AppKit');

const TILE = 824 / 1024; // tile's side as a fraction of the canvas
const EXPONENT = 5;      // superellipse exponent, close to Apple's continuous-corner squircle
const OVERSCAN = 1.03;   // how far the artwork extends past the squircle's edge
const OPAQUE = 0.5;      // alpha at which a pixel counts as part of the tile
// Drop shadow, as fractions of the canvas, and its opacity.
const SHADOW_Y = 12 / 1024, SHADOW_BLUR = 12 / 1024, SHADOW_ALPHA = 0.28;

function squircle(cx, cy, a, dx = 0) {
  const path = $.NSBezierPath.bezierPath;
  for (let i = 0; i < 720; i++) {
    const t = 2 * Math.PI * i / 720, c = Math.cos(t), s = Math.sin(t);
    const p = $.NSMakePoint(cx + dx + a * Math.sign(c) * Math.abs(c) ** (2 / EXPONENT),
                            cy + a * Math.sign(s) * Math.abs(s) ** (2 / EXPONENT));
    if (i === 0) path.moveToPoint(p); else path.lineToPoint(p);
  }
  path.closePath;
  return path;
}

function run() {
  const arg = ObjC.unwrap($.NSProcessInfo.processInfo.arguments).map(ObjC.unwrap)
    .find(a => a.endsWith('make-appicon.js'));
  const script = arg.startsWith('/') ? $(arg)
    : $.NSFileManager.defaultManager.currentDirectoryPath.stringByAppendingPathComponent(arg);
  const wf = script.stringByStandardizingPath.stringByDeletingLastPathComponent
    .stringByDeletingLastPathComponent.js;
  const src = `${wf}/icon.png`;
  const out = `${wf}/nowplaying.alfredui/appicon.png`;

  const rep = $.NSBitmapImageRep.imageRepWithContentsOfFile(src);
  if (!rep.js) throw new Error(`Can't read ${src}`);
  const w = rep.pixelsWide, h = rep.pixelsHigh;
  const opaque = (x, y) => rep.colorAtXY(x, y).alphaComponent >= OPAQUE;

  // The tile is a rounded rectangle, so its centre row and column span its full width and height.
  const scan = (from, to, at) => {
    const step = from < to ? 1 : -1;
    for (let i = from; i !== to; i += step) if (at(i)) return i;
    throw new Error('No opaque tile found in icon.png');
  };
  const left = scan(0, w, x => opaque(x, h >> 1));
  const right = scan(w - 1, -1, x => opaque(x, h >> 1));
  const top = scan(0, h, y => opaque(w >> 1, y));
  const bottom = scan(h - 1, -1, y => opaque(w >> 1, y));
  const sw = right - left + 1, sh = bottom - top + 1;

  // The squircle is square, so the artwork covers it: its shorter side spans the tile.
  const size = Math.round(Math.min(sw, sh) / TILE);
  const tile = size * TILE, c = size / 2;
  const k = tile * OVERSCAN / Math.min(sw, sh);
  const dw = sw * k, dh = sh * k;

  const canvas = $.NSBitmapImageRep.alloc
    .initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
      null, size, size, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
  const img = $.NSImage.alloc.initWithSize($.NSMakeSize(w, h));
  img.addRepresentation(rep);
  rep.size = $.NSMakeSize(w, h); // draw in pixels, whatever DPI the PNG declares

  $.NSGraphicsContext.saveGraphicsState;
  const ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(canvas);
  ctx.imageInterpolation = $.NSImageInterpolationHigh;
  $.NSGraphicsContext.setCurrentContext(ctx);

  // Shadow only: fill a copy of the squircle off the canvas and offset its shadow back onto it.
  $.NSGraphicsContext.saveGraphicsState;
  const shadow = $.NSShadow.alloc.init;
  shadow.shadowOffset = $.NSMakeSize(-2 * size, -SHADOW_Y * size);
  shadow.shadowBlurRadius = SHADOW_BLUR * size;
  shadow.shadowColor = $.NSColor.colorWithCalibratedWhiteAlpha(0, SHADOW_ALPHA);
  shadow.set;
  $.NSColor.blackColor.setFill;
  squircle(c, c, tile / 2, 2 * size).fill;
  $.NSGraphicsContext.restoreGraphicsState;

  squircle(c, c, tile / 2).addClip;
  // AppKit's origin is bottom-left; top and bottom were measured from the top.
  img.drawInRectFromRectOperationFraction(
    $.NSMakeRect(c - dw / 2, c - dh / 2, dw, dh),
    $.NSMakeRect(left, h - 1 - bottom, sw, sh),
    $.NSCompositingOperationSourceOver, 1);
  $.NSGraphicsContext.restoreGraphicsState;

  const png = canvas.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
  if (!png.writeToFileAtomically(out, true)) throw new Error(`Can't write ${out}`);
  return `Wrote ${out} (${size}px, tile ${Math.round(tile)}px from ${sw}×${sh})`;
}
