#!/usr/bin/osascript -l JavaScript

// Makes the images that ship with the workflow, from Lucide's sources in
// dev/lucide/ and the workflow's own icons in Lucide's style in dev/icons/,
// the note icons (noteIcons in scripts/lib.js), the window's
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
//                                            its button icons and the badges
//                                            made from them
//   icons/shadow-<picker>-picker.png         each drop-down's shadow (the
//                                            icon and colour pickers), at
//                                            twice its size in points, as
//                                            Alfred UI has no shadow
//
// Button icons of icons no longer in the set are removed. Badges and dots,
// which depend on the palette, aren't shipped: the workflow makes them when
// they're needed (see noteBadgeFile and noteDotFile in lib.js). To review
// their look, this writes every badge (each note icon in each colour of the
// default palette) and every dot into a folder, with lib.js's own code, and
// with --png a PNG of each badge too:
//
//   dev/make-icons.js --review <folder> [--png]

ObjC.import("AppKit");

const REVIEW_BADGE_PIXELS = 128;

function run(argv) {
  const workflowFolder = $(loadLib(argv, "../scripts/lib.js")).stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.js;
  loadLib(argv, "../scripts/text-rules.js");
  const review = argv.indexOf("--review");
  if (review >= 0) {
    if (!argv[review + 1]) throw new Error("Usage: dev/make-icons.js --review <folder> [--png]");
    return reviewResultIcons(workflowFolder, argv[review + 1], argv.includes("--png"));
  }

  const written = [];
  for (const name of noteButtonIconNames()) {
    const own = isOwnButtonIcon(workflowFolder, name);
    const elements = lucideElements(`${workflowFolder}/dev/${own ? "icons" : "lucide"}/${name}.svg`, own);
    for (const appearance of ["light", "dark"]) {
      const path = noteButtonIconFile(name, appearance);
      ensureFolder($(`${workflowFolder}/${path}`).stringByDeletingLastPathComponent.js, true);
      writeFileAtomically(`${workflowFolder}/${path}`, buttonIconSvg(name, own, elements, noteButtonColour(appearance)));
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

// Writes every badge and dot in the default palette into `folder`, named for
// the icon and the colour's slot, with lib.js's code (from the button icons,
// so run this after making them).
function reviewResultIcons(workflowFolder, folder, png) {
  ensureFolder(folder, true);
  let count = 0;
  for (const colour of noteDefaultPalette()) {
    const name = `${colour.slot}-${colour.label.toLowerCase()}`;
    writeDataAtomically(`${folder}/dot-${name}.png`, noteDotPng(colour));
    count++;
    for (const icon of noteIcons()) {
      const svg = noteBadgeSvg(workflowFolder, icon.name, colour);
      writeFileAtomically(`${folder}/badge-${icon.name}-${name}.svg`, svg);
      count++;
      if (png) {
        writeDataAtomically(`${folder}/badge-${icon.name}-${name}.png`, pngData(drawSvg(svg, REVIEW_BADGE_PIXELS)));
        count++;
      }
    }
  }
  return `${count} files written to ${folder}`;
}

// Whether the button icon named `name` is one of the workflow's own, drawn in
// Lucide's style, with its source in dev/icons/, rather than Lucide's, in
// dev/lucide/.
function isOwnButtonIcon(workflowFolder, name) {
  return $.NSFileManager.defaultManager.fileExistsAtPath(`${workflowFolder}/dev/icons/${name}.svg`);
}

// The elements inside a Lucide SVG's <svg> element, which draw with the root's
// stroke="currentColor" and fill="none". The workflow's own icons (`own`) may
// also fill an element with fill="currentColor", as the close icon's circle is.
function lucideElements(path, own) {
  const svg = readText(path);
  if (svg === null) throw new Error(`Can't read ${path}`);
  const match = /<svg\b[^>]*>([\s\S]*)<\/svg>/.exec(svg);
  const inner = match && (own ? match[1].replace(/fill="currentColor"/g, "") : match[1]);
  if (!match || !/stroke="currentColor"/.test(svg) || /currentColor/.test(inner)) throw new Error(`${path} isn't a Lucide icon drawn with its root's currentColor`);
  return match[1].trim().split(/\s*\n\s*/).join("");
}

// A button icon's SVG: its elements (Lucide's, or the workflow's own when
// `own`) in a group with the buttons' colour, which also fills the elements
// filled with currentColor.
// The opacity is on the group, so the icon is drawn as one layer, as a symbol
// in a translucent colour is: where two strokes overlap, it's no darker.
// lib.js makes badges from the elements in this group (noteButtonIconElements).
function buttonIconSvg(name, own, elements, { colour, opacity }) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">`,
    own ? `<!-- Scratch'n'Stick's ${name}, in Lucide's style -->` : `<!-- Lucide's ${name} (see LICENSE) -->`,
    `<g opacity="${opacity}" ${noteLucideStroke()} stroke="${colour}">${elements.replace(/fill="currentColor"/g, `fill="${colour}"`)}</g>`,
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
