#!/usr/bin/osascript -l JavaScript

// Draws the icon for each phase of the day, saved as icons/phase-<phase>.png.
// Every icon is the same scene: a rounded tile of sky over a sea, with the
// horizon at a fixed height and the sun along an arc, on the left while rising
// and on the right while setting, half sunk at sunrise and sunset, and below
// the horizon at dawn and dusk, where only its glow shows. Night has a crescent
// moon and stars instead. Only the colours and the sun's place change, set for
// each phase in LOOKS below; the phases come from DAY_PHASES in lib/sun.js.
//
// Each icon is built as SVG and drawn to a PNG by NSImage, which renders the
// gradients, clipping, masks and blur the SVG uses.
//
// Run from the workflow folder:  resources/make-phase-icons.js
// With a folder as its argument, it also writes each icon's SVG there, for
// looking at in a browser.

ObjC.import("Foundation");
ObjC.import("AppKit");

const SIZE = 256; // pixels; the detail view's tile is 88pt, 176px on Retina

// The scene, in a 100×100 viewBox.
const TILE = { inset: 1.5, radius: 22 };
const HORIZON = 64;
const SUN_HIGH = 28; // the sun's height in the morning and afternoon, and the moon's
const STARS = {
  night: [
    [20, 18, 1.3],
    [38, 36, 0.9],
    [84, 46, 1],
    [14, 46, 0.8],
    [48, 14, 0.9],
    [86, 16, 1.1],
  ],
  dusk: [
    [22, 20, 1.1],
    [44, 12, 0.8],
  ],
};

// Each phase's look:
// - sky: the top, 60% down and the horizon; sea: the horizon and the bottom.
// - body: "sun", "moon" or "below" (the sun under the horizon, so only its
//   glow); x and y: where it is.
// - core (sun only): the disc's centre, middle and edge; radius: its size.
// - glow: the light around the body, its opacity and radius.
// - reflection: the streak on the water below the body, its colour, opacity
//   and half-width. Below the horizon it's a short, wide patch of the glow.
const LOOKS = {
  night: {
    sky: ["#070b24", "#121a44", "#1f2a5c"],
    sea: ["#141c45", "#05081a"],
    body: "moon",
    x: 66,
    y: SUN_HIGH,
    glow: { colour: "#9fb4ff", opacity: 0.35, radius: 26 },
    reflection: { colour: "#dfe6ff", opacity: 0.3, width: 4.5 },
  },
  dawn: {
    sky: ["#1a2560", "#5b4a9e", "#e9a0a6"],
    sea: ["#3a3b78", "#0e1236"],
    body: "below",
    x: 24,
    y: HORIZON,
    glow: { colour: "#ffc2b0", opacity: 0.85, radius: 38 },
    reflection: { colour: "#ffc6b8", opacity: 0.3, width: 14 },
  },
  sunrise: {
    sky: ["#3b5cb0", "#e79a96", "#ffd27a"],
    sea: ["#6a5a8a", "#1c2350"],
    body: "sun",
    x: 28,
    y: HORIZON,
    radius: 11,
    core: ["#fffbe8", "#ffd04a", "#ff8a2a"],
    glow: { colour: "#ffd88a", opacity: 0.95, radius: 44 },
    reflection: { colour: "#ffe0a0", opacity: 0.55, width: 9 },
  },
  morning: {
    sky: ["#2f86e6", "#6cb8f2", "#c6ecff"],
    sea: ["#3d8fd6", "#11477e"],
    body: "sun",
    x: 30,
    y: SUN_HIGH,
    radius: 8.5,
    core: ["#ffffff", "#fff4b8", "#ffd84a"],
    glow: { colour: "#ffffff", opacity: 0.8, radius: 34 },
    reflection: { colour: "#ffffff", opacity: 0.4, width: 6 },
  },
  afternoon: {
    sky: ["#1f62c8", "#5aa4ea", "#f3dfae"],
    sea: ["#2f74bd", "#0d3a6e"],
    body: "sun",
    x: 70,
    y: SUN_HIGH,
    radius: 8.5,
    core: ["#ffffff", "#ffe98a", "#ffbf3a"],
    glow: { colour: "#fff1c4", opacity: 0.8, radius: 34 },
    reflection: { colour: "#fff2c8", opacity: 0.4, width: 6 },
  },
  sunset: {
    sky: ["#3a2470", "#d4507c", "#ff9440"],
    sea: ["#7a3a6a", "#251238"],
    body: "sun",
    x: 72,
    y: HORIZON,
    radius: 11,
    core: ["#fff1d0", "#ffb03a", "#ff4a1f"],
    glow: { colour: "#ff9a50", opacity: 0.95, radius: 46 },
    reflection: { colour: "#ffb070", opacity: 0.55, width: 9 },
  },
  dusk: {
    sky: ["#0f1648", "#3e2a78", "#b8568a"],
    sea: ["#2c2460", "#0a0c2c"],
    body: "below",
    x: 76,
    y: HORIZON,
    glow: { colour: "#ff8fa0", opacity: 0.7, radius: 36 },
    reflection: { colour: "#ff9fb0", opacity: 0.25, width: 14 },
  },
};

