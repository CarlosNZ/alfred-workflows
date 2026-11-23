// The detail view's layout: the constants that set its look, and the builder
// that turns them into the view's ui.json. Loaded by detail.js, which writes
// a variant of the layout when panel.zsh asks for one (see panel.zsh), and
// fills in the view's components, by id, on every pulse (detailUpdate in
// lib/detail.js).
//
// Clock and meeting modes share the layout, so an open detail window can
// switch between them when its city is opened again from the other mode: only
// the text and the tile differ (see detailUpdate).
//
// What's in the layout is fixed when the view opens, because Alfred UI can't
// add or remove a line later: a hidden component, or a label with no text,
// still takes its space. So each combination of these has its own variant:
//   launch       "inline" (↩, the inline view, inside Alfred) or "window"
//                (⌘↩, the detail window)
//   picture      true for a slot for the city's picture, which shows the
//                picture or a placeholder while it's loading; false when
//                there's none, so the city's name and time move to the left
//   clockChange  true for the line under the time zone that tells of a clock
//                change (see detailClockChange in lib/detail.js)
//   windowPrefs  a detail window's preferences, from the workflow's User
//                Configuration (the same options as Now Playing's): `buttons`,
//                true for the window buttons over a transparent title bar,
//                with room left for them at the top, or false for a borderless
//                window with `cornerRadius` (0-32) corners; and `transparency`
//                (0-100), how much the panel's tint lets the blur through. The
//                inline view takes none of them.
//   windowKey    the inline view's: the key that opens the city's detail
//                window from the results ("none", "cmd", "alt" or "ctrl", or
//                "" when it has none), which opens it from the view too (see
//                panelShortcuts)

// Colours: hex RGB or RGBA, or rgb(r, g, b, alpha). Explicit colours rather
// than the system's label colours, since the inline view takes the theme's
// appearance, which may be light, while its background is dark.
const PANEL_TINT_RGB = "18, 18, 20"; // the panel's tint over the blur, as Now Playing's; its alpha comes from the transparency (panelTint)
const INLINE_TRANSPARENCY = 45; // the inline view's, the transparency preference's default
const TEXT_COLOUR = "#FFFFFF";
const SECONDARY_TEXT_COLOUR = "#FFFFFFA6";
const CLOCK_CHANGE_COLOUR = "#F5C451";
const PICTURE_PLACEHOLDER_COLOUR = "#FFFFFF1A";
// The sunrise and sunset symbols' sun, and their arrow and horizon. Drawn into
// the symbols' images by resources/make-sun-symbols.js: run it after changing
// these.
const SUN_SYMBOL_COLOUR = "#F5C451";
const SUN_ARROW_COLOUR = "#FFFFFF";

// Spacing, in points.
const PANEL_PADDING = 20; // around the content
const WINDOW_BUTTONS_INSET = 10; // extra space above the content in a detail window with buttons, clear of them
const SECTION_SPACING = 16; // between the sections, from the top: the context line with the city, the time zone, the sun
const CONTEXT_SPACING = 2; // between the context line and the city, which it heads
const LINE_SPACING = 2; // between the lines within a section
const PICTURE_GAP = 18; // between the picture and the city's name
const TILE_GAP = 16; // between the tile and the sun times
const SUN_SYMBOL_GAP = 5; // between the sunrise or sunset symbol and its time
const SUN_TIMES_GAP = 12; // between the sunrise time's label and the sunset symbol; the label's spare width adds to it
const FLAG_RAISE = 4; // lifts the flag (by lowering the rest of its row) so its top lines up with the city's name

