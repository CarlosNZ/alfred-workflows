// The city detail view (panel.alfredui), shown inside Alfred with ↩ and in a
// window of its own with ⌘↩. Loaded by results.js, which hands each city to
// the view through workflow variables, and by detail.js, the view's pulse
// script, which fills it in. Uses format.js.

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

// Workflow variables set on a city's result, for the detail view:
// detail_slug names the city's own package (see panel.zsh), from Clock's
// identifier; detail_title is the window's title; detail_city is the city's
// Clock record as JSON, with isLocal, which panel.zsh saves in the package for
// the pulse script. Handing over the record spares the pulse reading Clock's
// list every second, which also needs Full Disk Access that the view's own
// process may not have.
function detailVariables(city, info) {
  const record = Object.fromEntries(DETAIL_CITY_FIELDS.filter((key) => city[key] != null).map((key) => [key, city[key]]));
  return {
    detail_slug: info.id.replace(/[^A-Za-z0-9_-]/g, "_"),
    detail_title: info.name,
    detail_city: JSON.stringify({ city: record, isLocal: info.isLocal }),
  };
}

// The pulse's output for a city at a moment: a JSON update setting the text of
// the view's labels, by id.
// TO-DO: every property, as in largeTypeText, and the city's picture.
function detailUpdate(info) {
  const time = `${formatTime(info.moment, info.timeZone)} ${formatWithTemplate(info.moment, info.timeZone, "EEEE")}`;
  const country = info.countryOnly ? "" : displayCountry(info) || "";
  return {
    update: {
      ids: {
        city: { text: [info.name, flagEmoji(info.countryCode)].filter(Boolean).join(" ") },
        country: { text: country },
        time: { text: time },
      },
    },
  };
}
