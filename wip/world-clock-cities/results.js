#!/usr/bin/osascript -l JavaScript

// Script Filter for the World Clock keyword. Lists the cities from the Clock
// app's World Clock, in Clock's order.
//
// argv[0] is the text typed after the keyword. Text starting with a digit is a
// time to convert (e.g. "3pm"); anything else narrows the list by city or
// country name.
//
// The logic lives in lib/; this file turns it into Alfred results.

ObjC.import("Foundation");
ObjC.import("CoreFoundation");

const LIBS = ["lib/cities.js", "lib/time.js", "lib/sun.js", "lib/format.js"];

const LOAD_ERRORS = {
  missing: { title: "Can't find Clock's city list", subtitle: "Open Clock and add a city in World Clock, then try again" },
  unreadable: {
    title: "Can't read Clock's city list",
    subtitle: "Give Alfred Full Disk Access in System Settings › Privacy & Security",
  },
  empty: { title: "No cities in Clock", subtitle: "Add cities in the Clock app's World Clock tab" },
};

function run(argv) {
  LIBS.forEach(loadLib);

  const query = (argv[0] || "").trim();
  const loaded = loadCities();
  if (loaded.error) return output([{ ...LOAD_ERRORS[loaded.error], valid: false }]);

  const now = currentTime();
  // Found in the whole list, so filtering doesn't change which city is local.
  const localCity = findLocalCity(loaded.cities, now);

  let cities = loaded.cities;
  // Text that narrows the list: the whole query in the list mode, and the text
  // after a relative time in the time mode.
  let filter = query;
  // The moment the cities are shown at: now, or the typed time.
  let moment = now;
  const timeQuery = isTimeQuery(query);
  let typed;
  if (timeQuery) {
    typed = readTypedTime(query, loaded.cities, now);
    logTypedTime(typed);
    // A query that gives no moment shows a single message in place of the
    // cities, since the cities at any other time would mislead.
    const message = typedTimeMessage(typed, query);
    if (message) return output([{ ...message, valid: false }]);
    filter = typed.filter;
    moment = typed.moment;
  }
  if (filter) {
    cities = cities.filter((city) => matchesCity(city, filter));
    if (cities.length === 0) {
      return output([
        { title: "No matching cities", subtitle: `Nothing in Clock's list matches “${filter}”`, valid: false },
      ]);
    }
  }

  const infos = cities.map((city) => describeCity(city, moment, { isLocal: city === localCity, now }));
  logCityInfos(infos);

  // Rerunning every second keeps the times and countdowns current while
  // Alfred is open; a run takes about a tenth of a second. A typed clock time
  // is a fixed moment, so it doesn't rerun, but a relative time moves with the
  // clock. skipknowledge stops Alfred reordering the items by usage, which
  // their uids would otherwise allow, so they stay in Clock's order.
  const rerun = !timeQuery || typed.kind === "relative";
  const items = infos.map((info) => (timeQuery ? timeCityItem(info) : cityItem(info)));
  return output(items, { ...(rerun && { rerun: 1 }), skipknowledge: true });
}

// Writes the cities' computed values to stderr as one JSON array, which Alfred
// shows in the workflow's debugger, for checking the raw values behind the
// results. Dates appear as UTC ISO strings.
function logCityInfos(infos) {
  console.log(JSON.stringify(infos, null, 2));
}

// The single result for a time query that gives no moment (see readTypedTime),
// as { title, subtitle }, or null when it gives one.
function typedTimeMessage(typed, query) {
  switch (typed.kind) {
    case "incomplete":
      return { title: "Keep typing…", subtitle: query };
    case "invalid":
      return { title: "Can't read that time", subtitle: `“${query}” isn't a time. Try 3pm, 15:30, 9am tu or +2` };
    case "unknownCity":
      return {
        title: `No city matches “${typed.place}”`,
        subtitle: "Type a city from Clock's list after the time, or leave it out",
      };
    default:
      return null;
  }
}

// Writes what a time query was read as to stderr, for the workflow's debugger,
// as one line: readTypedTime's result, with the moment also shown in the zone it
// was read in.
function logTypedTime(typed) {
  const shown = typed.moment && formatWithTemplate(typed.moment, typed.timeZone, "EEE d MMM y jj:mm z");
  console.log(`Typed time: ${JSON.stringify({ ...typed, ...(shown && { shown }) })}`);
}

// Runs a file from lib/ in the global scope, so its top-level functions are
// available here and to the other lib files; its top-level const and let stay
// private to it. JXA has no import, and Library() only loads from
// ~/Library/Script Libraries. The path is relative to the working directory,
// which Alfred sets to the workflow folder.
function loadLib(file) {
  const source = $.NSString.stringWithContentsOfFileEncodingError(file, $.NSUTF8StringEncoding, null);
  if (source.isNil()) throw new Error(`Can't load ${file} (run from the workflow folder)`);
  (0, eval)(source.js);
}

// An Alfred item for a city in the list, from describeCity's values.
function cityItem(info) {
  const details = sunDetails(info);
  return {
    // On a rerun, Alfred keeps the selection on the item with the selected
    // item's uid; without uids it jumps back to the first item.
    uid: info.id,
    title: listTitle(info),
    subtitle: listSubtitle(info),
    arg: info.name,
    ...(info.dayPhase && { icon: { path: `icons/phase-${info.dayPhase}.png` } }),
    text: { largetype: largeTypeText(info) },
    ...(details && { mods: { ctrl: { subtitle: details, valid: false } } }),
  };
}

// An Alfred item for a city in the time mode, from describeCity's values at the
// typed time. Its icon is the working status.
function timeCityItem(info) {
  return {
    ...cityItem(info),
    title: timeTitle(info),
    subtitle: timeSubtitle(info),
    icon: { path: `icons/status-${info.workingStatus}.png` },
  };
}

const MODIFIERS = ["cmd", "alt", "ctrl"];

// Every item defines each modifier, as inert (valid: false, same subtitle) where
// it has no action of its own. Otherwise Alfred applies its own modifiers, e.g.
// ⌥ "Search in Finder" and ⌃ "Search with default fallback", which the
// strictmods flag doesn't stop. ⇧ is left alone for Quick Look.
// `options` adds top-level Script Filter keys, such as rerun.
function output(items, options = {}) {
  return JSON.stringify({ ...options, items: items.map(withInertMods) });
}

function withInertMods(item) {
  const mods = { ...item.mods };
  for (const key of MODIFIERS) {
    if (!mods[key]) mods[key] = { subtitle: item.subtitle || "", valid: false };
  }
  return { ...item, mods };
}