// Sizes, in points.
const WINDOW_WIDTH = 600;
const PICTURE_SIZE = { width: 210, height: 140 };
const PICTURE_CORNER_RADIUS = 8;
const TILE_SIZE = 88; // the phase of the day (clock mode) or working status (meeting mode) icon
// The Clock app's sunrise and sunset symbols, sunrise.fill and sunset.fill, as
// AppKit sizes them at 24pt, the times' size, so they match the digits as
// they would inline in text: their alignment rect is the font's cap height.
// Both are this size (34×29 at 22pt, 30×25 at 20pt). resources/make-sun-symbols.js
// draws them at the times' size, and stops if that isn't this size.
const SUN_SYMBOL_SIZE = { width: 37, height: 31 };
// Lowers the times below the top of the symbols, so the bottom of a symbol's
// horizon bar sits just below the times' baseline. At 24pt the bar's bottom
// is 27pt below the top of the image, and the times' baseline 23pt below the
// top of their label (measured in screenshots), so 4 puts the bar's bottom
// exactly on the baseline; a thin bar there looks too high, as a round
// letter would without overshoot, so it hangs 1pt below. Whole points only,
// as it's an inset. Change it with SUN_SYMBOL_SIZE.
const SUN_TIMES_DROP = 3;

// Fonts: size in points; weight one of ultralight, thin, light, regular,
// medium, semibold, bold, heavy, black; monospaced: "digits" keeps a ticking
// time from shifting.
const FONTS = {
  context: { size: 15 }, // "11 hours ahead of you" (now), "When it's 9:00 PM Sunday in London, UK…" (a typed time)
  city: { size: 30, weight: "bold" },
  country: { size: 18 },
  time: { size: 48, weight: "semibold", monospaced: "digits" },
  date: { size: 17 },
  flag: { size: 40 },
  zone: { size: 15 }, // "New Zealand Daylight Time (NZDT) • UTC+13"
  clockChange: { size: 14 }, // "Clocks go back 1 hour in 3 days, on Sunday"
  sunTimes: { size: 24 },
  sunDetail: { size: 15 }, // sun elevation and day length (clock mode), working day and nearest sunrise or sunset (meeting mode)
  pictureLoading: { size: 13 },
};

// Labels whose text can be too long for their width (a long city name, say),
// and the smallest size each shrinks to so it fits. Below that, the text is
// cut off with an ellipsis. See fittedFont.
const MIN_FONT_SIZES = { city: 18, country: 13, date: 13, context: 12, zone: 12 };

// Kept free beside a label's measured text: a label draws its text a little
// inside its frame.
const TEXT_WIDTH_MARGIN = 6;

// A line's height as a multiple of its font size, for working out the window's
// height (Alfred UI can't fit a window to its content).
const LINE_HEIGHT = 1.22;

// Added to the height in the layout of a detail window with buttons: with
// these window settings, Alfred opens the window this much shorter than the
// size it's given (measured on macOS 26, where it's the title bar's height).
// A borderless window, and the inline view, are exactly the height they're
// given. The pulse's resize (windowResize in detail.js) gives the size
// exactly, so it takes it off.
const WINDOW_HEIGHT_ADJUSTMENT = 32;

// The detail window, as Now Playing's: the window buttons over a transparent
// title bar, unless the preference makes it borderless, which ignores the
// title bar's settings (see panelUi). The inline view ignores these, and
// takes the theme's width and the height in `size`.
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

// The modifier symbols for the keys results.js gives the actions (see
// cityActionKeys there), as Alfred UI's shortcuts spell them.
const MODIFIER_SYMBOLS = { cmd: "⌘", alt: "⌥", ctrl: "⌃" };

// The root view's shortcuts. In the detail window, ⎋ closes it. In the inline
// view, Alfred takes ⎋ before the view sees it, and hides; ⌫ goes back to the
// results the view was opened from (`detail.js back`), since Alfred's stacking
// can't: the results are gone by the time the view opens. ↩ opens the city's
// detail window, and so does the key that opens it from the results
// (`windowKey`) with ↩, so ⌘↩ by default: finishing hands detail_launch to the
// inline view's Alfred UI object, which connects to the detail window's Run
// Script, with the city's other variables still in the stream from its result.
function panelShortcuts(inWindow, windowKey) {
  if (inWindow) return [{ shortcut: "⎋", action: { type: "json", src: { finish: {} } } }];
  const openWindow = { type: "json", src: { finish: { variables: { detail_launch: "window" } } } };
  const modifier = MODIFIER_SYMBOLS[windowKey];
  return [
    { shortcut: "⌫", action: { type: "script", src: "./detail.js", args: ["back"], async: true } },
    { shortcut: "↩", action: openWindow },
    modifier && { shortcut: `${modifier}↩`, action: openWindow },
  ].filter(Boolean);
}

