// The detail view's layout: the constants that set its look, and the builder
// that turns them into the view's ui.json. Loaded by detail.js, which writes
// a variant of the layout when panel.zsh asks for one (see panel.zsh), and
// fills in the view's components, by id, on every pulse (detailUpdate in
// lib/detail.js).
//
// The now and meeting modes share the layout, so an open detail window can
// switch between them when its city is opened again from the other mode: only
// the text and the tile differ (see detailUpdate).
//
// What's in the layout is fixed when the view opens, because Alfred UI can't
// add or remove a line later: a hidden component, or a label with no text,
// still takes its space. So each combination of these has its own variant:
//   launch       "inline" (↩, the inline view, inside Alfred) or "window"
//                (⌘↩, the detail window), which leaves room for the window
//                buttons at the top
//   picture      true for a slot for the city's picture, which shows the
//                picture or a placeholder while it's loading; false when
//                there's none, so the city's name and time move to the left
//   clockChange  true for the line under the time zone that tells of a clock
//                change (see detailClockChange in lib/detail.js)

// Colours: hex RGB or RGBA, or rgb(r, g, b, alpha). Explicit colours rather
// than the system's label colours, since the inline view takes the theme's
// appearance, which may be light, while its background is dark.
const PANEL_TINT = "rgb(18, 18, 20, 0.55)"; // Now Playing's default (transparency 45)
const TEXT_COLOUR = "#FFFFFF";
const SECONDARY_TEXT_COLOUR = "#FFFFFFA6";
const CLOCK_CHANGE_COLOUR = "#F5C451";
const PICTURE_PLACEHOLDER_COLOUR = "#FFFFFF1A";

// Spacing, in points.
const PANEL_PADDING = 20; // around the content
const WINDOW_BUTTONS_INSET = 14; // extra space above the content in a detail window, clear of its buttons
const SECTION_SPACING = 16; // between the sections, from the top: the context line, the city, the time zone, the sun
const LINE_SPACING = 2; // between the lines within a section
const PICTURE_GAP = 18; // between the picture and the city's name
const TILE_GAP = 16; // between the tile and the sun times
const FLAG_RAISE = 4; // lifts the flag (by lowering the rest of its row) so its top lines up with the city's name

// Sizes, in points.
const WINDOW_WIDTH = 600;
const PICTURE_SIZE = { width: 210, height: 140 };
const PICTURE_CORNER_RADIUS = 8;
const TILE_SIZE = 88; // the phase of the day (now) or working status (meeting) icon

// Fonts: size in points; weight one of ultralight, thin, light, regular,
// medium, semibold, bold, heavy, black; monospaced: "digits" keeps a ticking
// time from shifting.
const FONTS = {
  context: { size: 15 }, // "11 hours ahead of you" (now), "When it's 9:00 PM Sunday in London, UK…" (meeting)
  city: { size: 30, weight: "bold" },
  country: { size: 18 },
  time: { size: 48, weight: "semibold", monospaced: "digits" },
  date: { size: 17 },
  flag: { size: 40 },
  zone: { size: 15 }, // "New Zealand Daylight Time (NZDT) • UTC+13"
  clockChange: { size: 14 }, // "Clocks go back 1 hour in 3 days, on Sunday"
  sunTimes: { size: 24 },
  sunDetail: { size: 15 }, // sun elevation and day length (now), working day and nearest sunrise or sunset (meeting)
  pictureLoading: { size: 13 },
};

// Labels whose text can be too long for their width (a long city name, say),
// and the smallest size each shrinks to so it fits. Below that, the text is
// cut off with an ellipsis. See fittedFont.
const MIN_FONT_SIZES = { city: 18, country: 13, date: 13, context: 12 };

// Kept free beside a label's measured text: a label draws its text a little
// inside its frame.
const TEXT_WIDTH_MARGIN = 6;

