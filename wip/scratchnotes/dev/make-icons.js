#!/usr/bin/osascript -l JavaScript

// Makes the workflow's icons from the palette (notePalette in scripts/lib.js),
// the note icons (noteIcons) and the window's other icons
// (NOTE_WINDOW_GLYPHS, through noteGlyphNames), from Lucide's SVGs in
// dev/lucide/. Run after
// changing any of them: dev/make-icons.js [--png]
//
//   icons/<colour>.png                       a note's result without an icon:
//                                            a dot filled with the colour's
//                                            spine colour and ringed in its
//                                            control colour, so pale colours
//                                            such as yellow and grey still
//                                            show on light and dark themes
//   icons/lucide/badge/<icon>-<colour>.svg   a note's result with an icon,
//                                            and its pinned window's app icon:
//                                            the icon in dark text colour on a
//                                            rounded square of the tint, ringed
//                                            in the control colour
//   icons/lucide/glyph/<icon>-<appearance>.svg
//                                            the icon alone in the colour of
//                                            the window's buttons
//                                            (secondaryLabelColor) in light or
//                                            dark appearance, for the window:
//                                            every note icon, and the
//                                            window's other icons
//   icons/lucide/LICENSE                     Lucide's licence, which covers
//                                            the badges and glyphs
//   icons/shadow-<picker>-picker.png         each drop-down's shadow (the
//                                            icon and colour pickers), at
//                                            twice its size in points, as
//                                            Alfred UI has no shadow (see
//                                            NOTE_WINDOW_LAYOUT in lib.js)
//
// The badges and glyphs are SVG text: Lucide's elements, with its
// currentColor given a colour. With --png, each is also drawn into a PNG
// beside it, from the same SVG, for shipping (see NOTE_ICON_FORMAT in
// lib.js). Badges and glyphs of icons or colours no longer in the set are
// removed.

ObjC.import("AppKit");

const DOT_SIZE = 256; // pixels
const DOT_DIAMETER = 168; // the dot, within the square
const DOT_RING = 12; // the ring's width

const BADGE_TEXT = "#1D1D1F";
// secondaryLabelColor, the buttons' colour, in each appearance (macOS 27).
const GLYPH_COLOURS = { light: { colour: "#000000", opacity: 0.498 }, dark: { colour: "#FFFFFF", opacity: 0.549 } };
const BADGE_PIXELS = 128;
const GLYPH_PIXELS = 64;

function run(argv) {
  const workflowFolder = $(loadLib(argv, "../scripts/lib.js")).stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.js;
  const png = argv.includes("--png");
  const written = [];
  const write = (path, text) => {
    ensureFolder($(`${workflowFolder}/${path}`).stringByDeletingLastPathComponent.js, true);
    writeFileAtomically(`${workflowFolder}/${path}`, text);
    written.push(path);
    if (png) {
      const pngPath = path.replace(/\.svg$/, ".png");
      writePng(drawSvg(text, path.includes("/badge/") ? BADGE_PIXELS : GLYPH_PIXELS), `${workflowFolder}/${pngPath}`);
      written.push(pngPath);
    }
  };

  for (const colour of notePalette()) {
    const path = `icons/${colour.name}.png`;
    writePng(drawDot(colour), `${workflowFolder}/${path}`);
    written.push(path);
  }
  for (const icon of noteIcons()) {
    const elements = lucideElements(`${workflowFolder}/dev/lucide/${icon.name}.svg`);
    for (const colour of notePalette()) write(svgFile(noteBadgeFile(icon.name, colour.name)), badgeSvg(icon, elements, colour));
  }
  for (const name of noteGlyphNames()) {
    const elements = lucideElements(`${workflowFolder}/dev/lucide/${name}.svg`);
    for (const appearance of Object.keys(GLYPH_COLOURS)) write(svgFile(noteGlyphFile(name, appearance)), glyphSvg({ name }, elements, GLYPH_COLOURS[appearance]));
  }
  for (const name of noteDropdownNames()) {
    writePng(drawPickerShadow(noteDropdownGeometry(name)), `${workflowFolder}/${noteDropdownShadowFile(name)}`);
    written.push(noteDropdownShadowFile(name));
  }

  const licence = readText(`${workflowFolder}/dev/lucide/LICENSE`);
  if (licence === null) throw new Error("Can't read dev/lucide/LICENSE");
  writeFileAtomically(`${workflowFolder}/icons/lucide/LICENSE`, licence);
  written.push("icons/lucide/LICENSE");

  const removed = removeOthers(workflowFolder, ["icons/lucide/badge", "icons/lucide/glyph"], new Set(written));
  return [`${written.length} files written`].concat(removed.map((path) => `removed ${path}`)).join("\n");
}

// A badge or glyph's path as an SVG, whatever NOTE_ICON_FORMAT is.
function svgFile(path) {
  return path.replace(/\.[a-z]+$/, ".svg");
}