// The ui.json for a variant of the view (see the top of this file).
function panelUi({ launch, picture, clockChange, windowPrefs, windowKey }) {
  const inWindow = launch === "window";
  const buttons = inWindow && windowPrefs.buttons;
  const borderless = inWindow && !windowPrefs.buttons;
  const sections = [
    {
      ...column(CONTEXT_SPACING, [panelLabel("context", FONTS.context, SECONDARY_TEXT_COLOUR), cityHeader(picture)]),
      constraints: { stretch: "horizontal" },
    },
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
      ...(borderless && { borderless: true, cornerradius: windowPrefs.cornerRadius }),
      size: {
        width: WINDOW_WIDTH,
        height: panelHeight({ buttons, picture, clockChange }) + (buttons ? WINDOW_HEIGHT_ADJUSTMENT : 0),
      },
      root: {
        type: "view",
        layout: "inline",
        direction: "vertical",
        padding: PANEL_PADDING,
        background: panelTint(inWindow ? windowPrefs.transparency : INLINE_TRANSPARENCY),
        shortcuts: panelShortcuts(inWindow, windowKey),
        // The sections are in a column of their own, so the space for the
        // window buttons above them isn't followed by a section's spacing.
        components: [
          buttons && spacer(WINDOW_BUTTONS_INSET),
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
          {
            ...panelLabel(null, FONTS.pictureLoading, SECONDARY_TEXT_COLOUR, "Loading…"),
            constraints: { position: "centre" },
          },
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

// The tile (the phase of the day, or the working status in meeting mode)
// beside the sunrise and sunset and two lines of details. Ids: tile,
// sundetail1, sundetail2, and those in sunTimesRow.
function sunSection() {
  const text = column(LINE_SPACING, [
    sunTimesRow(),
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

// Today's sunrise and sunset, each the Clock app's symbol beside its time
// (ids: sunevents, the row; sunrisesymbol, sunrisetime, sunsetsymbol,
// sunsettime), stacked with a label for what's said in their place during
// polar day or night (sunpolar). The pulse shows the row or fills the label;
// it's a stack because a hidden component still takes its space. A label
// can't hold a symbol, so the symbols are image views, given their images by
// the pulse, as the tile is: icons/symbol-sunrise.png and symbol-sunset.png,
// the symbols in two colours, which Alfred UI can't do with an SF Symbol (see
// resources/make-sun-symbols.js). The times are lowered by a top inset
// (SUN_TIMES_DROP). An image view fills the row's height and centres its
// image in it, so each symbol's has a bottom inset that keeps it the image's
// height, at the top of the row: the row is SUN_TIMES_ROW_SLACK taller than
// the lowered times' line, so a label a little taller than lineHeight works
// out doesn't make the row taller and move the symbol off the top. Each part
// of the row has a fixed width, since a label in an inline row keeps the
// width of the text it starts with. The two are in border layouts, each in a
// left region, which takes its desired width: an inline row wider than its
// content centres it.
function sunTimesRow() {
  const timeWidth = sunTimeWidth();
  const sunEvent = (event) => ({
    type: "view",
    layout: "inline",
    direction: "horizontal",
    spacing: SUN_SYMBOL_GAP,
    components: [
      {
        id: `${event}symbol`,
        type: "imageview",
        constraints: { size: SUN_SYMBOL_SIZE, insets: { bottom: sunTimesRowHeight() - SUN_SYMBOL_SIZE.height } },
      },
      {
        ...panelLabel(`${event}time`, FONTS.sunTimes),
        constraints: { size: { width: timeWidth }, insets: { top: SUN_TIMES_DROP } },
      },
    ],
  });
  const leftAligned = (component, spacing = 0, rest = []) => ({
    type: "view",
    layout: "border",
    spacing,
    components: [{ ...component, constraints: { region: "left" } }, ...rest],
  });
  const sunset = leftAligned(sunEvent("sunset"));
  return {
    type: "view",
    layout: "stack",
    constraints: { stretch: "horizontal" },
    components: [
      {
        ...leftAligned(sunEvent("sunrise"), SUN_TIMES_GAP, [{ ...sunset, constraints: { region: "centre" } }]),
        id: "sunevents",
        hidden: true,
      },
      { ...panelLabel("sunpolar", FONTS.sunTimes), constraints: { insets: { top: SUN_TIMES_DROP } } },
    ],
  };
}

// Extra height for the sunrise and sunset row, below the lowered times' line
// (see sunTimesRow).
const SUN_TIMES_ROW_SLACK = 2;

// The height of the sunrise and sunset row: the lowered times' line and the
// slack, or the symbols if they're taller.
function sunTimesRowHeight() {
  return Math.max(lineHeight(FONTS.sunTimes) + SUN_TIMES_DROP + SUN_TIMES_ROW_SLACK, SUN_SYMBOL_SIZE.height);
}

// The width of a sunrise or sunset time's label: the widest time of day in
// whichever time format is widest (allTimeFormats in lib/format.js), so that
// changing the time format, in the workflow or the Mac's settings, doesn't
// cut the times off in a layout built before.
// A time's width is taken as its hour's plus its minutes', so it measures
// each hour, then each minute of the widest hour, not all 1440 times.
function sunTimeWidth() {
  const at = (hour, minute) => new Date(Date.UTC(2000, 0, 1, hour, minute));
  const formats = allTimeFormats().map((name) => (date) => formatTimeAs(name, date, "UTC"));
  const widths = formats.map((format) => {
    const widest = (dates) =>
      dates
        .map((date) => ({ date, width: textWidth(format(date), FONTS.sunTimes) }))
        .reduce((a, b) => (b.width > a.width ? b : a));
    const hour = widest(Array.from({ length: 24 }, (_, h) => at(h, 0))).date.getUTCHours();
    return widest(Array.from({ length: 60 }, (_, m) => at(hour, m))).width;
  });
  return Math.ceil(Math.max(...widths) + TEXT_WIDTH_MARGIN);
}

// The panel's tint for a transparency from 0 (solid) to 100 (blur only), as
// Now Playing's: its alpha is (100 - transparency) / 100.
function panelTint(transparency) {
  return `rgb(${PANEL_TINT_RGB}, ${(100 - transparency) / 100})`;
}

// The view's height for a variant: the content's height worked out from the
// constants above, plus the padding, and the space for the window buttons if
// it has them.
function panelHeight({ buttons, picture, clockChange }) {
  const lines = (...fonts) =>
    fonts.reduce((sum, font) => sum + lineHeight(font), 0) + LINE_SPACING * (fonts.length - 1);
  const header = Math.max(
    (picture ? PICTURE_SIZE.height : 0) + FLAG_RAISE,
    lines(FONTS.city, FONTS.country, FONTS.time, FONTS.date) + FLAG_RAISE,
    lineHeight(FONTS.flag),
  );
  const zone = clockChange ? lines(FONTS.zone, FONTS.clockChange) : lines(FONTS.zone);
  const sun = Math.max(TILE_SIZE, sunTimesRowHeight() + LINE_SPACING + lines(FONTS.sunDetail, FONTS.sunDetail));
  const sections = [lineHeight(FONTS.context) + CONTEXT_SPACING + header, zone, sun];
  const content = sections.reduce((sum, height) => sum + height, 0) + SECTION_SPACING * (sections.length - 1);
  return Math.ceil(content + 2 * PANEL_PADDING + (buttons ? WINDOW_BUTTONS_INSET : 0));
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

// The width of a label that shrinks to fit: the context and zone lines span
// the content; the others are in the city's column, between the picture (if
// there's a slot) and the flag.
function labelWidth(id, { picture }) {
  const content = WINDOW_WIDTH - 2 * PANEL_PADDING;
  if (id === "context" || id === "zone") return content;
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

// The size a window should be, from its layout's `window`, for a resize,
// which gives the size exactly.
function windowSizeFromLayout(window) {
  const { width, height } = window.size;
  return { width, height: height - (window.borderless ? 0 : WINDOW_HEIGHT_ADJUSTMENT) };
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
