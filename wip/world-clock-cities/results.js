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

  const now = new Date();
  // Found in the whole list, so filtering doesn't change which city is local.
  const localCity = findLocalCity(loaded.cities, now);

  let cities = loaded.cities;
  if (isTimeQuery(query)) {
    // TO-DO: convert the typed time into each city's local time.
  } else if (query) {
    cities = cities.filter((city) => matchesCity(city, query));
    if (cities.length === 0) {
      return output([
        { title: "No matching cities", subtitle: `Nothing in Clock's list matches “${query}”`, valid: false },
      ]);
    }
  }

  const infos = cities.map((city) => describeCity(city, now, { isLocal: city === localCity }));
  logCityInfos(infos);

  // Rerunning every second keeps the times and countdowns current while
  // Alfred is open; a run takes about a tenth of a second. skipknowledge stops
  // Alfred reordering the items by usage, which their uids would otherwise
  // allow, so they stay in Clock's order.
  return output(infos.map(cityItem), { rerun: 1, skipknowledge: true });
}

// Writes the cities' computed values to stderr as one JSON array, which Alfred
// shows in the workflow's debugger, for checking the raw values behind the
// results. Dates appear as UTC ISO strings.
function logCityInfos(infos) {
  console.log(JSON.stringify(infos, null, 2));
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
