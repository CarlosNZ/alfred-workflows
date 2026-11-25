#!/usr/bin/osascript -l JavaScript

// Makes the images that ship with the workflow, from Lucide's sources in
// dev/lucide/, the note icons (noteIcons in scripts/lib.js), the window's
// other icons (NOTE_WINDOW_BUTTON_ICONS, through noteButtonIconNames) and the
// drop-downs' sizes (NOTE_WINDOW_LAYOUT). Run after changing any of them:
//
//   dev/make-icons.js
//
//   icons/lucide/<icon>-<appearance>.svg
//                                            a button icon: the icon alone in
//                                            the colour of the window's
//                                            buttons (secondaryLabelColor) in
//                                            light or dark appearance, for
//                                            every note icon and the window's
//                                            other icons
//   icons/lucide/LICENSE                     Lucide's licence, which covers
//                                            the button icons and the badges
//                                            made from them
//   icons/shadow-<picker>-picker.png         each drop-down's shadow (the
//                                            icon and colour pickers), at
//                                            twice its size in points, as
//                                            Alfred UI has no shadow
//
// Button icons of icons no longer in the set are removed. Badges and dots,
// which depend on the palette, aren't shipped: the workflow makes them when
// they're needed (see noteBadgeFile and noteDotFile in lib.js). To review
// their look, this writes every badge (each note icon in each palette colour)
// and every dot into a folder, with lib.js's own code, and with --png a PNG
// of each badge too:
//
//   dev/make-icons.js --review <folder> [--png]

ObjC.import("AppKit");

// secondaryLabelColor, the buttons' colour, in each appearance (macOS 27).
const BUTTON_ICON_COLOURS = { light: { colour: "#000000", opacity: 0.498 }, dark: { colour: "#FFFFFF", opacity: 0.549 } };
const REVIEW_BADGE_PIXELS = 128;

function run(argv) {
  const workflowFolder = $(loadLib(argv, "../scripts/lib.js")).stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.js;
  loadLib(argv, "../scripts/titles.js");
  const review = argv.indexOf("--review");
  if (review >= 0) {
    if (!argv[review + 1]) throw new Error("Usage: dev/make-icons.js --review <folder> [--png]");
    return reviewResultIcons(workflowFolder, argv[review + 1], argv.includes("--png"));
  }

  const written = [];
  for (const name of noteButtonIconNames()) {
    const elements = lucideElements(`${workflowFolder}/dev/lucide/${name}.svg`);
    for (const appearance of Object.keys(BUTTON_ICON_COLOURS)) {
      const path = noteButtonIconFile(name, appearance);
      ensureFolder($(`${workflowFolder}/${path}`).stringByDeletingLastPathComponent.js, true);
      writeFileAtomically(`${workflowFolder}/${path}`, buttonIconSvg(name, elements, BUTTON_ICON_COLOURS[appearance]));
      written.push(path);
    }
  }
  for (const name of noteDropdownNames()) {
    writeDataAtomically(`${workflowFolder}/${noteDropdownShadowFile(name)}`, pngData(drawPickerShadow(noteDropdownGeometry(name))));
    written.push(noteDropdownShadowFile(name));
  }

  const licence = readText(`${workflowFolder}/dev/lucide/LICENSE`);
  if (licence === null) throw new Error("Can't read dev/lucide/LICENSE");
  writeFileAtomically(`${workflowFolder}/icons/lucide/LICENSE`, licence);
  written.push("icons/lucide/LICENSE");

  const removed = removeOthers(workflowFolder, "icons/lucide", new Set(written));
  return [`${written.length} files written`].concat(removed.map((path) => `removed ${path}`)).join("\n");
}

// Writes every badge and dot into `folder`, named for the icon and colour,
// with lib.js's code (from the button icons, so run this after making them).
function reviewResultIcons(workflowFolder, folder, png) {
  ensureFolder(folder, true);
  let count = 0;
  for (const colour of notePalette()) {
    writeDataAtomically(`${folder}/dot-${colour.name}.png`, noteDotPng(colour));
    count++;
    for (const icon of noteIcons()) {
      const svg = noteBadgeSvg(workflowFolder, icon.name, colour);
      writeFileAtomically(`${folder}/badge-${icon.name}-${colour.name}.svg`, svg);
      count++;
      if (png) {
        writeDataAtomically(`${folder}/badge-${icon.name}-${colour.name}.png`, pngData(drawSvg(svg, REVIEW_BADGE_PIXELS)));
        count++;
      }
    }
  }
  return `${count} files written to ${folder}`;
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

// A button icon's SVG: Lucide's elements in a group with the buttons' colour.
// The opacity is on the group, so the icon is drawn as one layer, as a symbol
// in a translucent colour is: where two strokes overlap, it's no darker.
// lib.js makes badges from the elements in this group (noteButtonIconElements).
function buttonIconSvg(name, elements, { colour, opacity }) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">`,
    `<!-- Lucide's ${name} (see LICENSE) -->`,
    `<g opacity="${opacity}" ${noteLucideStroke()} stroke="${colour}">${elements}</g>`,
    `</svg>`,
    "",
  ].join("\n");
}

// Removes the files in `folder` (a path in the workflow folder) that aren't in
// `keep` (paths in the workflow folder), and returns their paths.
function removeOthers(workflowFolder, folder, keep) {
  const removed = [];
  const names = ObjC.deepUnwrap($.NSFileManager.defaultManager.contentsOfDirectoryAtPathError(`${workflowFolder}/${folder}`, null)) || [];
  for (const name of names) {
    const path = `${folder}/${name}`;
    if (keep.has(path) || !/\.(svg|png)$/.test(name)) continue;
    removeFile(`${workflowFolder}/${path}`);
    removed.push(path);
  }
  return removed;
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
