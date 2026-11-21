// Time zone calculations, and reading times typed after the keyword.
// Loaded by results.js; needs Foundation imported.
//
// Functions that depend on a moment take it as a Date, so the city list (now)
// and the time mode (a typed time) share them. They return values, not text;
// lib/format.js turns values into text.

// The working day, as hours of the day in each city's local time.
// TO-DO: read the working day from User Configuration.
const WORKING_DAY = { wake: 7, start: 9, end: 17, sleep: 22 };

// Saturday and Sunday, as weekdays (0 Sunday – 6 Saturday).
const DEFAULT_WEEKEND = new Set([0, 6]);
const weekends = {};

// The weekdays (0 Sunday – 6 Saturday) a country takes off, from the Unicode
// CLDR data that ships with macOS: Friday and Saturday for IL, Sunday alone for
// IN. Saturday and Sunday for a missing or unknown country code, or if the
// data isn't available. It's the country's official weekend: regional
// differences (some Malaysian states), shifted working days and public
// holidays aren't covered.
function weekendDays(countryCode) {
  const code = /^[A-Za-z]{2}$/.test(countryCode || "") ? countryCode.toUpperCase() : "001";
  if (!weekends[code]) {
    const locale = new Intl.Locale(`und-${code}`);
    const info = locale.getWeekInfo ? locale.getWeekInfo() : locale.weekInfo;
    // CLDR numbers the days 1 Monday – 7 Sunday.
    weekends[code] = info ? new Set(info.weekend.map((day) => day % 7)) : DEFAULT_WEEKEND;
  }
  return weekends[code];
}

// True when the query is a time to convert rather than a city filter: it
// starts with a digit, or with +, - or − for a time relative to now.
function isTimeQuery(query) {
  return /^[\d+\-−]/.test(query);
}

// Day names for typed days, indexed by weekday (0 Sunday – 6 Saturday).
const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_ALIASES = { weds: 3 };

// Reads a time query (see "Time input" in README.md) and works out the moment
// it means. Returns one of:
// - { kind: "incomplete" }: not a time yet, but typing more could make it one
//   ("3:2", "8am t"), including a city that matches cities in different zones.
// - { kind: "invalid" }: typing more can't make it a time ("25:00", "13pm").
// - { kind: "unknownCity", place }: the text after the time matches no city.
// - { kind: "clock" | "relative", moment, timeZone, anchor, filter }: the
//   moment (a Date); the zone a clock time was read in, and the name of the
//   city that set it (null for the Mac's zone); and, for a relative time, the
//   text after it, which narrows the list.
function readTypedTime(query, cities, now, macZone = macTimeZone()) {
  const typed = parseTimeInput(query);
  if (typed.kind === "relative") {
    return {
      kind: "relative",
      moment: new Date(now.getTime() + typed.minutes * 60000),
      timeZone: macZone,
      anchor: null,
      filter: typed.filter,
    };
  }
  if (typed.kind !== "clock") return typed;

  let timeZone = macZone;
  let anchor = null;
  if (typed.place) {
    const found = findAnchorCity(cities, typed.place, now);
    if (found.error === "noCity") return { kind: "unknownCity", place: typed.place };
    if (found.error) return { kind: "incomplete" };
    timeZone = found.city.timeZone;
    anchor = found.city.name;
  }
  return { kind: "clock", moment: nextOccurrence(typed, timeZone, now), timeZone, anchor, filter: "" };
}

// The syntax of a time query, without working out a moment. Returns
// { kind: "incomplete" }, { kind: "invalid" },
// { kind: "clock", hour (0–23), minute, weekday (0–6, or null), place } where
// place is the text after the time and day ("" if none), or
// { kind: "relative", minutes (negative for the past), filter }.
function parseTimeInput(query) {
  const relative = query.match(/^([+\-−])(\S*)\s*(.*)$/);
  return relative ? parseRelativeTime(...relative.slice(1)) : parseClockTime(query);
}

// A time relative to now: "+5", "+5h", "+90m", "+1:30", "-3".
function parseRelativeTime(sign, amount, rest) {
  if (!amount) return { kind: rest ? "invalid" : "incomplete" };
  const match = amount.match(/^(\d+)(?:([hm])|:(\d*))?$/i);
  if (!match) return { kind: "invalid" };

  const [, number, unit, minutesText] = match;
  let minutes;
  if (minutesText !== undefined) {
    const extra = readMinutes(minutesText);
    if (typeof extra === "string") return { kind: extra };
    minutes = Number(number) * 60 + extra;
  } else {
    minutes = Number(number) * (unit && unit.toLowerCase() === "m" ? 1 : 60);
  }
  return { kind: "relative", minutes: sign === "+" ? minutes : -minutes, filter: rest };
}

