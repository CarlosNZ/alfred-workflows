// Reading and filtering the cities in the Clock app's World Clock list.
// Loaded by results.js; needs Foundation imported.

const CITIES_PLIST = "~/Library/Containers/com.apple.clock/Data/Library/Preferences/com.apple.mobiletimer.plist";

// Path of Clock's city list. WCC_CITIES_PLIST overrides it, for testing
// against a copy of the file without Full Disk Access.
function citiesPlistPath() {
  const override = $.NSProcessInfo.processInfo.environment.objectForKey("WCC_CITIES_PLIST");
  return $(override.isNil() ? CITIES_PLIST : override.js).stringByExpandingTildeInPath.js;
}

// Reads Clock's city list, in Clock's order. Returns { cities } on success, or
// { error } with "missing", "unreadable" or "empty".
function loadCities(path = citiesPlistPath()) {
  if (!$.NSFileManager.defaultManager.fileExistsAtPath(path)) return { error: "missing" };

  // The file is in Clock's sandbox container, which macOS protects: reading it
  // fails unless the process (Alfred) has Full Disk Access.
  const prefs = ObjC.deepUnwrap($.NSDictionary.dictionaryWithContentsOfFile(path));
  if (!prefs) return { error: "unreadable" };

  const cities = (prefs.cities || []).map((entry) => entry.city).filter((city) => city && city.timeZone);
  if (cities.length === 0) return { error: "empty" };
  return { cities };
}

// True when every word of the query starts a word of the city's name or
// country, ignoring case and accents ("san f" matches San Francisco).
function matchesCity(city, query) {
  const words = cityWords([city.name, city.unlocalizedName, city.countryName, city.unlocalizedCountryName].join(" "));
  return cityWords(query).every((term) => words.some((word) => word.startsWith(term)));
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
// values; lib/format.js turns them into text. Times are Dates; offsets,
// durations and day lengths are in minutes; states are codes such as
// "goldenHour".
function describeCity(city, moment, { isLocal = false, macZone = macTimeZone() } = {}) {
  const local = zonedParts(city.timeZone, moment);
  const latitude = Number(city.latitude);
  const longitude = Number(city.longitude);
  const hasCoordinates = city.latitude != null && city.longitude != null && isFinite(latitude) && isFinite(longitude);
  const offset = utcOffsetMinutes(city.timeZone, moment);

  return {
    name: city.name,
    country: city.countryName || null,
    countryCode: city.localeCode || null,
    countryOnly: Boolean(city.displayNameIncludingCountryUsesOnlyCountry),
    timeZone: city.timeZone,
    isLocal,
    moment,
    // The calendar date and time of day in the city at the moment.
    local,
    dayOffset: dayOffset(city.timeZone, macZone, moment),
    utcOffsetMinutes: offset,
    offsetFromLocalMinutes: offset - utcOffsetMinutes(macZone, moment),
    nextClockChange: nextClockChange(city.timeZone, moment),
    workingStatus: workingStatus(local),
    // Without coordinates there's nothing to say about the sun.
    ...(hasCoordinates ? sunInfo(latitude, longitude, city.timeZone, calendarDay(local), moment) : {}),
  };
}
