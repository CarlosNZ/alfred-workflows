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

// The time formats of the User Configuration's time_format: "system" follows
// the Mac's 24-hour time setting (System Settings › General › Date & Time),
// and "12" and "24" override it. Each has its date format template, arranged
// for the Mac's locale: "5:42 PM", or "17:42" and "09:05", with the hour
// padded as 24-hour time usually has it.
const TIME_FORMAT_TEMPLATES = { system: null, 12: "hmma", 24: "HHmm" };

// The time formats, for code outside this file, which can't see its constants.
function allTimeFormats() {
  return Object.keys(TIME_FORMAT_TEMPLATES);
}

// The time format formatTime uses, from the User Configuration's
// time_format. An unset or unknown value is "system".
function timeFormat() {
  const format = environmentValue("time_format");
  return allTimeFormats().includes(format) ? format : "system";
}

// A moment's time in a time zone, in the chosen time format (timeFormat),
// e.g. "5:42 PM" or "17:42".
function formatTime(moment, timeZone) {
  return formatTimeAs(timeFormat(), moment, timeZone);
}

const timeFormatters = {};

// A moment's time in a time zone in one of allTimeFormats(), in the Mac's
// locale. The narrow no-break space the formatter puts before AM/PM (U+202F)
// becomes an ordinary space, since Alfred's font draws it too narrow to see.
//
// The 12- and 24-hour formats use a locale made from the Mac's locale's
// identifier rather than the current locale itself, which carries the Mac's
// 24-hour time setting and applies it to any format: with it on, "hmma" gives
// "20:58" (tested). The new locale arranges the time the same way but leaves
// the setting out.
function formatTimeAs(format, moment, timeZone) {
  if (!timeFormatters[format]) {
    const formatter = $.NSDateFormatter.alloc.init;
    const template = TIME_FORMAT_TEMPLATES[format];
    if (template) {
      formatter.locale = $.NSLocale.localeWithLocaleIdentifier($.NSLocale.currentLocale.localeIdentifier);
      formatter.setLocalizedDateFormatFromTemplate(template);
    } else {
      formatter.dateStyle = $.NSDateFormatterNoStyle;
      formatter.timeStyle = $.NSDateFormatterShortStyle;
    }
    timeFormatters[format] = formatter;
  }
  const formatter = timeFormatters[format];
  formatter.timeZone = nsTimeZone(timeZone);
  return formatter.stringFromDate(nsDate(moment)).js.replace(/\u202F/g, " ");
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

// An offset from the local city, e.g. "+11 hrs", "−1 hr", "−7h 15m", "+15m",
// "±0 hrs". Whole hours are spelled out so they're closer in length to the
// offsets with minutes.
function formatOffsetFromLocal(minutes) {
  if (minutes === 0) return "±0 hrs";
  if (minutes % 60 !== 0) return formatSignedDuration(minutes);
  const hours = Math.abs(minutes) / 60;
  return `${minutes < 0 ? "−" : "+"}${hours} ${hours === 1 ? "hr" : "hrs"}`;
}

// A length of time rounded for a glance: to the nearest hour from an hour up
// ("2h"), and to the minute below that ("41m"). Null under half a minute.
function formatRoughDuration(minutes) {
  const rounded = Math.round(minutes);
  if (rounded === 0) return null;
  return rounded < 60 ? `${rounded}m` : `${Math.round(minutes / 60)}h`;
}

// A length of time in exact hours and minutes, leaving out a part that's zero:
// "2h 30m", "3h", "45m", "0m".
function formatHoursMinutes(minutes) {
  const total = Math.round(minutes);
  const parts = [Math.floor(total / 60) && `${Math.floor(total / 60)}h`, total % 60 && `${total % 60}m`];
  return parts.filter(Boolean).join(" ") || "0m";
}

// A length of time in hours and minutes, e.g. "14h 6m", "45m", "0m".
function formatDuration(minutes) {
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  return hours ? `${hours}h ${total % 60}m` : `${total}m`;
}

const SUN_EVENT_WORDS = { sunrise: "Sunrise", sunset: "Sunset" };
const POLAR_WORDS = { midnightSun: "Midnight sun", polarNight: "Polar night" };

// "Midnight sun" or "Polar night" when the sun doesn't cross the horizon on
// the city's date; empty otherwise.
function formatPolar(info) {
  return info.polar ? POLAR_WORDS[info.polar] : "";
}

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

// ☀ with the text variation selector, so it's drawn as a symbol rather than an
// emoji.
const SUN = "☀︎";

// The city's sunrise and sunset today, for clock mode's subtitle, e.g. "☀↑ 7:28
// AM  ☀↓ 4:03 PM". During polar day or night, "Midnight sun" or "Polar
// night". Empty without sun values.
function formatSunTimes(info) {
  if (info.polar) return formatPolar(info);
  if (!info.sunrise || !info.sunset) return "";
  return `${SUN}↑ ${formatTime(info.sunrise, info.timeZone)}  ${SUN}↓ ${formatTime(info.sunset, info.timeZone)}`;
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

function clockChangeWords(change, past = false) {
  const direction = change.shiftMinutes > 0 ? "forward" : "back";
  return `Clocks ${past ? "went" : "go"} ${direction}`;
}

// The clock change between now and a typed time, named from now, e.g. "Clocks
// go back Sun (−1h)", "Clocks went forward yesterday (+1h)", or with a date
// when it's more than 6 days away: "Clocks go back 28 Mar (−1h)". Empty when
// there's none.
function formatClockChangeFromNow(info) {
  const change = info.clockChangeFromNow;
  if (!change) return "";
  const days = change.daysFromNow;
  const when =
    { "-1": "yesterday", 0: "today", 1: "tomorrow" }[days] ||
    formatWithTemplate(change.date, info.timeZone, Math.abs(days) <= 6 ? "EEE" : "d MMM");
  return `${clockChangeWords(change, change.isPast)} ${when} (${formatSignedDuration(change.shiftMinutes)})`;
}

// The daylight states worth naming beside the sun's elevation. Day and night
// are left out: the phase of the day's tile already shows them.
const DAYLIGHT_STATE_WORDS = {
  goldenHour: "Golden hour",
  civilTwilight: "Civil twilight",
  nauticalTwilight: "Nautical twilight",
  astronomicalTwilight: "Astronomical twilight",
};

const WORKING_STATUS_WORDS = {
  morning: "Early morning",
  working: "Working",
  evening: "Evening",
  asleep: "Asleep",
  weekend: "Weekend",
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

const DAY_OFFSET_WORDS = { "-1": "Yesterday", 1: "Tomorrow" };

// Clock mode's title: the time, "Yesterday" or "Tomorrow" when the city's date
// differs from the Mac's, the city, and the country's flag. E.g. "11:33 PM
// Yesterday • Los Angeles • 🇺🇸". The flag is in the title rather than the
// subtitle so that it's shown at a readable size.
function clockTitle(info) {
  const day = DAY_OFFSET_WORDS[info.dayOffset] ? ` ${DAY_OFFSET_WORDS[info.dayOffset]}` : "";
  return [`${formatTime(info.moment, info.timeZone)}${day}`, info.name, flagEmoji(info.countryCode)]
    .filter(Boolean)
    .join(TITLE_DIVIDER);
}

// Clock mode's subtitle: offset from the local city (🏠 for the local city
// itself) and the UTC offset, country, and the clock change when one is
// within a week, otherwise the day's sunrise and sunset. E.g. "−2 hrs
// (UTC+11) | Australia | ☀↑ 5:46 AM  ☀↓ 7:52 PM". At a typed time
// (`atTypedTime`), the clock change is the one between now and then, named
// from now, as in meeting mode: it's why the offsets differ from today's, and
// a change named from the typed time ("tomorrow") would read as from today.
function clockSubtitle(info, atTypedTime = false) {
  const clockChange = atTypedTime ? formatClockChangeFromNow(info) : formatSoonClockChange(info);
  return [formatOffsets(info), formatCountry(info), clockChange || formatSunTimes(info)]
    .filter(Boolean)
    .join(SUBTITLE_DIVIDER);
}

// The offset from the local city (🏠 for the local city itself) and the UTC
// offset, e.g. "−2 hrs (UTC+11)", "🏠 (UTC+13)".
function formatOffsets(info) {
  const offset = info.isLocal ? HOME : formatOffsetFromLocal(info.offsetFromLocalMinutes);
  return `${offset} (${formatUtcOffset(info.utcOffsetMinutes)})`;
}

// Meeting mode's title: the time with the full weekday, the city, and the
// country's flag, e.g. "2:00 PM Thursday • New York • 🇺🇸". Always the weekday,
// since crossing into another day is the main risk when planning a meeting.
function meetingTitle(info) {
  const time = `${formatTime(info.moment, info.timeZone)} ${formatWithTemplate(info.moment, info.timeZone, "EEEE")}`;
  return [time, info.name, flagEmoji(info.countryCode)].filter(Boolean).join(TITLE_DIVIDER);
}

// Meeting mode's subtitle: 🏠 for the local city, country, working status, and
// how far into or out of the working day, e.g. "USA | Working | 3h left", or in
// place of that, a clock change between now and the moment shown, which explains
// why the time differs from what today's offset suggests. No offset, since the
// converted times already show it.
function meetingSubtitle(info) {
  return [
    info.isLocal ? HOME : "",
    formatCountry(info),
    WORKING_STATUS_WORDS[info.workingStatus],
    formatClockChangeFromNow(info) || formatWorkingDayTiming(info.workingDayTiming),
  ]
    .filter(Boolean)
    .join(SUBTITLE_DIVIDER);
}

// A working status's detail, in exact hours and minutes since it decides
// whether a meeting fits: "work in 1h", "2h 30m left", "2h after work", and
// "work just ended" at the end of the working day itself. When weekend days
// come before the next start of work, the day it starts: "work Mon".
function formatWorkingDayTiming({ untilStart, untilEnd, sinceEnd, nextWorkday }) {
  if (untilEnd != null) return `${formatHoursMinutes(untilEnd)} left`;
  if (sinceEnd === 0) return "work just ended";
  if (sinceEnd != null) return `${formatHoursMinutes(sinceEnd)} after work`;
  if (untilStart != null) return `work in ${formatHoursMinutes(untilStart)}`;
  if (nextWorkday != null) return `work ${shortWeekdayName(nextWorkday)}`;
  return "";
}

let shortWeekdayNames;

// A weekday's short name in the Mac's language, e.g. "Mon" for 1.
function shortWeekdayName(weekday) {
  if (!shortWeekdayNames) shortWeekdayNames = ObjC.deepUnwrap($.NSDateFormatter.alloc.init.shortWeekdaySymbols);
  return shortWeekdayNames[weekday];
}

let weekdayNames;

// A weekday's full name in the Mac's language, e.g. "Monday" for 1.
function weekdayName(weekday) {
  if (!weekdayNames) weekdayNames = ObjC.deepUnwrap($.NSDateFormatter.alloc.init.weekdaySymbols);
  return weekdayNames[weekday];
}

// The day length and its change since yesterday, e.g. "14h 6m (+2m/day)".
function formatDayLength(info) {
  const length = formatDuration(info.dayLengthMinutes);
  if (info.dayLengthChangeMinutes == null) return length;
  const change = Math.round(info.dayLengthChangeMinutes);
  return `${length} (${change === 0 ? "±0m" : formatSignedDuration(change)}/day)`;
}

// The detail view's text (see detailUpdate in lib/detail.js).

// A city's date, e.g. "Sunday 22 November 2026", arranged for the Mac's
// locale.
function formatLongDate(moment, timeZone) {
  return formatWithTemplate(moment, timeZone, "EEEEdMMMMy");
}

// The time zone's identifier (with spaces for its underscores, as in
// "America/New York"), its name, its abbreviation when it has one, and its
// UTC offset, e.g. "Pacific/Auckland • New Zealand Daylight Time (NZDT) •
// UTC+13". Also a city result's alternative subtitle (⌃ held, by default).
//
// The names are in the Mac's language, as used in the city's country: the
// formatter only gives the abbreviations common in its locale's region, so
// with the Mac's own region (en_NZ) New York has no "EST" and Kolkata no
// "IST", while en_US and en_IN have them. Where there's no abbreviation, the
// formatter gives "GMT+5:45", which the UTC offset already says, so it's left
// out. London in winter has no name either ("GMT+00:00"), so a zone at UTC+0
// without one takes GMT's: "Greenwich Mean Time (GMT)".
function formatZoneLine(info) {
  const locale = info.countryCode ? `${$.NSLocale.currentLocale.languageCode.js}_${info.countryCode}` : null;
  const isOffset = (text) => /^(GMT|UTC)[+\-−]/.test(text);
  let zone = info.timeZone;
  if (info.utcOffsetMinutes === 0 && isOffset(formatZoneName(info.moment, zone, "zzzz", locale))) zone = "GMT";
  const name = formatZoneName(info.moment, zone, "zzzz", locale);
  const abbreviation = formatZoneName(info.moment, zone, "zzz", locale);
  const named = isOffset(name) ? "" : isOffset(abbreviation) ? name : `${name} (${abbreviation})`;
  return [info.timeZone.replace(/_/g, " "), named, formatUtcOffset(info.utcOffsetMinutes)].filter(Boolean).join(TITLE_DIVIDER);
}

const zoneNameFormatters = {};

// A time zone's name at a moment, in a date format such as "zzzz" (long) or
// "zzz" (abbreviation), for a locale identifier, or the Mac's locale if null.
function formatZoneName(moment, timeZone, format, locale) {
  const key = `${format}|${locale}`;
  if (!zoneNameFormatters[key]) {
    const formatter = $.NSDateFormatter.alloc.init;
    if (locale) formatter.locale = $.NSLocale.localeWithLocaleIdentifier(locale);
    formatter.dateFormat = format;
    zoneNameFormatters[key] = formatter;
  }
  const formatter = zoneNameFormatters[key];
  formatter.timeZone = nsTimeZone(timeZone);
  return formatter.stringFromDate(nsDate(moment)).js;
}

// A clock change as a sentence, told from now: "Clocks go back 1 hour in 3
// days, on Sunday", "Clocks go forward 1 hour tomorrow", "Clocks go back 1
// hour in 5 hours", "Clocks went forward 1 hour yesterday". More than 6 days
// away, with the date: "Clocks go back 1 hour on Sunday 28 March". `change` is
// { date, shiftMinutes }.
function formatClockChangeSentence(change, now, timeZone) {
  const past = change.date < now;
  const shift = formatSpokenDuration(Math.abs(change.shiftMinutes));
  const words = `${clockChangeWords(change, past)} ${shift}`;
  const minutes = Math.abs(change.date - now) / 60000;
  if (minutes < 24 * 60) {
    const distance = formatSpokenRoughDuration(minutes);
    return past ? `${words} ${distance} ago` : `${words} in ${distance}`;
  }
  const days = Math.abs(calendarDaysBetween(timeZone, now, change.date));
  if (days === 1) return `${words} ${past ? "yesterday" : "tomorrow"}`;
  const weekday = formatWithTemplate(change.date, timeZone, "EEEE");
  if (days <= 6) return past ? `${words} ${days} days ago, on ${weekday}` : `${words} in ${days} days, on ${weekday}`;
  return `${words} on ${formatWithTemplate(change.date, timeZone, "EEEEdMMMM")}`;
}

// The sun's elevation, with the daylight state when it's golden hour or a
// twilight, e.g. "Sun elevation: 28.2°", "Sun elevation: −8.5° · Nautical
// twilight". Empty without sun values.
function formatSunElevation(info) {
  if (info.sunElevation == null) return "";
  const elevation = Math.round(info.sunElevation * 10) / 10;
  const text = `Sun elevation: ${elevation < 0 ? "−" : ""}${Math.abs(elevation).toFixed(1)}°`;
  const state = DAYLIGHT_STATE_WORDS[info.daylightState];
  return state ? `${text} · ${state}` : text;
}

// The day length, e.g. "Day length: 10h 47m (+2m/day)". Empty without sun
// values.
function formatDayLengthLine(info) {
  return info.dayLengthMinutes == null ? "" : `Day length: ${formatDayLength(info)}`;
}

// A working status's detail as a sentence, in exact hours and minutes: "Work
// ends in 7h 15m", "Work ended 2h ago", "Work just ended", "Work starts in
// 1h", or the day work starts when weekend days come first: "Work starts
// Monday".
function formatWorkingDaySentence({ untilStart, untilEnd, sinceEnd, nextWorkday }) {
  if (untilEnd != null) return `Work ends in ${formatHoursMinutes(untilEnd)}`;
  if (sinceEnd === 0) return "Work just ended";
  if (sinceEnd != null) return `Work ended ${formatHoursMinutes(sinceEnd)} ago`;
  if (untilStart != null) return `Work starts in ${formatHoursMinutes(untilStart)}`;
  if (nextWorkday != null) return `Work starts ${weekdayName(nextWorkday)}`;
  return "";
}

// The detail view's line above the city in clock mode, now: how far
// its time is from the Mac's, e.g. "11 hours ahead of you", "2 hours 30
// minutes behind you", "Same time as you", or "🏠 Your time zone" for the
// local city.
function formatOffsetFromYou(info) {
  if (info.isLocal) return `${HOME} Your time zone`;
  const minutes = info.offsetFromLocalMinutes;
  if (minutes === 0) return "Same time as you";
  return `${formatSpokenDuration(Math.abs(minutes))} ${minutes > 0 ? "ahead of" : "behind"} you`;
}

// The detail view's line above the city at a typed time, in either mode,
// saying which moment it shows (see detailUpdate in lib/detail.js): "When it's 9:00 PM Sunday in
// London, UK…", "When it's 9:00 PM Sunday for you…" for a time in the Mac's
// zone, or for a relative time, "In 5 hours, at 5:12 PM Sunday for you…" and
// "3 hours ago, at 9:12 AM Sunday for you…". "For you" rather than "here",
// which could be read as the city the view shows.
function formatTypedReference(typed, moment) {
  const when = `${formatTime(moment, typed.timeZone)} ${formatWithTemplate(moment, typed.timeZone, "EEEE")}`;
  if (typed.kind === "relative") {
    if (typed.minutes === 0) return `Now, at ${when} for you…`;
    const distance = formatSpokenDuration(Math.abs(typed.minutes));
    return typed.minutes > 0 ? `In ${distance}, at ${when} for you…` : `${distance} ago, at ${when} for you…`;
  }
  const where = typed.anchor ? `in ${formatPlace(typed.anchor, typed.anchorCountry)}` : "for you";
  return `When it's ${when} ${where}…`;
}

// A city and its country, e.g. "London, UK", or the city alone when it has no
// country or the country has the same name (Singapore).
function formatPlace(name, country) {
  const shown = SHORT_COUNTRY_NAMES[country] || country || "";
  return shown && foldText(shown) !== foldText(name) ? `${name}, ${shown}` : name;
}

// An exact length of time in words: "1 hour", "30 minutes", "1 hour 30
// minutes".
function formatSpokenDuration(minutes) {
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const parts = [hours && plural(hours, "hour"), rest && plural(rest, "minute")].filter(Boolean);
  return parts.join(" ") || plural(0, "minute");
}

// A length of time in words, rounded for a glance: to the nearest hour from an
// hour up ("5 hours"), and to the minute below that ("40 minutes"), at least
// one.
function formatSpokenRoughDuration(minutes) {
  return minutes < 59.5 ? plural(Math.max(1, Math.round(minutes)), "minute") : plural(Math.round(minutes / 60), "hour");
}

// The longest artist credit shown in a picture's tooltip: Commons' Artist
// field is sometimes a paragraph, which the file's page shows in full.
const PICTURE_ARTIST_MOST_CHARACTERS = 80;

// The tooltip over a city's picture in the detail view, from its <slug>.json
// (see fetch-pictures.js): who took it and its licence, e.g. "Photo by Gerd
// Eichmann, CC BY-SA 4.0", then what clicking it does (pictureClick in
// lib/pictures.js). Null when there's nothing to say.
function formatPictureCredit(details) {
  if (!details) return null;
  if (details.file) {
    let artist = details.artist;
    if (artist && artist.length > PICTURE_ARTIST_MOST_CHARACTERS) {
      artist = `${artist.slice(0, PICTURE_ARTIST_MOST_CHARACTERS - 1).trim()}…`;
    }
    const credit = [artist && `Photo by ${artist}`, details.licence].filter(Boolean).join(", ");
    return [credit, "Click to open on Wikimedia Commons"].filter(Boolean).join("\n");
  }
  if (details.url) {
    const host = details.url.match(/^[a-z]+:\/\/([^/?#]+)/i);
    return `Image from ${host ? host[1] : details.url}\nClick to open`;
  }
  if (details.path) return `${details.path.split("/").pop()}\nClick to show in Finder`;
  return null;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
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