// A time of day, then optionally a day and a city: "3:25p", "12:00 mon",
// "9am London". The groups are the hour, the minutes after a colon, am or pm
// (alone, or followed by a space), and the rest.
function parseClockTime(query) {
  const match = query.match(/^(\d+)(?::(\d*))?\s*(?:(am?|pm?)(?=\s|$))?(?:\s+(.*))?$/i);
  if (!match) return { kind: "invalid" };

  const [, hourText, minutesText, meridiem, rest = ""] = match;
  let hour = Number(hourText);
  if (hourText.length > 2 || hour > (meridiem ? 12 : 23)) return { kind: "invalid" };
  const minute = minutesText === undefined ? 0 : readMinutes(minutesText);
  if (typeof minute === "string") return { kind: minute };
  // 12am is midnight and 12pm is noon.
  if (meridiem) hour = (hour % 12) + (/^p/i.test(meridiem) ? 12 : 0);

  const [first = "", ...others] = rest.split(/\s+/);
  const weekday = typedWeekday(first);
  if (weekday === "ambiguous") return { kind: "incomplete" };
  return {
    kind: "clock",
    hour,
    minute,
    weekday,
    place: weekday === null ? rest : others.join(" "),
  };
}

// Two digits of minutes, 00–59, as a number; "incomplete" while one or none is
// typed and more could still make valid minutes, otherwise "invalid".
function readMinutes(text) {
  if (text.length < 2) return text === "" || Number(text) <= 5 ? "incomplete" : "invalid";
  return text.length === 2 && Number(text) <= 59 ? Number(text) : "invalid";
}

// The weekday a word names: any prefix of one day's name ("tu", "thurs"), or
// "weds", in any case. Null when it names no day, "ambiguous" for a prefix
// of several ("t", "s").
function typedWeekday(word) {
  const text = word.toLowerCase();
  if (!text) return null;
  if (text in DAY_ALIASES) return DAY_ALIASES[text];
  const days = DAY_NAMES.flatMap((name, weekday) => (name.startsWith(text) ? [weekday] : []));
  if (days.length > 1) return "ambiguous";
  return days.length === 1 ? days[0] : null;
}

// The next moment, at or after `now`, when a time zone's clocks show a time of
// day, on the given weekday if there is one. A time in the current minute counts
// as now: at 3:00:27 PM, 3:00 PM is today.
function nextOccurrence({ hour, minute, weekday }, timeZone, now) {
  const today = zonedParts(timeZone, now);
  const earliest = Math.floor(now.getTime() / 60000) * 60000;
  const step = weekday === null ? 1 : 7;
  for (let days = weekday === null ? 0 : (weekday - today.weekday + 7) % 7; ; days += step) {
    const moment = zonedMoments(timeZone, today.year, today.month, today.day + days, hour, minute).find(
      (time) => time >= earliest,
    );
    if (moment !== undefined) return new Date(moment);
  }
}

// The moments, as sorted timestamps, at which a time zone's clocks show a date
// and time. Usually one; two when the clocks go back and the time happens
// twice. When the clocks go forward past the time, it's read with the offset
// from before the change, as calendar apps do: 2:30 AM, when clocks go forward
// at 2 AM, is the moment the clocks show 3:30 AM. The day may overflow the
// month (32 January is 1 February).
function zonedMoments(timeZone, year, month, day, hour, minute) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // A zone's offset changes at most once in two days, so the offsets a day
  // either side are the ones the time could have.
  const [before, after] = [wall - 86400000, wall + 86400000].map((time) => utcOffsetMinutes(timeZone, new Date(time)));
  const moments = [...new Set([before, after])]
    .map((offset) => wall - offset * 60000)
    .filter((time) => utcOffsetMinutes(timeZone, new Date(time)) * 60000 === wall - time)
    .sort((a, b) => a - b);
  return moments.length ? moments : [wall - before * 60000];
}