function run(argv) {
  const source = $.NSString.stringWithContentsOfFileEncodingError("lib/sun.js", $.NSUTF8StringEncoding, null);
  if (source.isNil()) throw new Error("Can't load lib/sun.js (run from the workflow folder)");
  (0, eval)(source.js);

  const phases = dayPhases().map(({ phase }) => phase);
  const missing = phases.filter((phase) => !LOOKS[phase]);
  if (missing.length) throw new Error(`No look for ${missing.join(", ")}: add it to LOOKS`);

  const svgFolder = argv[0];
  const fileManager = $.NSFileManager.defaultManager;
  for (const folder of ["icons", svgFolder].filter(Boolean)) {
    fileManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(folder, true, $(), null);
  }

  const written = phases.map((phase) => {
    const svg = phaseSvg(phase, LOOKS[phase]);
    if (svgFolder) writeText(`${svgFolder}/phase-${phase}.svg`, svg);
    const path = `icons/phase-${phase}.png`;
    drawSvg(svg, path);
    return path;
  });
  return `Wrote ${written.join(", ")}`;
}

// The SVG for a phase's icon.
function phaseSvg(phase, look) {
  const { sky, sea, body, x, y, glow, reflection } = look;
  const { inset, radius } = TILE;
  const side = 100 - 2 * inset;
  const below = 100 - HORIZON;
  const depth = body === "below" ? 14 : below; // how far down the water the reflection reaches
  const stop = (offset, colour, opacity = 1) =>
    `<stop offset="${offset}" stop-color="${colour}" stop-opacity="${opacity}"/>`;

  const defs = [
    `<clipPath id="tile"><rect x="${inset}" y="${inset}" width="${side}" height="${side}" rx="${radius}"/></clipPath>`,
    `<clipPath id="sky"><rect width="100" height="${HORIZON}"/></clipPath>`,
    `<clipPath id="sea"><rect y="${HORIZON}" width="100" height="${below}"/></clipPath>`,
    `<linearGradient id="sky-fill" x1="0" y1="0" x2="0" y2="1">${stop(0, sky[0])}${stop(0.6, sky[1])}${stop(1, sky[2])}</linearGradient>`,
    `<linearGradient id="sea-fill" x1="0" y1="0" x2="0" y2="1">${stop(0, sea[0])}${stop(1, sea[1])}</linearGradient>`,
    `<radialGradient id="glow">${stop(0, glow.colour, glow.opacity)}${stop(0.45, glow.colour, glow.opacity * 0.35)}${stop(1, glow.colour, 0)}</radialGradient>`,
    // Brightest at the horizon, fading down the water. In user space, since
    // the reflection's shape reaches above the horizon, where it's clipped.
    `<linearGradient id="reflection" gradientUnits="userSpaceOnUse" x1="0" y1="${HORIZON}" x2="0" y2="${HORIZON + depth}">${stop(0, reflection.colour)}${stop(0.6, reflection.colour, 0.3)}${stop(1, reflection.colour, 0)}</linearGradient>`,
    // A glossy sheen over the top half, as on the workflow's icon.
    `<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">${stop(0, "#ffffff", 0.26)}${stop(0.5, "#ffffff", 0)}</linearGradient>`,
    // Blurred so the reflection's edges melt into the water. CoreSVG ignores
    // separate horizontal and vertical amounts, so it's one for both.
    `<filter id="reflection-blur" x="-80%" y="-30%" width="260%" height="160%"><feGaussianBlur stdDeviation="2.2"/></filter>`,
    `<filter id="sun-edge" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="0.9"/></filter>`,
  ];

  const scene = [
    `<rect width="100" height="100" fill="url(#sky-fill)"/>`,
    ...(STARS[phase] || []).map(([sx, sy, r]) => `<circle cx="${sx}" cy="${sy}" r="${r}" fill="#ffffff" opacity="0.9"/>`),
    `<g clip-path="url(#sky)"><circle cx="${x}" cy="${y}" r="${glow.radius}" fill="url(#glow)"/></g>`,
    `<rect y="${HORIZON}" width="100" height="${below}" fill="url(#sea-fill)"/>`,
    `<g clip-path="url(#sea)"><ellipse cx="${x}" cy="${HORIZON}" rx="${reflection.width}" ry="${depth}" fill="url(#reflection)" opacity="${reflection.opacity}" filter="url(#reflection-blur)"/></g>`,
    `<rect y="${HORIZON - 0.4}" width="100" height="0.8" fill="#ffffff" opacity="0.3"/>`,
  ];

  if (body === "sun") {
    const { core } = look;
    defs.push(
      `<radialGradient id="sun-fill" cx="0.42" cy="0.4">${stop(0, core[0])}${stop(0.55, core[1])}${stop(1, core[2])}</radialGradient>`,
    );
    // A faint halo just outside the disc; the horizon cuts both at sunrise and sunset.
    scene.push(
      `<g clip-path="url(#sky)">` +
        `<circle cx="${x}" cy="${y}" r="${look.radius + 2.5}" fill="${core[1]}" opacity="0.35" filter="url(#sun-edge)"/>` +
        `<circle cx="${x}" cy="${y}" r="${look.radius}" fill="url(#sun-fill)" filter="url(#sun-edge)"/>` +
        `</g>`,
    );
  } else if (body === "moon") {
    // A crescent: the disc less an offset one.
    defs.push(
      `<mask id="crescent"><rect width="100" height="100" fill="#000000"/>` +
        `<circle cx="${x}" cy="${y}" r="10" fill="#ffffff"/><circle cx="${x + 5.5}" cy="${y - 3.5}" r="9" fill="#000000"/></mask>`,
    );
    scene.push(`<circle cx="${x}" cy="${y}" r="10" fill="#f3f0dc" mask="url(#crescent)"/>`);
  }

  scene.push(`<rect width="100" height="100" fill="url(#sheen)"/>`);

  // A thin light edge, so the dark tiles stand out on a dark theme.
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
