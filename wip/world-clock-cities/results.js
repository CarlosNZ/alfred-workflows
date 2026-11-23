#!/usr/bin/osascript -l JavaScript

// Script Filter for the World Clock keyword. Lists the cities from the Clock
// app's World Clock, in Clock's order.
//
// argv[0] is the text typed after the keyword. Text starting with a digit is a
// time to convert (e.g. "3pm"), shown in meeting mode; anything else narrows
// the list by city or country name, shown in clock mode, now. A "-" at the
// end switches to the other mode for the same moment (see readModeSwitch).
//
// The logic lives in lib/; this file turns it into Alfred results.

ObjC.import("Foundation");
ObjC.import("CoreFoundation");

const LIBS = ["lib/cities.js", "lib/time.js", "lib/sun.js", "lib/format.js", "lib/detail.js", "lib/pictures.js"];

const LOAD_ERRORS = {
  missing: { title: "Can't find Clock's city list", subtitle: "Open Clock and add a city in World Clock, then try again" },
  unreadable: {
    title: "Can't read Clock's city list",
    subtitle: "Give Alfred Full Disk Access in System Settings › Privacy & Security",
  },
  empty: { title: "No cities in Clock", subtitle: "Add cities in the Clock app's World Clock tab" },
};

function run(argv) {
  LIBS.forEach(loadLib);

  const query = (argv[0] || "").trim();
  // The query without the mode switch, and whether it had one.
  const { query: text, switched } = readModeSwitch(query);
  const loaded = loadCities();
  if (loaded.error) return output([{ ...LOAD_ERRORS[loaded.error], valid: false }]);
  // Every run, whatever the query, with the whole list, so the cache follows
  // Clock's list and fills whenever the keyword is used.
  updatePictureCache(loaded.cities);

  const now = currentTime();
  // Found in the whole list, so filtering doesn't change which city is local.
  const localCity = findLocalCity(loaded.cities, now);

  // Without the home city when the configuration hides it. It's still the
  // local city, and typed times can still name it.
  let cities = showHomeCity() ? loaded.cities : loaded.cities.filter((city) => city !== localCity);
  // Text that narrows the list: the whole query (without the mode switch)
  // when there's no time, and the text after a relative time.
  let filter = text;
  // The typed time, or null for now.
  let typed = null;
  const timeQuery = isTimeQuery(text);
  if (timeQuery) {
    typed = readTypedTime(text, loaded.cities, now);
    logTypedTime(typed);
    // A query that gives no moment shows a single message in place of the
    // cities, since the cities at any other time would mislead.
    const message = typedTimeMessage(typed, text);
    if (message) return output([{ ...message, valid: false }]);
    filter = typed.filter;
  }
  // Meeting mode for a typed time and clock mode for now, unless the mode
  // switch swaps them. Meeting mode now shows it as a relative time of 0
  // minutes, as "+" does, so it reads the same.
  const meeting = timeQuery !== switched;
  if (meeting && !typed) typed = relativeTypedTime(0, filter, now);
  // The moment the cities are shown at: now, or the typed time.
  const moment = typed ? typed.moment : now;
  // Open detail views follow the results: their moment and mode.
  saveShownTime(typed, meeting, now);
  if (cities.length === 0) return output([{ ...HOME_CITY_ONLY, valid: false }]);
  if (filter) {
    cities = cities.filter((city) => matchesCity(city, filter));
    if (cities.length === 0) {
      return output([
        { title: "No matching cities", subtitle: `Nothing in Clock's list matches “${filter}”`, valid: false },
      ]);
    }
  }

  const rows = sortedByTimeZone(
    cities.map((city) => ({ city, info: describeCity(city, moment, { isLocal: city === localCity, now }) })),
  );
  logCityInfos(rows.map((row) => row.info));

  // Rerunning every second keeps the times and countdowns current while
  // Alfred is open; a run takes about a tenth of a second. A typed clock time
  // is a fixed moment, so it doesn't rerun, in either mode, but a relative
  // time moves with the clock. skipknowledge stops Alfred reordering the items
  // by usage, which their uids would otherwise allow, so they stay in the
  // order given.
  const rerun = !typed || typed.kind === "relative";
  // The search that shows these results, for ⌫ in a city's inline view to go
  // back to (see panel.zsh). On each item's variables, beside the city's.
  const search = `${environmentValue("keyword") || "wcc"} ${query}`;
  const { keys, clashes } = cityActionKeys();
  const context = { keys, search, typed, meeting, now };
  const cityItem = meeting ? meetingCityItem : clockCityItem;
  const items = rows.map(({ city, info }) => cityItem(info, city, context));
  return output([...clashes.map(keyClashItem), ...items], { ...(rerun && { rerun: 1 }), skipknowledge: true });
}