// The elements inside a Lucide SVG's <svg> element, which draw with the root's
// stroke="currentColor" and fill="none".
function lucideElements(path) {
  const svg = readText(path);
  if (svg === null) throw new Error(`Can't read ${path}`);
  const match = /<svg\b[^>]*>([\s\S]*)<\/svg>/.exec(svg);
  if (!match || !/stroke="currentColor"/.test(svg) || /currentColor/.test(match[1])) throw new Error(`${path} isn't a Lucide icon drawn with its root's currentColor`);
  return match[1].trim().split(/\s*\n\s*/).join("");
}

const LUCIDE_STROKE = 'fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

function badgeSvg(icon, elements, colour) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">`,
    `<!-- Lucide's ${icon.name} (see LICENSE), on ScratchNotes' ${colour.name} -->`,
    `<rect x="6" y="6" width="116" height="116" rx="26" fill="${colour.tint}" stroke="${colour.control}" stroke-width="4"/>`,
    `<svg x="30" y="30" width="68" height="68" viewBox="0 0 24 24" ${LUCIDE_STROKE} stroke="${BADGE_TEXT}">${elements}</svg>`,
    `</svg>`,
    "",
  ].join("\n");
}

// The opacity is on a group, so the icon is drawn as one layer, as a symbol in
// a translucent colour is: where two strokes overlap, it's no darker.
function glyphSvg(icon, elements, { colour, opacity }) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">`,
    `<!-- Lucide's ${icon.name} (see LICENSE) -->`,
    `<g opacity="${opacity}" ${LUCIDE_STROKE} stroke="${colour}">${elements}</g>`,
    `</svg>`,
    "",
  ].join("\n");
}

// Removes the files in `folders` that aren't in `keep` (paths in the workflow
// folder), and returns their paths.
function removeOthers(workflowFolder, folders, keep) {
  const removed = [];
  for (const folder of folders) {
    const names = ObjC.deepUnwrap($.NSFileManager.defaultManager.contentsOfDirectoryAtPathError(`${workflowFolder}/${folder}`, null)) || [];
    for (const name of names) {
      const path = `${folder}/${name}`;
      if (keep.has(path) || !/\.(svg|png)$/.test(name)) continue;
      removeFile(`${workflowFolder}/${path}`);
      removed.push(path);
    }
  }
  return removed;
}

function drawDot(colour) {
  return drawInBitmap(DOT_SIZE, () => {
    const inset = (DOT_SIZE - DOT_DIAMETER) / 2 + DOT_RING / 2;
    const dot = $.NSBezierPath.bezierPathWithOvalInRect($.NSMakeRect(inset, inset, DOT_SIZE - 2 * inset, DOT_SIZE - 2 * inset));
    hexColour(colour.spine).setFill;
    dot.fill;
    hexColour(colour.control).setStroke;
    dot.lineWidth = DOT_RING;
    dot.stroke;
  });
}

// A drop-down's shadow: its box's rounded rectangle, drawn in black with
// a shadow, then cleared, so only the shadow is left around where the box
// goes. At 2x, for Retina screens; Alfred UI shows it at its size in points.
function drawPickerShadow({ box, outer, margin, radius, shadow }) {
  const scale = 2;
  return drawInBitmap([outer.width * scale, outer.height * scale], () => {
    // AppKit's origin is the bottom left, and the box is `margin` from the top.
    const rect = $.NSMakeRect(margin * scale, (outer.height - margin - box.height) * scale, box.width * scale, box.height * scale);
    const path = $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius(rect, radius * scale, radius * scale);
    const nsShadow = $.NSShadow.alloc.init;
    nsShadow.shadowColor = $.NSColor.colorWithSRGBRedGreenBlueAlpha(0, 0, 0, shadow.opacity);
    nsShadow.shadowBlurRadius = shadow.blur * scale;
    nsShadow.shadowOffset = $.NSMakeSize(0, -shadow.offset * scale);
    $.NSGraphicsContext.saveGraphicsState;
    nsShadow.set;
    $.NSColor.blackColor.setFill;
    path.fill;
    $.NSGraphicsContext.restoreGraphicsState;
    $.NSGraphicsContext.currentContext.compositingOperation = $.NSCompositingOperationClear;
    path.fill;
  });
}

// An SVG drawn into a square bitmap `pixels` wide, with NSImage.
function drawSvg(svg, pixels) {
  const image = $.NSImage.alloc.initWithData($(svg).dataUsingEncoding($.NSUTF8StringEncoding));
  if (image.isNil()) throw new Error("NSImage can't read the SVG");
  return drawInBitmap(pixels, () => {
    image.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, pixels, pixels), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1);
  });
}

// A bitmap `pixels` square, or [width, height], with `draw` drawn into it.
function drawInBitmap(pixels, draw) {
  const [width, height] = Array.isArray(pixels) ? pixels : [pixels, pixels];
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    $(), width, height, 8, 4, true, false, $.NSCalibratedRGBColorSpace, 0, 0,
  );
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep));
  draw();
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
