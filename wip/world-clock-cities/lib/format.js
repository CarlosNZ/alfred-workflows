// Turning city values (from describeCity in cities.js) into text for results.
// Loaded by results.js; needs Foundation imported, and uses nsTimeZone and
// nsDate from time.js.

// Shorter names for countries as Clock stores them, for subtitles. Keyed by the
// stored name, so a name localized into another language is left as it is.
const SHORT_COUNTRY_NAMES = {
  "Great Britain": "UK",
  "United Kingdom": "UK",
  "U.S.A.": "USA",
  "United States": "USA",
  "United Arab Emirates": "UAE",
};

// The country to show for a city, shortened where there's a short name.
function displayCountry(info) {
  return info.country && (SHORT_COUNTRY_NAMES[info.country] || info.country);
}

let timeFormatter;

// A moment's time in a time zone, e.g. "5:42 PM" or "17:42". Uses the Mac's
// locale and its date and time settings, including 24-hour time.
function formatTime(moment, timeZone) {
  if (!timeFormatter) {
    timeFormatter = $.NSDateFormatter.alloc.init;
    timeFormatter.dateStyle = $.NSDateFormatterNoStyle;
    timeFormatter.timeStyle = $.NSDateFormatterShortStyle;
  }
  timeFormatter.timeZone = nsTimeZone(timeZone);
  return timeFormatter.stringFromDate(nsDate(moment)).js;
}

// A UTC offset in minutes as text, e.g. "UTC+13", "UTC+5:45", "UTC−3", "UTC".
function formatUtcOffset(minutes) {
  if (minutes === 0) return "UTC";
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  return `UTC${minutes < 0 ? "−" : "+"}${hours}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

// The flag emoji for a two-letter country code (NZ → 🇳🇿), from the regional
// indicator symbols U+1F1E6–U+1F1FF. Empty if the code is missing or isn't two
// letters.
function flagEmoji(code) {
  if (!/^[A-Za-z]{2}$/.test(code || "")) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}