// The keys a city result's actions can be set to in the User Configuration:
// Alfred's names for the modifiers, and "none" for ↩ alone.
const ACTION_KEYS = ["none", "cmd", "alt", "ctrl"];
const KEY_NAMES = { none: "↩ with no modifier", cmd: "⌘", alt: "⌥", ctrl: "⌃" };

// A city result's actions, each with the User Configuration variable that sets
// its key, the keys it can take and its default, and its label there. Keys are
// given out in this order, so when two actions are set to the same key, the
// earlier one has it and the later one has none (see keyClashItem).
// otherDetails isn't an action but a subtitle shown while its modifier is
// held, so it can't be ↩ alone.
const CITY_ACTIONS = [
  { id: "detail", variable: "key_detail", keys: ACTION_KEYS, default: "none", label: "Show detail view" },
  { id: "window", variable: "key_detail_window", keys: ACTION_KEYS, default: "cmd", label: "Open detail window" },
  { id: "clock", variable: "key_edit_cities", keys: ACTION_KEYS, default: "alt", label: "Edit cities in Clock app" },
  { id: "otherDetails", variable: "key_other_details", keys: ["cmd", "alt", "ctrl"], default: "ctrl", label: "Show alternative result detail" },
];

// Which action each key has, from the User Configuration, as { keys: { none:
// "detail", cmd: "window", … }, clashes }, where clashes lists each action
// left without a key ({ key, action, holder }). An unset or unknown value
// counts as the action's default.
function cityActionKeys() {
  const keys = {};
  const clashes = [];
  for (const action of CITY_ACTIONS) {
    const chosen = environmentValue(action.variable);
    const key = action.keys.includes(chosen) ? chosen : action.default;
    if (keys[key]) clashes.push({ key, action, holder: CITY_ACTIONS.find((other) => other.id === keys[key]) });
    else keys[key] = action.id;
  }
  return { keys, clashes };
}

// A result above the cities saying that two actions are set to the same key,
// so one of them can't be used until the configuration is changed.
function keyClashItem({ key, action, holder }) {
  return {
    title: `Two actions are set to ${KEY_NAMES[key]}`,
    subtitle: `“${holder.label}” has it, so “${action.label}” is off. Change one in the workflow's configuration`,
    valid: false,
  };
}

// Whether the results show the home city, the local city, from the User
// Configuration (show_home_city, on unless "0"). It's for keeping your own
// city in Clock without it in the workflow, where you know its time.
function showHomeCity() {
  return environmentValue("show_home_city") !== "0";
}

// The result when the home city is hidden and it's the only city in Clock.
const HOME_CITY_ONLY = {
  title: "No other cities in Clock",
  subtitle: "Your home city is hidden in the workflow's configuration",
};

// The User Configuration's sort_by_time_zone values, as the direction to sort
// the UTC offsets in. "off", unset or unknown keeps Clock's order.
const TIME_ZONE_SORTS = { ascending: 1, descending: -1 };

// The rows ({ city, info }) in the order the User Configuration's
// sort_by_time_zone sets: by the cities' UTC offsets at the moment shown,
// ascending (the furthest west, whose local time is earliest, first) or
// descending, or as given, in Clock's order. Cities with the same offset keep
// Clock's order either way, as sort is stable.
function sortedByTimeZone(rows) {
  const direction = TIME_ZONE_SORTS[environmentValue("sort_by_time_zone")];
  if (!direction) return rows;
  return [...rows].sort((a, b) => direction * (a.info.utcOffsetMinutes - b.info.utcOffsetMinutes));
}

// Writes the cities' computed values to stderr as one JSON array, which Alfred
// shows in the workflow's debugger, for checking the raw values behind the
// results. Dates appear as UTC ISO strings.
function logCityInfos(infos) {
  console.log(JSON.stringify(infos, null, 2));
}

// The single result for a time query that gives no moment (see readTypedTime),
// as { title, subtitle }, or null when it gives one.
function typedTimeMessage(typed, query) {
  switch (typed.kind) {
    case "incomplete":
      return { title: "Keep typing…", subtitle: query };
    case "invalid":
      return { title: "Can't read that time", subtitle: `“${query}” isn't a time. Try 3pm, 15:30, 9am tu or +2` };
    case "unknownCity":
      return {
        title: `No city matches “${typed.place}”`,
        subtitle: "Type a city from Clock's list after the time, or leave it out",
      };
    default:
      return null;
  }
}

