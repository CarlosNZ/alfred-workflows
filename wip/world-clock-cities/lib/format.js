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
// locale and its date and time settings, including 24-hour time. The narrow
// no-break space the formatter puts before AM/PM (U+202F) becomes an ordinary
// space, since Alfred's font draws it too narrow to see.
function formatTime(moment, timeZone) {
  if (!timeFormatter) {
    timeFormatter = $.NSDateFormatter.alloc.init;
    timeFormatter.dateStyle = $.NSDateFormatterNoStyle;
    timeFormatter.timeStyle = $.NSDateFormatterShortStyle;
  }
  timeFormatter.timeZone = nsTimeZone(timeZone);
  return timeFormatter.stringFromDate(nsDate(moment)).js.replace(/ /g, " ");
}

const templateFormatters = {};

// A moment in a time zone, with a date format template such as "EEE" (short
// weekday) or "EEE d MMM y", arranged and translated for the Mac's locale.
function formatWithTemplate(moment, timeZone, template) {
  if (!templateFormatters[template]) {
    const formatter = $.NSDateFormatter.alloc.init;
    formatter.setLocalizedDateFormatFromTemplate(template);
    templateFormatters[template] = formatter;
  }
  const formatter = templateFormatters[template];
  formatter.timeZone = nsTimeZone(timeZone);
  return formatter.stringFromDate(nsDate(moment)).js;
}