// A line's height as a multiple of its font size, for working out the window's
// height (Alfred UI can't fit a window to its content).
const LINE_HEIGHT = 1.22;

// Added to a detail window's height in its layout: with these window
// settings, Alfred opens the window this much shorter than the size it's
// given (measured on macOS 26, where it's the title bar's height). The inline
// view is exactly the height it's given. The pulse's resize
// (windowResize in detail.js) gives the size exactly, so it takes it off.
const WINDOW_HEIGHT_ADJUSTMENT = 32;

// The detail window: Now Playing's defaults, with the window buttons over a
// transparent title bar. The inline view ignores these, and takes the theme's
// width and the height in `size`.
const WINDOW_SETTINGS = {
  title: "{var:detail_title}",
  titlevisibility: false,
  titlebarappearstransparent: true,
  fullsizecontentview: true,
  minimisable: false,
  fullscreenable: false,
  movablebybackground: true,
  blur: true,
  appearance: "dark",
  frameautosave: true,
};

// The root view's shortcuts. In the detail window, ⎋ closes it. In the inline
// view, Alfred takes ⎋ before the view sees it, and hides; ⌫ goes back to the
// results the view was opened from (`detail.js back`), since Alfred's stacking
// can't: the results are gone by the time the view opens. ↩ and ⌘↩ open the
// city's detail window: finishing hands detail_launch to the inline view's
// Alfred UI object, which connects to the detail window's Run Script, with the
// city's other variables still in the stream from its result.
function panelShortcuts(inWindow) {
  if (inWindow) return [{ shortcut: "⎋", action: { type: "json", src: { finish: {} } } }];
  const openWindow = { type: "json", src: { finish: { variables: { detail_launch: "window" } } } };
  return [
    { shortcut: "⌫", action: { type: "script", src: "./detail.js", args: ["back"], async: true } },
    { shortcut: "↩", action: openWindow },
    { shortcut: "⌘↩", action: openWindow },
  ];
}

// The ui.json for a variant of the view (see the top of this file).
function panelUi({ launch, picture, clockChange }) {
  const inWindow = launch === "window";
  const sections = [
    panelLabel("context", FONTS.context, SECONDARY_TEXT_COLOUR),
    cityHeader(picture),
    zoneSection(clockChange),
    sunSection(),
  ];
  return {
    variablesconfig: { detail_title: { src: "variable" } },
    // The Alfred UI helper's app icon, for ⌘-Tab, the Dock and window
    // switchers: the package's link to appicon.png (see panel.zsh). Only the
    // detail window needs one; the inline view is inside Alfred's window.
    ...(inWindow && { iconpath: "appicon.png" }),
    pulse: { src: "./detail.js", interval: 1, intervalmode: "delay", now: true },
    window: {
      ...WINDOW_SETTINGS,
      size: {
        width: WINDOW_WIDTH,
        height: panelHeight({ inWindow, picture, clockChange }) + (inWindow ? WINDOW_HEIGHT_ADJUSTMENT : 0),
      },
      root: {
        type: "view",
        layout: "inline",
        direction: "vertical",
        padding: PANEL_PADDING,
        background: PANEL_TINT,
        shortcuts: panelShortcuts(inWindow),
        // The sections are in a column of their own, so the space for the
        // window buttons above them isn't followed by a section's spacing.
        components: [
          inWindow && spacer(WINDOW_BUTTONS_INSET),
          { ...column(SECTION_SPACING, sections), constraints: { stretch: "horizontal" } },
        ].filter(Boolean),
      },
    },
  };
}