// Writes what a time query was read as to stderr, for the workflow's debugger,
// as one line: readTypedTime's result, with the moment also shown in the zone it
// was read in.
function logTypedTime(typed) {
  const shown = typed.moment && formatWithTemplate(typed.moment, typed.timeZone, "EEE d MMM y jj:mm z");
  console.log(`Typed time: ${JSON.stringify({ ...typed, ...(shown && { shown }) })}`);
}

// Runs a file from lib/ in the global scope, so its top-level functions are
// available here and to the other lib files; its top-level const and let stay
// private to it. JXA has no import, and Library() only loads from
// ~/Library/Script Libraries. The path is relative to the working directory,
// which Alfred sets to the workflow folder.
function loadLib(file) {
  const source = $.NSString.stringWithContentsOfFileEncodingError(file, $.NSUTF8StringEncoding, null);
  if (source.isNil()) throw new Error(`Can't load ${file} (run from the workflow folder)`);
  (0, eval)(source.js);
}

// An Alfred item for a city in clock mode, from describeCity's values and the
// city's Clock record. Its actions are on the keys `context.keys` gives them
// (see cityActionKeys); by default ↩ shows the city's inline view, ⌘↩ opens
// its detail window, ⌥↩ opens Clock on its World Clock tab
// (open-clock.applescript), to edit the list, and holding ⌃ shows the
// subtitle for the other mode's question: in clock mode, the working status;
// in meeting mode, the offsets and the nearest sunrise or sunset.
//
// At a typed time, clock mode's title has the full weekday, as in meeting mode
// (meetingTitle): "Yesterday" or "Tomorrow" would be from the Mac's date at
// that time, which reads as from today.
//
// Each key's variables name its action as city_action, which the Conditional
// after the Script Filter routes on, since Alfred's connections have fixed
// modifiers. A modifier's variables replace the item's, so each repeats the
// city's (see detailVariables) and the search. detail_window_key is the
// detail window's key, for the inline view's shortcut that opens it (see
// panel.zsh). In `context`, `typed` is the typed time (readTypedTime), or
// null for now, and `meeting` is true in meeting mode.
function clockCityItem(info, city, { keys, search, typed, meeting, now }) {
  const details = meeting ? meetingCtrlSubtitle(info) : meetingSubtitle(info);
  const windowKey = ACTION_KEYS.find((key) => keys[key] === "window") || "";
  const variables = { ...detailVariables(city, info, typed, now), detail_search: search, detail_window_key: windowKey };
  const action = (id, subtitle, extra = {}) => ({ subtitle, valid: true, variables: { ...variables, ...extra, city_action: id } });
  const actions = {
    detail: action("detail", `Show ${info.name} in Alfred`),
    window: action("window", `Open ${info.name} in its own window`, { detail_launch: "window" }),
    clock: action("clock", "Edit cities in Clock app"),
    otherDetails: details && { subtitle: details, valid: false },
  };
  const plain = actions[keys.none];
  const mods = Object.fromEntries(MODIFIERS.filter((key) => actions[keys[key]]).map((key) => [key, actions[keys[key]]]));
  return {
    // On a rerun, Alfred keeps the selection on the item with the selected
    // item's uid; without uids it jumps back to the first item.
    uid: info.id,
    title: typed ? meetingTitle(info) : clockTitle(info),
    subtitle: clockSubtitle(info, Boolean(typed)),
    arg: info.name,
    ...(info.dayPhase && { icon: { path: `icons/phase-${info.dayPhase}.png` } }),
    variables: plain ? plain.variables : variables,
    // With no action on ↩ alone, ↩ does nothing rather than closing Alfred.
    ...(!plain && { valid: false }),
    mods,
  };
}

// An Alfred item for a city in meeting mode, from describeCity's values at the
// moment shown. Its icon is the working status.
function meetingCityItem(info, city, context) {
  return {
    ...clockCityItem(info, city, context),
    title: meetingTitle(info),
    subtitle: meetingSubtitle(info),
    icon: { path: `icons/status-${info.workingStatus}.png` },
  };
}

const MODIFIERS = ["cmd", "alt", "ctrl"];

// Every item defines each modifier, as inert (valid: false, same subtitle) where
// it has no action of its own. Otherwise Alfred applies its own modifiers, e.g.
// ⌥ "Search in Finder" and ⌃ "Search with default fallback", which the
// strictmods flag doesn't stop. ⇧ is left alone for Quick Look.
// `options` adds top-level Script Filter keys, such as rerun.
function output(items, options = {}) {
  return JSON.stringify({ ...options, items: items.map(withInertMods) });
}

function withInertMods(item) {
  const mods = { ...item.mods };
  for (const key of MODIFIERS) {
    if (!mods[key]) mods[key] = { subtitle: item.subtitle || "", valid: false };
  }
  return { ...item, mods };
}
