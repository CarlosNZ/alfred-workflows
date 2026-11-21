// Reading and filtering the cities in the Clock app's World Clock list.
// Loaded by results.js; needs Foundation and CoreFoundation imported.

const CITIES_PLIST = "~/Library/Containers/com.apple.clock/Data/Library/Preferences/com.apple.mobiletimer.plist";

// Where to read Clock's city list: { path, viaPreferences }. WCC_CITIES_PLIST
// names a file to read instead, for testing without Full Disk Access; it's read
// directly, since cfprefsd caches a file it has read and would miss later
// edits to it.
function citiesSource() {
  const override = $.NSProcessInfo.processInfo.environment.objectForKey("WCC_CITIES_PLIST");
  return {
    path: $(override.isNil() ? CITIES_PLIST : override.js).stringByExpandingTildeInPath.js,
    viaPreferences: override.isNil(),
  };
}

// Reads Clock's city list, in Clock's order. Returns { cities } on success, or
// { error } with "missing", "unreadable" or "empty".
function loadCities({ path, viaPreferences } = citiesSource()) {
  if (!$.NSFileManager.defaultManager.fileExistsAtPath(path)) return { error: "missing" };

  // The file is in Clock's sandbox container, which macOS protects: reading it
  // fails unless the process (Alfred) has Full Disk Access.
  const prefs = ObjC.deepUnwrap($.NSDictionary.dictionaryWithContentsOfFile(path));
  if (!prefs) return { error: "unreadable" };

  const entries = (viaPreferences && citiesFromPreferences(path)) || prefs.cities || [];
  const cities = entries.map((entry) => entry.city).filter((city) => city && city.timeZone);
  if (cities.length === 0) return { error: "empty" };
  return { cities };
}

// The `cities` value from cfprefsd, the service that holds preferences for
// apps and writes them to their files. Clock reorders its list in cfprefsd when
// it quits, but the file only gets the new order when Clock next launches, so
// cfprefsd is the more current. The domain is the file's path without
// ".plist". Undefined if cfprefsd has no value.
function citiesFromPreferences(path) {
  const domain = path.replace(/\.plist$/, "");
  const ref = $.CFPreferencesCopyAppValue($("cities"), $(domain));
  return ref ? ObjC.deepUnwrap(ObjC.castRefToObject(ref)) : undefined;
}

// True when every word of the query starts a word of the city's name or
// country, ignoring case and accents ("san f" matches San Francisco).
function matchesCity(city, query) {
  const words = cityWords([city.name, city.unlocalizedName, city.countryName, city.unlocalizedCountryName].join(" "));
  return cityWords(query).every((term) => words.some((word) => word.startsWith(term)));
}

// The city a query names, for reading a typed time in its zone: the first city
// in Clock's order that matches it (as in matchesCity), as { city }. Several
// matches are fine when they keep the same time at the moment (Auckland and
// Wellington, for "new zealand"). Otherwise { error: "noCity" } or
// { error: "severalZones" }.
function findAnchorCity(cities, query, moment) {
  const matches = cities.filter((city) => matchesCity(city, query));
  if (matches.length === 0) return { error: "noCity" };
  const key = clockKey(matches[0].timeZone, moment);
  if (matches.some((city) => clockKey(city.timeZone, moment) !== key)) return { error: "severalZones" };
  return { city: matches[0] };
}

// Splits text into words on spaces and punctuation, so "U.S.A." is three words
// and typing "u.s" matches it.
function cityWords(text) {
  return foldText(text)
    .split(/[\s,.\-'’()]+/)
    .filter(Boolean);
}

function foldText(text) {
  return (text || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// Everything the workflow knows about a city at a moment, as one object of raw
// values; lib/format.js turns them into text. Times are Dates (instants, shown
// in the city's timeZone); offsets, durations and day lengths are in minutes;
// states are codes such as "goldenHour".
function describeCity(city, moment, { isLocal = false, macZone = macTimeZone() } = {}) {
  const local = zonedParts(city.timeZone, moment);
  const latitude = Number(city.latitude);
  const longitude = Number(city.longitude);
  const hasCoordinates = city.latitude != null && city.longitude != null && isFinite(latitude) && isFinite(longitude);
  const offset = utcOffsetMinutes(city.timeZone, moment);

  return {
    // Clock's identifier for the city, stable across runs and languages.
    id: city.identifier != null ? String(city.identifier) : `${city.name}|${city.timeZone}`,
    name: city.name,
    country: city.countryName || null,
    countryCode: city.localeCode || null,
    countryOnly: Boolean(city.displayNameIncludingCountryUsesOnlyCountry),
    timeZone: city.timeZone,
    isLocal,
    moment,
    dayOffset: dayOffset(city.timeZone, macZone, moment),
    utcOffsetMinutes: offset,
    offsetFromLocalMinutes: offset - utcOffsetMinutes(macZone, moment),
    nextClockChange: nextClockChange(city.timeZone, moment),
    workingStatus: workingStatus(local),
    // Without coordinates there's nothing to say about the sun.
    ...(hasCoordinates ? sunInfo(latitude, longitude, city.timeZone, calendarDay(local), moment) : {}),
  };
}
