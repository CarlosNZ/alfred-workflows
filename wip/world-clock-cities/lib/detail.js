// The city detail view, in two versions: the inline view, inside Alfred, on
// ↩, and the detail window, a window of its own, on ⌘↩. Loaded by results.js, which hands each city to the view through
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

// How soon the next clock change must be for the view to tell of it, when it
// shows now.
const DETAIL_CLOCK_CHANGE_DAYS = 7;

// Workflow variables set on a city's result, for the detail view:
// detail_slug names the city (citySlug, from Clock's identifier);
// detail_title is the detail window's title; detail_clock_change is "1" when the
// view has a line for a clock change (detailClockChange), "0" otherwise.
// panel.zsh uses these to pick the city's package and its layout.
// detail_city is the city's record,
// as JSON, which panel.zsh saves in the package for the pulse script: the
// Clock record and isLocal. Handing over the record spares the pulse reading Clock's
// list every second, which also needs Full Disk Access that the view's own
// process may not have. detail_picture_city is the city's record for the
// picture fetcher (pictureFetchRecord), which panel.zsh starts for this city
// alone if it has no picture yet. ⌘ adds detail_launch (see cityItem in
// results.js). The mode and typed time aren't in the record: every view
// follows the results' latest (see saveShownTime). `typed` is the typed time
// (readTypedTime), or null for now.
function detailVariables(city, info, typed, now) {
  const record = Object.fromEntries(DETAIL_CITY_FIELDS.filter((key) => city[key] != null).map((key) => [key, city[key]]));
  return {
    detail_slug: citySlug(city),
    detail_title: info.name,
    detail_clock_change: detailClockChange(info, typed, now) ? "1" : "0",
    detail_city: JSON.stringify({ city: record, isLocal: info.isLocal }),
    detail_picture_city: JSON.stringify(pictureFetchRecord(city)),
  };
}

// The User Configuration variables the detail views' text depends on, saved
// for the pulse with the time the results show (saveShownTime): the time
// format, and the working day behind the meeting mode's working status.
const VIEW_SETTINGS = ["time_format", "work_start", "work_end"];

// Where results.js saves the time its results show, for the detail views:
// panels/shown-time.json in the cache, next to the views' packages.
function shownTimePath() {
  return `${workflowCacheDir()}/panels/shown-time.json`;
}

// Saves the time the results show, and their mode, so every open detail view
// shows the same: typed is null for now, or the typed time (see
// savedTypedTime); meeting is true for the time mode, whose view is the
// meeting mode, and false for the list, whose view is the now mode. The time
// mode for now has a typed time (a relative one of 0 minutes), and the list
// can be at a typed time (see readViewSwitch). Saved with the values of the
// User Configuration variables the views use (VIEW_SETTINGS) as settings. When the testing variables are set,
// it also saves testNow, WCC_NOW's value, and testTimeZone, the Mac's
// zone as TZ made it. They're saved because the views' pulse runs in Alfred's
// UI helper, which doesn't get the workflow's variables. results.js calls it whenever a query gives a moment, not
// while a typed time is incomplete or unreadable, so views keep the last
// time until the query gives another. Only written when it changes, since the
// list reruns every second; written to a temporary file and moved into
// place, so a pulse never reads half a file. Errors are logged rather than
// thrown: the views never stop the results.
function saveShownTime(typed, meeting, now) {
  try {
    const text = JSON.stringify({
      typed: typed ? savedTypedTime(typed, now) : null,
      meeting,
      settings: Object.fromEntries(VIEW_SETTINGS.map((name) => [name, environmentValue(name)])),
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

// The moment the view shows: now, or the typed time, which for a relative
// time moves with the clock.
function detailMoment(typed, now) {
  if (!typed) return now;
  if (typed.kind === "relative") return new Date(now.getTime() + typed.minutes * 60000);
  return new Date(typed.moment);
}

// The clock change the view tells of, as { date, shiftMinutes }, or null.
// Showing now, the next one if it's within DETAIL_CLOCK_CHANGE_DAYS. At a
// typed time (`typed`, in either mode), the one between now and then, however
// far, as in the results: it's why the time there differs from what today's
// offset suggests.
function detailClockChange(info, typed, now) {
  if (typed) return info.clockChangeFromNow;
  const change = info.nextClockChange;
  return change && change.date - now <= DETAIL_CLOCK_CHANGE_DAYS * 86400000 ? change : null;
}

// The pulse's output for a city: a JSON update of the view's components, by
// id (see lib/panel.js). `typed` is the saved typed time (see
// savedTypedTime), or null for now; `meeting` is true in the meeting mode; `picture` is the city's picture state (pictureState);
// `iconsDir` holds the tiles' icons and the sunrise and sunset symbols; `layout` says whether the view has a
// picture slot ({ picture }), which sets how wide the city's text can be.
// Ids the view's layout doesn't have (the clock change line, say) are
// ignored by Alfred. The labels that can be too long get a font that fits
// their text (fittedFont), sent every time, since the text can change.
//
// The two modes fill the same components, so a detail window can switch
// between them: the tile is the phase of the day or the working status; and
// the sun details are the sun's elevation and the day length, or the working
// day and the nearest sunrise or sunset (left out in polar day or night, which
// the sun times line already names). The context line follows the moment
// rather than the mode: the offset from you for now, or the typed time, which
// says the view isn't showing now.
function detailUpdate(info, { typed, meeting, now, picture, iconsDir, layout }) {
  const change = detailClockChange(info, typed, now);
  const tile = meeting ? `status-${info.workingStatus}` : info.dayPhase && `phase-${info.dayPhase}`;
  const details = meeting
    ? [formatWorkingDaySentence(info.workingDayTiming), info.polar ? "" : formatNearestSunEvent(info)]
    : [formatSunElevation(info), formatDayLengthLine(info)];
  const sunEvents = Boolean(!info.polar && info.sunrise && info.sunset);
  const ids = {
    context: { text: typed ? formatTypedReference(typed, info.moment) : formatOffsetFromYou(info) },
    city: { text: info.name },
    country: { text: formatCountry(info) || " " },
    time: { text: formatTime(info.moment, info.timeZone) },
    date: { text: formatLongDate(info.moment, info.timeZone) },
    flag: { text: flagEmoji(info.countryCode) || " " },
    zone: { text: formatZoneLine(info) },
    clockchange: { text: change ? formatClockChangeSentence(change, now, info.timeZone) : " " },
    tile: tile ? { image: { type: "file", src: `${iconsDir}/${tile}.png` }, hidden: false } : { hidden: true },
    sunevents: { hidden: !sunEvents },
    sunrisesymbol: { image: { type: "file", src: `${iconsDir}/symbol-sunrise.png` } },
    sunsetsymbol: { image: { type: "file", src: `${iconsDir}/symbol-sunset.png` } },
    sunrisetime: { text: sunEvents ? formatTime(info.sunrise, info.timeZone) : " " },
    sunsettime: { text: sunEvents ? formatTime(info.sunset, info.timeZone) : " " },
    sunpolar: { text: formatPolar(info) || " " },
    sundetail1: { text: details[0] || " " },
    sundetail2: { text: details[1] || " " },
    picture: picture.state === "shown" ? { image: { type: "file", src: picture.path }, hidden: false } : { hidden: true },
    pictureloading: { hidden: picture.state !== "loading" },
  };
  for (const id of ["city", "country", "date", "context", "zone"]) ids[id].font = fittedFont(id, ids[id].text, layout);
  return { update: { ids } };
}
