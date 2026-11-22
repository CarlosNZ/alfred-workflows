// The city detail view, shown inside Alfred with ↩ and in a window of its own
// with ⌘↩. Loaded by results.js, which hands each city to the view through
// workflow variables, and by detail.js, the view's pulse script, which fills
// it in. Its layout is in lib/panel.js. Uses format.js, pictures.js and, in the
// pulse, panel.js.

// The fields of a Clock city record that describeCity reads.
const DETAIL_CITY_FIELDS = [
  "identifier",
  "name",
  "countryName",
  "localeCode",
  "displayNameIncludingCountryUsesOnlyCountry",
  "timeZone",
  "latitude",
  "longitude",
];

// How soon the next clock change must be for the view to tell of it, in the
// now mode.
const DETAIL_CLOCK_CHANGE_DAYS = 7;

// Workflow variables set on a city's result, for the detail view:
// detail_slug names the city (citySlug, from Clock's identifier);
// detail_title is the window's title; detail_clock_change is "1" when the
// view has a line for a clock change (detailClockChange), "0" otherwise.
// panel.zsh uses these to pick the city's package and its layout.
// detail_city is the city's record,
// as JSON, which panel.zsh saves in the package for the pulse script: the
// Clock record, isLocal, and in the meeting mode the typed time (see
// savedTypedTime). Handing over the record spares the pulse reading Clock's
// list every second, which also needs Full Disk Access that the view's own
// process may not have. detail_picture_city is the city's record for the
// picture fetcher (pictureFetchRecord), which panel.zsh starts for this city
// alone if it has no picture yet. ⌘ adds detail_launch (see cityItem in
// results.js). The mode and typed time aren't in the record: every view
// follows the results' latest (see saveShownTime).
function detailVariables(city, info, typed, now) {
  const record = Object.fromEntries(DETAIL_CITY_FIELDS.filter((key) => city[key] != null).map((key) => [key, city[key]]));
  const meeting = Boolean(typed);
  return {
    detail_slug: citySlug(city),
    detail_title: info.name,
    detail_clock_change: detailClockChange(info, meeting, now) ? "1" : "0",
    detail_city: JSON.stringify({ city: record, isLocal: info.isLocal }),
    detail_picture_city: JSON.stringify(pictureFetchRecord(city)),
  };
}

// Where results.js saves the time its results show, for the detail views:
// panels/shown-time.json in the cache, next to the views' packages.
function shownTimePath() {
  return `${workflowCacheDir()}/panels/shown-time.json`;
}

// Saves the time the results show, so every open detail view shows the same:
// { typed: null } for now (the list), or { typed } with the typed time (see
// savedTypedTime). When the testing variables are set, it also saves
// testNow, WCC_NOW's value, and testTimeZone, the Mac's zone as TZ made it,
// since the views' pulse runs in Alfred's UI helper, which doesn't get the
// workflow's variables. results.js calls it whenever a query gives a moment, not
// while a typed time is incomplete or unreadable, so views keep the last
// time until the query gives another. Only written when it changes, since the
// list reruns every second; written to a temporary file and moved into
// place, so a pulse never reads half a file. Errors are logged rather than
// thrown: the views never stop the results.
function saveShownTime(typed, now) {
  try {
    const text = JSON.stringify({
      typed: typed ? savedTypedTime(typed, now) : null,
      testNow: environmentValue("WCC_NOW") || undefined,
      testTimeZone: environmentValue("TZ") ? macTimeZone() : undefined,
    });
    const path = shownTimePath();
    const current = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
    if (!current.isNil() && current.js === text) return;
    $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
      $(path).stringByDeletingLastPathComponent,
      true,
      $(), // nil: no attributes
      null,
    );
    $(text).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
  } catch (error) {
    console.log(`Shown time: ${error}`);
  }
}

