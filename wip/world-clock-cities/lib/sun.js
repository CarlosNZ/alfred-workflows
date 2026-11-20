// The sun's position, sunrise and sunset, from a city's coordinates.
// Loaded by results.js; uses utcOffsetMinutes from time.js.
//
// The NOAA solar calculator's algorithm (after Meeus, "Astronomical
// Algorithms"): accurate to about a minute for sunrise and sunset, and offline.
// Elevations are geometric (no refraction correction); the horizon is taken as
// −0.833° to allow for refraction and the size of the sun's disc.

const HORIZON = -0.833;

// Daylight states by the sun's elevation, highest first. Each band runs down to
// its elevation; below the last is night.
const DAYLIGHT_BANDS = [
  [6, "day"],
  [HORIZON, "goldenHour"],
  [-6, "civilTwilight"],
  [-12, "nauticalTwilight"],
  [-18, "astronomicalTwilight"],
];

const DAY_MS = 86400000;
const MINUTE_MS = 60000;
const RAD = Math.PI / 180;

const sinDeg = (x) => Math.sin(x * RAD);
const cosDeg = (x) => Math.cos(x * RAD);

// The sun's declination (degrees) and the equation of time (minutes) at a
// moment.
function solarCoordinates(moment) {
  const t = (moment.getTime() / DAY_MS + 2440587.5 - 2451545) / 36525; // Julian centuries since J2000
  const meanLongitude = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre =
    sinDeg(meanAnomaly) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    sinDeg(2 * meanAnomaly) * (0.019993 - 0.000101 * t) +
    sinDeg(3 * meanAnomaly) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = meanLongitude + centre - 0.00569 - 0.00478 * sinDeg(omega);
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * cosDeg(omega);

  const declination = Math.asin(sinDeg(obliquity) * sinDeg(apparentLongitude)) / RAD;
  const y = Math.tan((obliquity / 2) * RAD) ** 2;
  const equationOfTime =
    (4 / RAD) *
    (y * sinDeg(2 * meanLongitude) -
      2 * eccentricity * sinDeg(meanAnomaly) +
      4 * eccentricity * y * sinDeg(meanAnomaly) * cosDeg(2 * meanLongitude) -
      0.5 * y * y * sinDeg(4 * meanLongitude) -
      1.25 * eccentricity * eccentricity * sinDeg(2 * meanAnomaly));
  return { declination, equationOfTime };
}

// The sun's elevation above the horizon at a moment, in degrees.
function sunElevation(latitude, longitude, moment) {
  const { declination, equationOfTime } = solarCoordinates(moment);
  const utcMinutes = (moment.getTime() % DAY_MS) / MINUTE_MS;
  const hourAngle = (utcMinutes + equationOfTime + 4 * longitude) / 4 - 180;
  const cosZenith =
    sinDeg(latitude) * sinDeg(declination) + cosDeg(latitude) * cosDeg(declination) * cosDeg(hourAngle);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) / RAD;
}

// The daylight state for an elevation: "day", "goldenHour", "civilTwilight",
// "nauticalTwilight", "astronomicalTwilight" or "night".
function daylightState(elevation) {
  const band = DAYLIGHT_BANDS.find(([lowest]) => elevation > lowest);
  return band ? band[1] : "night";
}

// Solar noon at a longitude: the one nearest the given moment.
// Returns a timestamp.
function solarNoonNear(longitude, moment) {
  const noonAfter = (midnight, at) =>
    midnight + (720 - 4 * longitude - solarCoordinates(new Date(at)).equationOfTime) * MINUTE_MS;
  let midnight = Math.floor(moment.getTime() / DAY_MS) * DAY_MS;
  midnight += Math.round((moment.getTime() - noonAfter(midnight, moment.getTime())) / DAY_MS) * DAY_MS;
  // The second pass takes the equation of time at the estimated noon itself.
  return noonAfter(midnight, noonAfter(midnight, moment.getTime()));
}

// Half the time the sun spends above the horizon on a day, in minutes, or
// Infinity (midnight sun) or 0 (polar night) when it never crosses it.
function halfDayMinutes(latitude, declination) {
  const cosHourAngle =
    (sinDeg(HORIZON) - sinDeg(latitude) * sinDeg(declination)) / (cosDeg(latitude) * cosDeg(declination));
  if (cosHourAngle < -1) return Infinity;
  if (cosHourAngle > 1) return 0;
  return (4 * Math.acos(cosHourAngle)) / RAD;
}

// Sunrise and sunset for the solar day around a solar noon. Returns
// { sunrise, sunset, polar }: Dates, or nulls with polar "midnightSun" or
// "polarNight" when the sun doesn't cross the horizon that day.
function sunEvents(latitude, longitude, noon) {
  const half = halfDayMinutes(latitude, solarCoordinates(new Date(noon)).declination);
  if (half === Infinity) return { sunrise: null, sunset: null, polar: "midnightSun" };
  if (half === 0) return { sunrise: null, sunset: null, polar: "polarNight" };

  // Refine each event once with the sun's declination at its first estimate,
  // which matters near the poles. The equation of time drifts by under 30
  // seconds a day, so noon stays as it is.
  const refine = (sign) => {
    const estimate = new Date(noon + sign * half * MINUTE_MS);
    const refined = halfDayMinutes(latitude, solarCoordinates(estimate).declination);
    const minutes = refined === Infinity || refined === 0 ? half : refined;
    return new Date(noon + sign * minutes * MINUTE_MS);
  };
  return { sunrise: refine(-1), sunset: refine(1), polar: null };
}

// Sunrise and sunset for a calendar date in a city's time zone, using the
// solar noon nearest the middle of that date.
function sunEventsOnDay(latitude, longitude, timeZone, day) {
  const approxNoon = new Date(day + DAY_MS / 2);
  const civilNoon = new Date(approxNoon.getTime() - utcOffsetMinutes(timeZone, approxNoon) * MINUTE_MS);
  return sunEvents(latitude, longitude, solarNoonNear(longitude, civilNoon));
}

// Everything about the sun for a city at a moment. `day` is the city's
// calendar date at the moment (see calendarDay in time.js).
function sunInfo(latitude, longitude, timeZone, day, moment) {
  const [yesterday, today, tomorrow] = [-1, 0, 1].map((n) =>
    sunEventsOnDay(latitude, longitude, timeZone, day + n * DAY_MS),
  );
  const elevation = sunElevation(latitude, longitude, moment);

  // Sunrises and sunsets from yesterday to tomorrow, in order. During polar day
  // or night the previous or next one can be weeks away; those are null.
  const events = [yesterday, today, tomorrow]
    .flatMap((day) => [
      { type: "sunrise", date: day.sunrise },
      { type: "sunset", date: day.sunset },
    ])
    .filter((event) => event.date)
    .sort((a, b) => a.date - b.date);
  const previousEvent = events.filter((event) => event.date <= moment).pop() || null;
  const nextEvent = events.find((event) => event.date > moment) || null;

  const length = (day) =>
    day.polar ? (day.polar === "midnightSun" ? 24 * 60 : 0) : (day.sunset - day.sunrise) / MINUTE_MS;
  const dayLengthMinutes = length(today);
  const dayLengthChangeMinutes = today.polar || yesterday.polar ? null : dayLengthMinutes - length(yesterday);

  return {
    sunElevation: elevation,
    daylightState: daylightState(elevation),
    previousSunEvent: previousEvent,
    nextSunEvent: nextEvent,
    sunrise: today.sunrise,
    sunset: today.sunset,
    polar: today.polar,
    dayLengthMinutes,
    dayLengthChangeMinutes,
  };
}