// The picture (or the space for it) beside the city's name, country, time and
// date, with the flag at the top right. Ids: picture, pictureloading, city,
// country, time, date, flag.
//
// The rows are border layouts so the text is in the centre region, which
// takes the width the sides leave: a label in a row with an inline layout
// keeps the width of the space it starts with, so the pulse's text was cut
// off.
function cityHeader(picture) {
  const text = column(LINE_SPACING, [
    panelLabel("city", FONTS.city),
    panelLabel("country", FONTS.country, SECONDARY_TEXT_COLOUR),
    panelLabel("time", FONTS.time),
    panelLabel("date", FONTS.date),
  ]);
  return {
    type: "view",
    layout: "border",
    spacing: PICTURE_GAP,
    constraints: { stretch: "horizontal" },
    components: [
      picture && { ...pictureSlot(), constraints: { region: "left", size: PICTURE_SIZE, insets: { top: FLAG_RAISE } } },
      { ...text, constraints: { region: "centre", stretch: "horizontal", insets: { top: FLAG_RAISE } } },
      // A fixed size, since the label would keep the width of the space it
      // starts with.
      {
        ...panelLabel("flag", FONTS.flag),
        textalign: "right",
        constraints: { region: "right", position: "top", size: { width: flagWidth(), height: lineHeight(FONTS.flag) } },
      },
    ].filter(Boolean),
  };
}

// A fixed-size space for the picture, so it keeps its size when the picture
// arrives by update: the picture, cropped to fill it, stacked over a
// placeholder shown while it's loading. Both start hidden; the first pulse
// shows one.
function pictureSlot() {
  return {
    type: "view",
    layout: "stack",
    components: [
      {
        id: "pictureloading",
        type: "view",
        layout: "stack",
        hidden: true,
        background: PICTURE_PLACEHOLDER_COLOUR,
        cornerradius: PICTURE_CORNER_RADIUS,
        constraints: { stretch: "both" },
        components: [
          { ...panelLabel(null, FONTS.pictureLoading, SECONDARY_TEXT_COLOUR, "Loading…"), constraints: { position: "centre" } },
        ],
      },
      {
        id: "picture",
        type: "imageview",
        resize: "fill",
        cornerradius: PICTURE_CORNER_RADIUS,
        hidden: true,
        image: { type: "symbol", src: "photo" },
        constraints: { stretch: "both" },
      },
    ],
  };
}

// The time zone's name and UTC offset, and below it any clock change. Ids:
// zone, clockchange.
function zoneSection(clockChange) {
  return column(LINE_SPACING, [
    panelLabel("zone", FONTS.zone),
    clockChange && panelLabel("clockchange", FONTS.clockChange, CLOCK_CHANGE_COLOUR),
  ]);
}

// The tile (the phase of the day, or the working status in the meeting mode)
// beside the sunrise and sunset and two lines of details. Ids: tile,
// suntimes, sundetail1, sundetail2.
function sunSection() {
  const text = column(LINE_SPACING, [
    panelLabel("suntimes", FONTS.sunTimes),
    panelLabel("sundetail1", FONTS.sunDetail, SECONDARY_TEXT_COLOUR),
    panelLabel("sundetail2", FONTS.sunDetail, SECONDARY_TEXT_COLOUR),
  ]);
  return {
    type: "view",
    layout: "border",
    spacing: TILE_GAP,
    constraints: { stretch: "horizontal" },
    components: [
      {
        id: "tile",
        type: "imageview",
        hidden: true,
        image: { type: "symbol", src: "clock" },
        constraints: { region: "left", size: TILE_SIZE },
      },
      { ...text, constraints: { region: "centre", stretch: "horizontal" } },
    ],
  };
}

// The view's height for a variant: the content's height worked out from the
// constants above, plus the padding.
function panelHeight({ inWindow, picture, clockChange }) {
  const lines = (...fonts) => fonts.reduce((sum, font) => sum + lineHeight(font), 0) + LINE_SPACING * (fonts.length - 1);
  const header = Math.max(
    (picture ? PICTURE_SIZE.height : 0) + FLAG_RAISE,
    lines(FONTS.city, FONTS.country, FONTS.time, FONTS.date) + FLAG_RAISE,
    lineHeight(FONTS.flag),
  );
  const zone = clockChange ? lines(FONTS.zone, FONTS.clockChange) : lines(FONTS.zone);
  const sun = Math.max(TILE_SIZE, lines(FONTS.sunTimes, FONTS.sunDetail, FONTS.sunDetail));
  const sections = [lineHeight(FONTS.context), header, zone, sun];
  const content = sections.reduce((sum, height) => sum + height, 0) + SECTION_SPACING * (sections.length - 1);
  return Math.ceil(content + 2 * PANEL_PADDING + (inWindow ? WINDOW_BUTTONS_INSET : 0));
}

