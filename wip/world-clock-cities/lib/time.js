// Time zone calculations, and reading times typed after the keyword.
// Loaded by results.js.

// True when the query is a time to convert rather than a city filter.
function isTimeQuery(query) {
  return /^\d/.test(query);
}

// UTC offset of a time zone at a moment, daylight saving included, e.g.
// "UTC+13", "UTC+5:30", "UTC".
function utcOffset(timeZone, date = new Date()) {
  const part = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName");
  const offset = part ? part.value.replace(/^GMT/, "") : "";
  return offset && offset !== "+0" ? `UTC${offset}` : "UTC";
}