// The current time, or for testing, the moment in WCC_NOW: an ISO 8601 date and
// time such as "2026-09-26T12:00+12:00" or "2026-09-26T00:00Z".
function currentTime() {
  const override = environmentValue("WCC_NOW");
  if (!override) return new Date();
  const date = new Date(override);
  if (isNaN(date)) throw new Error(`WCC_NOW isn't an ISO 8601 date and time: ${override}`);
  return date;
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

// Whole calendar days from one moment's date to another's in a time zone: 1
// when `to` falls tomorrow there, even if it's only minutes later.
function calendarDaysBetween(timeZone, from, to) {
  return (calendarDay(zonedParts(timeZone, to)) - calendarDay(zonedParts(timeZone, from))) / 86400000;
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

// The clock change between now and a moment (in either order) that makes the
// time zone's UTC offset differ at the two, as { date, shiftMinutes,
// daysFromNow, isPast }: the last change before the later of the two, the
// calendar days from now's date to its date in the zone (negative when it's on
// an earlier day), and whether it's before now. Null
// when the offset is the same at both, including when changes in between
// cancel out.
function clockChangeFromNow(timeZone, now, moment) {
  if (utcOffsetMinutes(timeZone, now) === utcOffsetMinutes(timeZone, moment)) return null;
  const [earlier, later] = now <= moment ? [now, moment] : [moment, now];
  let last = null;
  for (let change = nextClockChange(timeZone, earlier); change && change.date <= later; ) {
    last = change;
    change = nextClockChange(timeZone, new Date(change.date.getTime() + 1000));
  }
  return last && { ...last, daysFromNow: calendarDaysBetween(timeZone, now, last.date), isPast: last.date < now };
}

// The first city, in Clock's order, that keeps the same time as the Mac: the
// same UTC offset at the moment and the same next clock change. Compared by
// offset rather than zone name because aliases don't resolve (Australia/Canberra
// is never reported as Australia/Sydney). Returns undefined if there's none.
function findLocalCity(cities, moment, timeZone = macTimeZone()) {
  const local = clockKey(timeZone, moment);
  return cities.find((city) => clockKey(city.timeZone, moment) === local);
}

// A string that's the same for two time zones when they keep the same time
// from a moment until their next clock change: the same UTC offset at the
// moment, and the same next change.
function clockKey(timeZone, moment) {
  const change = nextClockChange(timeZone, moment);
  return [utcOffsetMinutes(timeZone, moment), change && change.date.getTime(), change && change.shiftMinutes].join();
}

// Where a local time falls in the working day: "asleep", "morning", "working"
// or "evening", or "weekend" for any but the asleep hours of a day in
// `weekend`, the weekdays the city's country takes off.
function workingStatus({ weekday, hour, minute }, weekend = DEFAULT_WEEKEND, day = WORKING_DAY) {
  const time = hour + minute / 60;
  const within = (from, to) => (from <= to ? time >= from && time < to : time >= from || time < to);
  let status = "asleep";
  if (within(day.start, day.end)) status = "working";
  else if (within(day.wake, day.start)) status = "morning";
  else if (within(day.end, day.sleep)) status = "evening";
  return status !== "asleep" && weekend.has(weekday) ? "weekend" : status;
}

// How a local time stands to the working day, for a working status's detail:
// { untilEnd } minutes while working, { sinceEnd } minutes in the evening, and
// otherwise the next start of work: { untilStart } minutes when it's the next
// day's start, or { nextWorkday } (a weekday) when weekend days come first,
// e.g. on a Friday night. Empty if every day is a weekend day.
function workingDayTiming({ weekday, hour, minute }, status, weekend = DEFAULT_WEEKEND, day = WORKING_DAY) {
  const time = hour * 60 + minute;
  const minutesFrom = (from, to) => (((to - from) % 1440) + 1440) % 1440;
  if (status === "working") return { untilEnd: minutesFrom(time, day.end * 60) };
  if (status === "evening") return { sinceEnd: minutesFrom(day.end * 60, time) };

  // Today's start of work if it's still to come, otherwise tomorrow's, then
  // past any weekend days.
  const first = time < day.start * 60 ? 0 : 1;
  let days = first;
  while (weekend.has((weekday + days) % 7) && days < first + 7) days++;
  if (weekend.has((weekday + days) % 7)) return {};
  return days === first ? { untilStart: minutesFrom(time, day.start * 60) } : { nextWorkday: (weekday + days) % 7 };
}
