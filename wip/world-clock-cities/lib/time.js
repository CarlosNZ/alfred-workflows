// Time zone calculations, and reading times typed after the keyword.
// Loaded by results.js; needs Foundation imported.
//
// Functions that depend on a moment take it as a Date, so the city list (now)
// and the time mode (a typed time) share them. They return values, not text;
// lib/format.js turns values into text.

// The working day, as hours of the day in each city's local time.
// TO-DO: read the working day from User Configuration.
const WORKING_DAY = { wake: 7, start: 9, end: 17, sleep: 22 };

// True when the query is a time to convert rather than a city filter.
function isTimeQuery(query) {
  return /^\d/.test(query);
}

// IANA name of the Mac's current time zone, e.g. "Pacific/Auckland".
function macTimeZone() {
  return $.NSTimeZone.localTimeZone.name.js;
}

const nsTimeZones = {};

// NSTimeZone for an IANA name, cached. Accepts aliases such as Asia/Katmandu.
function nsTimeZone(timeZone) {
  if (!(timeZone in nsTimeZones)) {
    const zone = $.NSTimeZone.timeZoneWithName(timeZone);
    if (zone.isNil()) throw new Error(`Unknown time zone ${timeZone}`);
    nsTimeZones[timeZone] = zone;
  }
  return nsTimeZones[timeZone];
}

// The Foundation date for a JavaScript Date.
function nsDate(date) {
  return $.NSDate.dateWithTimeIntervalSince1970(date.getTime() / 1000);
}

// UTC offset of a time zone at a moment, daylight saving included, in minutes
// (780 for UTC+13).
function utcOffsetMinutes(timeZone, moment) {
  return nsTimeZone(timeZone).secondsFromGMTForDate(nsDate(moment)) / 60;
}

const partsFormatters = {};

// The calendar date and time of day at a moment in a time zone, as numbers:
// { year, month (1–12), day, weekday (0 Sunday – 6 Saturday), hour (0–23), minute }.
function zonedParts(timeZone, moment) {
  if (!partsFormatters[timeZone]) {
    partsFormatters[timeZone] = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
  }
  const parts = {};
  for (const { type, value } of partsFormatters[timeZone].formatToParts(moment)) {
    if (type !== "literal") parts[type] = Number(value);
  }
  const { year, month, day, hour, minute } = parts;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, weekday, hour, minute };
}

// Whole days between the calendar dates in two time zones at a moment: 1 when
// it's already tomorrow in timeZone, −1 when it's still yesterday.
function dayOffset(timeZone, referenceZone, moment) {
  return (calendarDay(zonedParts(timeZone, moment)) - calendarDay(zonedParts(referenceZone, moment))) / 86400000;
}

// A calendar date as a UTC timestamp, for comparing and stepping dates.
function calendarDay({ year, month, day }) {
  return Date.UTC(year, month - 1, day);
}

// The time zone's next change of UTC offset after a moment, as
// { date, shiftMinutes } (e.g. +60 when clocks go forward), or null if it has
// none scheduled.
function nextClockChange(timeZone, moment) {
  const zone = nsTimeZone(timeZone);
  const next = zone.nextDaylightSavingTimeTransitionAfterDate(nsDate(moment));
  if (next.isNil()) return null;

  const date = new Date(next.timeIntervalSince1970 * 1000);
  const before = zone.secondsFromGMTForDate(nsDate(new Date(date.getTime() - 1000)));
  const after = zone.secondsFromGMTForDate(next);
  return { date, shiftMinutes: (after - before) / 60 };
}

// The first city, in Clock's order, that keeps the same time as the Mac: the
// same UTC offset at the moment and the same next clock change. Compared by
// offset rather than zone name because aliases don't resolve (Australia/Canberra
// is never reported as Australia/Sydney). Returns undefined if there's none.
function findLocalCity(cities, moment, timeZone = macTimeZone()) {
  const fingerprint = (zone) => {
    const change = nextClockChange(zone, moment);
    return [utcOffsetMinutes(zone, moment), change && change.date.getTime(), change && change.shiftMinutes].join();
  };
  const local = fingerprint(timeZone);
  return cities.find((city) => fingerprint(city.timeZone) === local);
}

// Where a local time of day falls in the working day: "asleep", "morning",
// "working" or "evening".
function workingStatus({ hour, minute }, day = WORKING_DAY) {
  const time = hour + minute / 60;
  const within = (from, to) => (from <= to ? time >= from && time < to : time >= from || time < to);
  if (within(day.start, day.end)) return "working";
  if (within(day.wake, day.start)) return "morning";
  if (within(day.end, day.sleep)) return "evening";
  return "asleep";
}
