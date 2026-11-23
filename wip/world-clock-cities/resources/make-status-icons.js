#!/usr/bin/osascript -l JavaScript

// Draws the icon for each working status, saved as icons/status-<status>.png.
// Every icon is the same tile as the phases of the day (make-phase-icons.js),
// with its glossy sheen and thin light edge, but filled with a single colour
// rather than a scene: a traffic light for scanning which cities a time suits,
// with a white symbol for the status in the middle. Having no horizon keeps
// them from being read as phases. The colours and symbols are set for each
// status in LOOKS below; the statuses come from WORKING_STATUS_WORDS in
// lib/format.js.
//
// Each icon is built as SVG and drawn to a PNG by NSImage, which renders the
// gradients, clipping and blur the SVG uses.
//
// Run from the workflow folder:  resources/make-status-icons.js
// With a folder as its argument, it also writes each icon's SVG there, for
// looking at in a browser.

ObjC.import("Foundation");
ObjC.import("AppKit");

const SIZE = 256; // pixels; the detail view's tile is 88pt, 176px on Retina

// The tile, in a 100×100 viewBox, as for the phases.
const TILE = { inset: 1.5, radius: 22 };

// The symbols, in the same viewBox, centred on the tile. Each is white
// `shapes`, which cast a shadow, and `details` drawn over them, filled by
// default with the tile's own colour (url(#paint)) so they look cut out. A
// mask would cut them out, but CoreSVG draws a mask's curves jagged.
const SYMBOLS = {
  // A cup of coffee on a saucer, with steam.
  cup: {
    shapes: [
      `<path d="M27 44 H65 L62.5 66 Q61 76 51 76 H41 Q31 76 29.5 66 Z"/>`,
      `<circle cx="66" cy="55" r="7.5" fill="none" stroke="#ffffff" stroke-width="5"/>`,
      `<rect x="20" y="78" width="52" height="5" rx="2.5"/>`,
      `<path d="M39 38 q-4 -5 0 -10 t0 -10 M53 38 q-4 -5 0 -10 t0 -10" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>`,
    ],
  },
  // A briefcase, with a band and clasp across it.
  briefcase: {
    shapes: [
      `<rect x="40" y="25" width="20" height="16" rx="4.5" fill="none" stroke="#ffffff" stroke-width="5"/>`,
      `<rect x="21" y="36" width="58" height="42" rx="7"/>`,
    ],
    details: [
      `<rect x="21" y="51" width="58" height="3.5"/>`,
      `<rect x="41.5" y="45.5" width="17" height="14" rx="3.5"/>`,
      `<rect x="44.5" y="48.5" width="11" height="8" rx="2" fill="#ffffff"/>`,
    ],
  },
  // A table lamp.
  lamp: {
    shapes: [
      `<path d="M37 24 H63 L74 54 H26 Z" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/>`,
      `<rect x="47.5" y="52" width="5" height="22"/>`,
      `<rect x="33" y="72" width="34" height="7" rx="3.5"/>`,
    ],
  },
  // Someone asleep in bed, seen from the side: their head by the headboard
  // and their body under the covers, with Zs rising, as in 💤.
  bed: {
    shapes: [
      `<rect x="13" y="38" width="7" height="46" rx="3"/>`,
      `<rect x="13" y="69" width="75" height="8" rx="2.5"/>`,
      `<rect x="81" y="69" width="7" height="15" rx="3"/>`,
      `<circle cx="31" cy="57" r="8"/>`,
      `<path d="M43 66 V57 Q43 50 50 50 H84 Q88 50 88 54 V66 Z"/>`,
      `<path d="M39 36 h5 l-5 6 h5 M49 25 h7 l-7 8 h7 M61 13 h9 l-9 11 h9" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    ],
  },
  // A beach umbrella, tilted: a scalloped canopy with ribs, on a pole. Turned
  // about the middle of the tile, then moved so its bounds are centred.
  umbrella: {
    transform: "translate(48.6 49) scale(0.9) rotate(30) translate(-50 -50)",
    shapes: [
      `<path d="M50 30 V90" stroke="#ffffff" stroke-width="5.5" stroke-linecap="round"/>`,
      `<circle cx="50" cy="15" r="3"/>`,
      `<path d="M13 52 Q15 18 50 16 Q85 18 87 52 Q78.5 44 68.5 52 Q59.5 44 50 52 Q40.5 44 31.5 52 Q21.5 44 13 52 Z"/>`,
    ],
    details: [`<path d="M50 18 Q38 28 31.5 50 M50 18 Q62 28 68.5 50" fill="none" stroke="url(#paint)" stroke-width="2.5" stroke-linecap="round"/>`],
  },
};

// Each status's look: the tile's colour at the top and bottom, and its symbol.
// The colours are a traffic light: green during work, amber before it, orange
// after it and red while asleep, so amber, orange and red run through the day,
// clear of the phases' purples at sunset and dusk. The weekend is a royal blue,
// as strong as the working green, with a hue between the phases' sky blues and
// the violet of dawn and dusk.
const LOOKS = {
  morning: { colours: ["#ffc53d", "#e8890c"], symbol: "cup" },
  working: { colours: ["#4fcf6f", "#1f8f45"], symbol: "briefcase" },
  evening: { colours: ["#ff9a45", "#e2580f"], symbol: "lamp" },
  asleep: { colours: ["#f2625a", "#b8231f"], symbol: "bed" },
  weekend: { colours: ["#4f7acf", "#1f488e"], symbol: "umbrella" },
};

function run(argv) {
  const source = $.NSString.stringWithContentsOfFileEncodingError("lib/format.js", $.NSUTF8StringEncoding, null);
  if (source.isNil()) throw new Error("Can't load lib/format.js (run from the workflow folder)");
  // The file's last value is the list's, since a const isn't visible outside eval.
  const statuses = Object.keys((0, eval)(`${source.js}\nWORKING_STATUS_WORDS`));

  const missing = statuses.filter((status) => !LOOKS[status]);
  if (missing.length) throw new Error(`No look for ${missing.join(", ")}: add it to LOOKS`);

  const svgFolder = argv[0];
  const fileManager = $.NSFileManager.defaultManager;
  for (const folder of ["icons", svgFolder].filter(Boolean)) {
    fileManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(folder, true, $(), null);
  }

  const written = statuses.map((status) => {
    const svg = statusSvg(LOOKS[status]);
    if (svgFolder) writeText(`${svgFolder}/status-${status}.svg`, svg);
    const path = `icons/status-${status}.png`;
    drawSvg(svg, path);
    return path;
  });
  return `Wrote ${written.join(", ")}`;
}

// The SVG for a status's icon.
function statusSvg({ colours, symbol: name }) {
  const symbol = SYMBOLS[name];
  const { inset, radius } = TILE;
  const side = 100 - 2 * inset;
  const stop = (offset, colour, opacity = 1) =>
    `<stop offset="${offset}" stop-color="${colour}" stop-opacity="${opacity}"/>`;

  const defs = [
    `<clipPath id="tile"><rect x="${inset}" y="${inset}" width="${side}" height="${side}" rx="${radius}"/></clipPath>`,
    // In user space, so a detail filled with it matches the tile behind it.
    `<linearGradient id="paint" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">${stop(0, colours[0])}${stop(1, colours[1])}</linearGradient>`,
    // A glossy sheen over the top half, as on the phases and the workflow's icon.
    `<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">${stop(0, "#ffffff", 0.26)}${stop(0.5, "#ffffff", 0)}</linearGradient>`,
    // The symbol's shadow. CoreSVG ignores separate horizontal and vertical
    // blur amounts, so it's one for both.
    `<filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6"/></filter>`,
  ];

  // Each layer of the symbol, moved into place by its transform, if any.
  const place = (markup) => (symbol.transform ? `<g transform="${symbol.transform}">${markup}</g>` : markup);
  const shapes = place(symbol.shapes.join(""));
  const scene = [
    `<rect width="100" height="100" fill="url(#paint)"/>`,
    `<g transform="translate(0 2)" fill="${colours[1]}" opacity="0.55" filter="url(#shadow)">` +
      shapes.replace(/#ffffff/g, colours[1]) +
      `</g>`,
    `<g fill="#ffffff">${shapes}</g>`,
    `<g fill="url(#paint)">${place((symbol.details || []).join(""))}</g>`,
    `<rect width="100" height="100" fill="url(#sheen)"/>`,
  ];

  // A thin light edge, as on the phases.
  const edge = `<rect x="${inset + 0.6}" y="${inset + 0.6}" width="${side - 1.2}" height="${side - 1.2}" rx="${radius - 0.5}" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="1.2"/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${SIZE}" height="${SIZE}">` +
    `<defs>${defs.join("")}</defs>` +
    `<g clip-path="url(#tile)">${scene.join("")}</g>${edge}</svg>\n`
  );
}

function writeText(path, text) {
  if (!$(text).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null)) {
    throw new Error(`Can't write ${path}`);
  }
}

// Draws `svg` to a SIZE×SIZE PNG at `path`.
function drawSvg(svg, path) {
  const image = $.NSImage.alloc.initWithData($(svg).dataUsingEncoding($.NSUTF8StringEncoding));
  if (image.isNil()) throw new Error(`Can't read the SVG for ${path}`);
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
  image.drawInRect($.NSMakeRect(0, 0, SIZE, SIZE));
  $.NSGraphicsContext.restoreGraphicsState;
  const png = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
  if (!png.writeToFileAtomically(path, true)) throw new Error(`Can't write ${path}`);
}