function flagWidth() {
  return Math.ceil(FONTS.flag.size * 1.3);
}

// The font a label that shrinks to fit (one in MIN_FONT_SIZES) needs for
// `text`: its font in FONTS if the text fits the label's width, otherwise
// the largest size, by half points, that fits, down to its minimum. `layout`
// says whether the view has a picture slot ({ picture }). The inline view is
// the theme's width, which the pulse can't see, so the label's width
// is worked out from WINDOW_WIDTH there too: with a narrower theme, a long
// name can still be cut off.
function fittedFont(id, text, layout) {
  const font = FONTS[id];
  const width = labelWidth(id, layout) - TEXT_WIDTH_MARGIN;
  let size = font.size;
  while (size > MIN_FONT_SIZES[id] && textWidth(text, { ...font, size }) > width) size -= 0.5;
  return { ...font, size };
}

// The width of a label that shrinks to fit: the context line spans the
// content; the others are in the city's column, between the picture (if
// there's a slot) and the flag.
function labelWidth(id, { picture }) {
  const content = WINDOW_WIDTH - 2 * PANEL_PADDING;
  if (id === "context") return content;
  return content - (picture ? PICTURE_SIZE.width + PICTURE_GAP : 0) - flagWidth() - PICTURE_GAP;
}

const FONT_WEIGHTS = {
  ultralight: "NSFontWeightUltraLight",
  thin: "NSFontWeightThin",
  light: "NSFontWeightLight",
  regular: "NSFontWeightRegular",
  medium: "NSFontWeightMedium",
  semibold: "NSFontWeightSemibold",
  bold: "NSFontWeightBold",
  heavy: "NSFontWeightHeavy",
  black: "NSFontWeightBlack",
};

// How wide text is in a font from FONTS, in the system font as Alfred UI
// draws it (measured within 3pt of screenshots). Needs AppKit imported.
function textWidth(text, font) {
  const weight = $[FONT_WEIGHTS[font.weight || "regular"]];
  const nsFont = font.monospaced
    ? $.NSFont.monospacedDigitSystemFontOfSizeWeight(font.size, weight)
    : $.NSFont.systemFontOfSizeWeight(font.size, weight);
  return $(text).sizeWithAttributes($({ NSFont: nsFont })).width;
}

// Whether a view's layout (its ui.json) has a component with this id.
function layoutHasComponent(node, id) {
  if (!node || typeof node !== "object") return false;
  if (node.id === id) return true;
  return Object.values(node).some((value) => layoutHasComponent(value, id));
}

// The size a window should be, from the size in its layout, for a resize,
// which gives the size exactly.
function windowSizeFromLayout(size) {
  return { width: size.width, height: size.height - WINDOW_HEIGHT_ADJUSTMENT };
}

function lineHeight(font) {
  return Math.ceil(font.size * LINE_HEIGHT);
}

// A label filled in by the pulse. It starts as a space rather than empty, so
// it's laid out a line high.
function panelLabel(id, font, colour = TEXT_COLOUR, text = " ") {
  return { ...(id && { id }), type: "label", text, font, colour, linebreak: "truncatetail" };
}

function column(spacing, components) {
  return { type: "view", layout: "inline", direction: "vertical", spacing, components: components.filter(Boolean) };
}

function spacer(height) {
  return { type: "view", constraints: { size: { height } } };
}
