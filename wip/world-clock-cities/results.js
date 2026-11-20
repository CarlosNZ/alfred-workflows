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

  return output(infos.map(cityItem));
}

// Writes the cities' computed values to stderr as one JSON array, which Alfred
// shows in the workflow's debugger. Dates appear as UTC ISO strings.
// TO-DO: remove once the results show these values.
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

// An Alfred item for a city, from describeCity's values.
function cityItem(info) {
  // No uid, so Alfred keeps Clock's order instead of reordering by usage.
  return {
    title: info.name,
    subtitle: [displayCountry(info), formatUtcOffset(info.utcOffsetMinutes)].filter(Boolean).join(" · "),
    arg: info.name,
  };
}

const MODIFIERS = ["cmd", "alt", "ctrl"];

// Every item defines each modifier, as inert (valid: false, same subtitle) where
// it has no action of its own. Otherwise Alfred applies its own modifiers, e.g.
// ⌥ "Search in Finder" and ⌃ "Search with default fallback", which the
// strictmods flag doesn't stop. ⇧ is left alone for Quick Look.
function output(items) {
  return JSON.stringify({ items: items.map(withInertMods) });
}

function withInertMods(item) {
  const mods = { ...item.mods };
  for (const key of MODIFIERS) {
    if (!mods[key]) mods[key] = { subtitle: item.subtitle || "", valid: false };
  }
  return { ...item, mods };
}