// What the views keep of a typed time (from readTypedTime): its kind, the
// zone it was read in and the city that set it, and the moment as an ISO
// string, or for a relative time the minutes from now instead, so the view
// keeps it relative to the clock (detailMoment) and it stays the same from
// one run of the results to the next.
function savedTypedTime(typed, now) {
  return {
    kind: typed.kind,
    timeZone: typed.timeZone,
    anchor: typed.anchor,
    anchorCountry: typed.anchorCountry,
    ...(typed.kind === "relative"
      ? { minutes: Math.round((typed.moment - now) / 60000) }
      : { moment: typed.moment.toISOString() }),
  };
}

// The moment the view shows: now, or in the meeting mode the typed time, which
// for a relative time moves with the clock.
function detailMoment(typed, now) {
  if (!typed) return now;
  if (typed.kind === "relative") return new Date(now.getTime() + typed.minutes * 60000);
  return new Date(typed.moment);
}

// The clock change the view tells of, as { date, shiftMinutes }, or null. In
// the now mode, the next one if it's within DETAIL_CLOCK_CHANGE_DAYS. In the
// meeting mode, the one between now and the typed time, however far, as in the
// time mode's results: it's why the time there differs from what today's
// offset suggests.
function detailClockChange(info, meeting, now) {
  if (meeting) return info.clockChangeFromNow;
  const change = info.nextClockChange;
  return change && change.date - now <= DETAIL_CLOCK_CHANGE_DAYS * 86400000 ? change : null;
}

// The pulse's output for a city: a JSON update of the view's components, by
// id (see lib/panel.js). `typed` is the saved typed time in the meeting mode
// (see savedTypedTime); `picture` is the city's picture state (pictureState);
// `iconsDir` holds the tiles' icons; `layout` says whether the view has a
// picture slot ({ picture }), which sets how wide the city's text can be.
// Ids the view's layout doesn't have (the clock change line, say) are
// ignored by Alfred. The labels that can be too long get a font that fits
// their text (fittedFont), sent every time, since the text can change.
//
// The two modes fill the same components, so a window can switch between
// them: the context line is the offset from you (now) or the typed time
// (meeting); the tile is the phase of the day or the working status; and the
// sun details are the sun's elevation and the day length, or the working day
// and the nearest sunrise or sunset at the typed time (left out in polar day
// or night, which the sun times line already names).
function detailUpdate(info, { typed, now, picture, iconsDir, layout }) {
  const meeting = Boolean(typed);
  const change = detailClockChange(info, meeting, now);
  const tile = meeting ? `status-${info.workingStatus}` : info.dayPhase && `phase-${info.dayPhase}`;
  const details = meeting
    ? [formatWorkingDaySentence(info.workingDayTiming), info.polar ? "" : formatNearestSunEvent(info)]
    : [formatSunElevation(info), formatDayLengthLine(info)];
  const ids = {
    context: { text: meeting ? formatTypedReference(typed, info.moment) : formatOffsetFromYou(info) },
    city: { text: info.name },
    country: { text: formatCountry(info) || " " },
    time: { text: formatTime(info.moment, info.timeZone) },
    date: { text: formatLongDate(info.moment, info.timeZone) },
    flag: { text: flagEmoji(info.countryCode) || " " },
    zone: { text: formatZoneLine(info) },
    clockchange: { text: change ? formatClockChangeSentence(change, now, info.timeZone) : " " },
    tile: tile ? { image: { type: "file", src: `${iconsDir}/${tile}.png` }, hidden: false } : { hidden: true },
    suntimes: { text: formatSunTimes(info) || " " },
    sundetail1: { text: details[0] || " " },
    sundetail2: { text: details[1] || " " },
    picture: picture.state === "shown" ? { image: { type: "file", src: picture.path }, hidden: false } : { hidden: true },
    pictureloading: { hidden: picture.state !== "loading" },
  };
  for (const id of ["city", "country", "date", "context"]) ids[id].font = fittedFont(id, ids[id].text, layout);
  return { update: { ids } };
}
