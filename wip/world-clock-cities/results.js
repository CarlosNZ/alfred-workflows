#!/usr/bin/osascript -l JavaScript

// Script Filter for the World Clock keyword. Lists the cities from the Clock
// app's World Clock, in Clock's order.
//
// argv[0] is the text typed after the keyword. Text starting with a digit is a
// time to convert (e.g. "3pm"); anything else narrows the list by city or
// country name.

ObjC.import("Foundation");

const CITIES_PLIST =
  "~/Library/Containers/com.apple.clock/Data/Library/Preferences/com.apple.mobiletimer.plist";

function run(argv) {
  const query = (argv[0] || "").trim();
  const loaded = loadCities(CITIES_PLIST);
  if (loaded.error) return output([loaded.error]);

  let cities = loaded.cities;
  if (isTimeQuery(query)) {
    // TO-DO: convert the typed time into each city's local time.
  } else if (query) {
    cities = cities.filter((city) => matches(city, query));
    if (cities.length === 0) {
      return output([{ title: "No matching cities", subtitle: `Nothing in Clock's list matches “${query}”`, valid: false }]);
    }
  }

  return output(cities.map(cityItem));
}

// Reads Clock's city list. Returns { cities } on success, or { error } holding
// a single Alfred item that explains what went wrong.
function loadCities(plistPath) {
  const path = $(plistPath).stringByExpandingTildeInPath.js;

  if (!$.NSFileManager.defaultManager.fileExistsAtPath(path)) {
    return {
      error: {
        title: "Can't find Clock's city list",
        subtitle: "Open Clock and add a city in World Clock, then try again",
        valid: false,
      },
    };
  }

  // The file is in Clock's sandbox container, which macOS protects: reading it
  // fails unless Alfred has Full Disk Access.
  const prefs = ObjC.deepUnwrap($.NSDictionary.dictionaryWithContentsOfFile(path));
  if (!prefs) {
    return {
      error: {
        title: "Can't read Clock's city list",
        subtitle: "Give Alfred Full Disk Access in System Settings › Privacy & Security",
        valid: false,
      },
    };
  }

  const cities = (prefs.cities || []).map((entry) => entry.city).filter((city) => city && city.timeZone);
  if (cities.length === 0) {
    return {
      error: {
        title: "No cities in Clock",
        subtitle: "Add cities in the Clock app's World Clock tab",
        valid: false,
      },
    };
  }
  return { cities };
}

function isTimeQuery(query) {
  return /^\d/.test(query);
}

// True when every word of the query starts a word of the city's name or
// country, ignoring case and accents ("san f" matches San Francisco).
function matches(city, query) {
  const words = fold([city.name, city.unlocalizedName, city.countryName, city.unlocalizedCountryName].join(" "))
    .split(/[\s,.\-'’()]+/)
    .filter(Boolean);
  return fold(query)
    .split(/\s+/)
    .every((term) => words.some((word) => word.startsWith(term)));
}

function fold(text) {
  return (text || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// UTC offset of a time zone right now, daylight saving included, e.g.
// "UTC+13", "UTC+5:30", "UTC".
function utcOffset(timeZone, date = new Date()) {
  const part = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName");
  const offset = part ? part.value.replace(/^GMT/, "") : "";
  return offset ? `UTC${offset}` : "UTC";
}

function cityItem(city) {
  // No uid, so Alfred keeps Clock's order instead of reordering by usage.
  return {
    title: city.name,
    subtitle: `${city.countryName} · ${utcOffset(city.timeZone)}`,
    arg: city.name,
  };
}

function output(items) {
  return JSON.stringify({ items });
}