// A signed number of minutes as hours and minutes, e.g. "+11h", "−2h",
// "−7h 15m", "+30m", "±0h". For offsets and clock changes, which are exact.
function formatSignedDuration(minutes) {
  if (minutes === 0) return "±0h";
  const total = Math.abs(Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const parts = [hours && `${hours}h`, rest && `${rest}m`].filter(Boolean);
  return `${minutes < 0 ? "−" : "+"}${parts.join(" ")}`;
}

// A length of time rounded for a glance: to the nearest hour from an hour up
// ("2h"), and to the minute below that ("41m"). Null under half a minute.
function formatRoughDuration(minutes) {
  const rounded = Math.round(minutes);
  if (rounded === 0) return null;
  return rounded < 60 ? `${rounded}m` : `${Math.round(minutes / 60)}h`;
}

// A length of time in hours and minutes, e.g. "14h 6m", "45m", "0m".
function formatDuration(minutes) {
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  return hours ? `${hours}h ${total % 60}m` : `${total}m`;
}

const SUN_EVENT_WORDS = { sunrise: "Sunrise", sunset: "Sunset" };
const POLAR_WORDS = { midnightSun: "Midnight sun", polarNight: "Polar night" };

// The nearer of the previous and next sunrise or sunset, relative to the
// moment: "Sunset in 2h", "Sunrise 41m ago", "Sunset now". During polar day or
// night, "Midnight sun" or "Polar night". Empty without sun values.
function formatNearestSunEvent(info) {
  if (info.polar) return POLAR_WORDS[info.polar];
  const moment = info.moment.getTime();
  const candidates = [info.previousSunEvent, info.nextSunEvent].filter(Boolean);
  if (candidates.length === 0) return "";
  const event = candidates.reduce((a, b) =>
    Math.abs(a.date.getTime() - moment) <= Math.abs(b.date.getTime() - moment) ? a : b,
  );
  const minutes = (event.date.getTime() - moment) / 60000;
  const duration = formatRoughDuration(Math.abs(minutes));
  const word = SUN_EVENT_WORDS[event.type];
  if (!duration) return `${word} now`;
  return minutes > 0 ? `${word} in ${duration}` : `${word} ${duration} ago`;
}

const CLOCK_CHANGE_SOON_DAYS = 7;

// The city's next clock change when it's within a week of the moment, e.g.
// "Clocks go back Sun (−1h)", "Clocks go forward tomorrow (+1h)". Empty
// otherwise.
function formatSoonClockChange(info) {
  const change = info.nextClockChange;
  if (!change || change.date - info.moment > CLOCK_CHANGE_SOON_DAYS * 86400000) return "";
  const days = calendarDaysBetween(info.timeZone, info.moment, change.date);
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : formatWithTemplate(change.date, info.timeZone, "EEE");
  return `${clockChangeWords(change)} ${when} (${formatSignedDuration(change.shiftMinutes)})`;
}

function clockChangeWords(change) {
  return change.shiftMinutes > 0 ? "Clocks go forward" : "Clocks go back";
}

const DAYLIGHT_STATE_WORDS = {
  day: "Daylight",
  goldenHour: "Golden hour",
  civilTwilight: "Civil twilight",
  nauticalTwilight: "Nautical twilight",
  astronomicalTwilight: "Astronomical twilight",
  night: "Night",
};

const WORKING_STATUS_WORDS = {
  morning: "Early morning",
  working: "Working",
  evening: "Evening",
  asleep: "Asleep",
};

// The country for a subtitle, e.g. "New Zealand". Empty for a city-state
// (Singapore), where the title already names the country. Clock marks some
// city-states with countryOnly, but not all, so a country with the same name
// as the city counts too.
function formatCountry(info) {
  const country = displayCountry(info) || "";
  const isCityState = info.countryOnly || foldText(country) === foldText(info.name);
  return isCityState ? "" : country;
}

const HOME = "\u{1F3E0}\uFE0F";

const TITLE_DIVIDER = " • ";
const SUBTITLE_DIVIDER = " | ";

// The list's title: the time, the weekday when the city's date differs from
// the Mac's, the city, 🏠 for the local city, and the country's flag. E.g.
// "1:33 AM Wednesday • Los Angeles • 🇺🇸". The flag is in the title rather
// than the subtitle so that it's shown at a readable size.
function listTitle(info) {
  const weekday = info.dayOffset ? ` ${formatWithTemplate(info.moment, info.timeZone, "EEEE")}` : "";
  const home = info.isLocal ? ` ${HOME}` : "";
  return [`${formatTime(info.moment, info.timeZone)}${weekday}`, `${info.name}${home}`, flagEmoji(info.countryCode)]
    .filter(Boolean)
    .join(TITLE_DIVIDER);
}

// The list's subtitle: country, offset from the local city, and the clock
// change when one is within a week, otherwise the nearest sunrise or sunset.
// E.g. "Australia | −2h | Sunset 41m ago".
function listSubtitle(info) {
  return [
    formatCountry(info),
    info.isLocal ? "" : formatSignedDuration(info.offsetFromLocalMinutes),
    formatSoonClockChange(info) || formatNearestSunEvent(info),
  ]
    .filter(Boolean)
    .join(SUBTITLE_DIVIDER);
}

// The sun details shown while ⌃ is held, e.g. "Nautical twilight | Sunrise
// 5:45 AM | Sunset 7:52 PM | Day 14h 6m (+2m/day)". Empty without sun values.
function sunDetails(info) {
  if (!info.daylightState) return "";
  const parts = [DAYLIGHT_STATE_WORDS[info.daylightState]];
  if (info.polar) {
    parts.push(POLAR_WORDS[info.polar]);
  } else {
    parts.push(`Sunrise ${formatTime(info.sunrise, info.timeZone)}`, `Sunset ${formatTime(info.sunset, info.timeZone)}`);
  }
  parts.push(`Day ${formatDayLength(info)}`);
  return parts.join(SUBTITLE_DIVIDER);
}

// The day length and its change since yesterday, e.g. "14h 6m (+2m/day)".
function formatDayLength(info) {
  const length = formatDuration(info.dayLengthMinutes);
  if (info.dayLengthChangeMinutes == null) return length;
  const change = Math.round(info.dayLengthChangeMinutes);
  return `${length} (${change === 0 ? "±0m" : formatSignedDuration(change)}/day)`;
}

// Everything about a city, one item per line, for Large Type.
function largeTypeText(info) {
  const lines = [
    [info.name, info.countryOnly ? "" : displayCountry(info)].filter(Boolean).join(", "),
    `${formatTime(info.moment, info.timeZone)} ${formatWithTemplate(info.moment, info.timeZone, "EEEE")}`,
    `${formatUtcOffset(info.utcOffsetMinutes)}${info.isLocal ? ", local" : ` (${formatSignedDuration(info.offsetFromLocalMinutes)} from local)`}`,
  ];
  const change = info.nextClockChange;
  if (change) {
    lines.push(
      `${clockChangeWords(change)} ${formatWithTemplate(change.date, info.timeZone, "EEE d MMM y")} (${formatSignedDuration(change.shiftMinutes)})`,
    );
  }
  lines.push(WORKING_STATUS_WORDS[info.workingStatus]);
  if (info.daylightState) {
    const words = [dayPhaseWord(info.dayPhase), DAYLIGHT_STATE_WORDS[info.daylightState]].filter(Boolean);
    lines.push([...new Set(words)].join(" · "));
    if (!info.polar) {
      lines.push(`Sunrise ${formatTime(info.sunrise, info.timeZone)} · Sunset ${formatTime(info.sunset, info.timeZone)}`);
    }
    lines.push(formatNearestSunEvent(info), `Day ${formatDayLength(info)}`);
  }
  return lines.join("\n");
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
