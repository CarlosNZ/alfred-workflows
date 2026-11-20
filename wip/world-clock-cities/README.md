# World Clock

Developer notes for a workflow that shows the current time in each city from the macOS Clock app's World Clock list. The workflow is a skeleton so far: it lists the cities with their UTC offsets, and computes every [city property](#city-properties), which it logs but doesn't show yet. This file also records how the data can be read, and ideas for what comes next.

## Design

- **One keyword**, `wcc` by default (User Configuration variable `keyword`; `wc` is taken by Word Count). `wcc` alone lists every city. What's typed after it decides the mode: text starting with a digit is a time to convert (`wcc 3pm`, `wcc 9am London`; see [Time input](#time-input)); anything else narrows the list (`wcc new` matches New York and New Zealand). Meeting planning is part of the time mode rather than a separate keyword.
- **A hotkey for the city list** only, for glancing at the times. A hotkey for the time mode would save nothing, since a time has to be typed anyway. Ship it unassigned so each user picks their own.
- **JXA**, in external script files run as Script Filters (type 8, input as argv). JXA reads the plist through Foundation and does time zone maths with `Intl`, so nothing needs installing. One Script Filter handles every mode, with its logic split across files in `lib/` (see [Code layout](#code-layout)).
- **The local city** is the one in the Mac's current time zone (`NSTimeZone.localTimeZone`), detected automatically, with no setting. It's the reference for relative values ("+11h", "Tomorrow"), so it should follow the Mac when travelling, which a fixed home city setting wouldn't; the locale (e.g. `en_NZ`) doesn't change with location, so it can't be used. Cities are compared by offset (same UTC offset now and the same next clock change), not by zone name, because aliases don't resolve: `Australia/Canberra` stays `Australia/Canberra` in both `Intl` and Foundation, never `Australia/Sydney`. When several cities share the zone (Auckland and Wellington), the first in Clock's order wins. If that proves a problem, a "Set as local city" modifier could store a choice in `$alfred_workflow_data`, used only as a tiebreaker between cities in the Mac's zone.

### City properties

What the workflow knows about each city, and where each value comes from. How they're laid out in results is still to be designed.

Values marked ⏱ depend on a moment in time: the current time, or the time typed in the time mode. The functions computing them take that moment as input, so the list and the time mode share them.

A typed time always means its next occurrence (now or later), since the time mode is for planning ahead: at 3:30pm, `wcc 3pm` is 3pm tomorrow in the Mac's zone, while at exactly 3:00pm it's now. `wcc 9am London` is the next 9am in London's zone. Results say which day the time fell on (e.g. "Tomorrow (Sat) 3:00 PM"), and day labels in the time mode compare each city's date with that day, not today.

| Property | Source | Derivation |
|---|---|---|
| City name | `name` | As stored; already localized for the entry's `languageCode`. |
| Country | `countryName` | As stored. When `displayNameIncludingCountryUsesOnlyCountry` is true (city-states such as Singapore), show the country alone, as Clock does. Shown shortened where `lib/format.js` has a short name (Great Britain → UK, U.S.A. → USA). |
| Flag | `localeCode` | Kept as the country code; shown by mapping each letter to a regional indicator symbol (A–Z → U+1F1E6–U+1F1FF), so `NZ` → 🇳🇿. No flag if the code is missing or isn't two letters. |
| Local city | `timeZone` | See [Design](#design). |
| ⏱ Local time | `timeZone` | The city's calendar date, weekday and time of day as numbers (`Intl.DateTimeFormat` parts). Shown with `NSDateFormatter`, a short time style and the city's `timeZone`, which follows the Mac's date and time settings, including 24-hour time. |
| ⏱ Day label | `timeZone` | "Tomorrow" or "Yesterday" when the city's calendar date differs from the Mac's. |
| ⏱ UTC offset | `timeZone` | In minutes, from `NSTimeZone.secondsFromGMTForDate`. Shown as e.g. "UTC+13", "UTC+5:45". |
| ⏱ Offset from local | `timeZone` | The city's UTC offset minus the Mac's, e.g. "+11h", "−2h 30m". |
| ⏱ Upcoming clock change | `timeZone` | `NSTimeZone.nextDaylightSavingTimeTransitionAfterDate` for the date, and `secondsFromGMTForDate` on either side of it for the shift (e.g. London 28 Mar 2027, +1h; Tokyo none). Shown only when it's close, e.g. within 7 days. |
| ⏱ Working status | `timeZone` | The city's local hour against a working day from User Configuration: e.g. working, evening, asleep. The main value in the time mode. |
| ⏱ Daylight state | `latitude`, `longitude` | The sun's elevation, from the solar position calculation below, in bands that don't overlap, so each city has one state: day (above 6°), golden hour (6° down to sunrise/sunset at −0.833°), civil twilight (to −6°), nautical twilight (to −12°), astronomical twilight (to −18°), night (below −18°). Photographers' golden hour usually runs to −4°, overlapping civil twilight; here the horizon splits them. Shown with the time since the previous sunrise or sunset, or until the next, e.g. "Sunset in 2h 14m" or "Sunset 1h ago". |
| ⏱ Sunrise and sunset | `latitude`, `longitude` | When the sun's elevation crosses −0.833° (horizon, allowing for refraction and the sun's disc). |
| ⏱ Day length and change | `latitude`, `longitude` | Sunset minus sunrise; the change is today's length minus yesterday's, e.g. "10h 12m, +2m/day". |

`describeCity` (in `lib/cities.js`) computes them all for a city at a moment, as one object of raw values: times are `Date`s; offsets, durations and day lengths are in minutes; the local date and time are numbers; states are codes (`goldenHour`, `polarNight`); the day label is a `dayOffset` of −1, 0 or 1; the country is as stored, with its code. All text, including times, offsets, flags and short country names, comes from `lib/format.js`, so display options (such as a time format) only touch that layer. The local city is an `isLocal` flag, decided once over the whole list (`findLocalCity`) so that filtering doesn't change it. `polar` is `midnightSun` or `polarNight` when the sun doesn't cross the horizon on the city's current date (not merely because the city is inside a polar circle); the day length is then 1440 or 0 minutes, and the previous or next sunrise or sunset is null when it's more than a day away. The working day is a constant in `lib/time.js` until it moves to User Configuration: asleep 22:00–7:00, morning to 9:00, working to 17:00, then evening. It ignores weekends, which differ between countries.

The sun values come from the NOAA solar position algorithm (after Meeus): about 50 lines of plain JavaScript, accurate to about a minute, and offline. Near the poles the sunrise equation has no solution on some days; that's 24-hour daylight or darkness, with no sunrise or sunset to count down to and no day length change.

To decide: whether the upcoming clock change in the time mode is counted from now or from the typed time (the typed time would warn that `wcc 9am` on a Saturday falls after Sunday's change).

### Time input

Parsing isn't fully designed yet. Alfred reruns the script on every keystroke, so input is often partly typed: it resolves as soon as it's unambiguous, and not before.

```
3                      03:00 (24-hour when there's no am/pm)
3:2                    doesn't resolve (minutes incomplete)
3:25                   03:25
3:25p                  15:25
15:30                  15:30
10:23PM                22:23
11 AM                  11:00
0, 0am, 12am, 00:00    00:00, the start of the day
12:00 mon              12:00 Monday
8am t                  doesn't resolve (Tuesday or Thursday)
8am tu                 08:00 Tuesday
13:35 Weds             13:35 Wednesday
```

Rules:

- Hours are 0–23 without am/pm, and 0–12 with it. `a`, `am`, `p` or `pm`, in any case, with or without a space. 12am is midnight and 12pm is noon.
- Minutes are two digits after a colon.
- Midnight is always the start of a day: `0:00 fri` is the start of Friday.
- A day is any prefix of a day name that matches only one day (`m`, `tu`, `w`, `th`, `f`, `sa`, `su` and longer), plus `weds`, in any case.
- The time is always its next occurrence, now or later, with or without a day: on a Monday at 11am, `12:00 mon` is today at noon; at 1pm it's next Monday.
- No named times (`midnight`, `noon`): numbers only, so the time mode is simply any query starting with a digit.

Open questions:

- What to show while the input doesn't resolve: probably a single "Keep typing…" item echoing the input. Falling back to the part that did resolve would mislead (`3:2` showing 03:00).
- Input that can't become valid by typing more (`25:00`, `13pm`, `3:75`): a single "can't read that time" result.
- Where a city goes alongside a day (`wcc 12:00 mon London`).

## How it works

### Code layout

- `results.js`: the Script Filter. Loads the files in `lib/`, chooses the mode from the query, and turns the results into Alfred's JSON, including the wording of every result.
- `lib/cities.js`: reading Clock's city list, and matching cities against a query.
- `lib/time.js`: time zone calculations, and reading typed times.
- `lib/sun.js`: the sun's elevation, sunrise and sunset, and the daylight state.
- `lib/format.js`: turning those values into text (times, offsets, flags, short country names).

JXA has no `import`, and `Library()` only loads from `~/Library/Script Libraries`, which a workflow can't ship in. So `results.js` reads each `lib/` file and runs it with an indirect `eval` (`(0, eval)(source)`), which runs it in the global scope. Each file's top-level functions become globals, available to `results.js` and the other files; its top-level `const` and `let` stay private to it. The catches:

- All functions share one namespace, and a name defined twice silently resolves to the later file's. Name functions for what they do on their own (`matchesCity`, not `matches`).
- An error's line number is within its file, but the error doesn't say which file.
- `lib/` paths are relative to the working directory. Alfred runs scripts from the workflow folder; when running `results.js` by hand, do the same.

### Behaviour

`results.js` reads the cities (see [Reading it](#reading-it)), keeps them in Clock's order, and filters them in the script: every word typed must start a word of the city's name or country, ignoring case and accents. Alfred's own filtering is off, because it would hide every city when a time is typed. Items have no `uid`, so Alfred doesn't reorder them by usage.

Every result defines ⌘, ⌥ and ⌃ modifiers (`withInertMods` in `results.js`); those without an action of their own are inert (`valid: false`, with the result's own subtitle). Without them Alfred applies its own modifiers, ⌥ "Search in Finder" and ⌃ "Search with default fallback", which the `strictmods` flag in the JSON doesn't stop. ⇧ is left alone for Quick Look.

The Script Filter runs 0.2s after typing pauses (Run Behaviour › Custom delay; in `info.plist`, `queuedelaymode` 2 and `queuedelaycustom` 2, in tenths of a second), and immediately for the first character. That skips most partly typed times without slowing down filtering, which "Automatic after last character typed" (`queuedelaymode` 1) did.

Each result shows the city name, with the country and current UTC offset as the subtitle. The computed values for the listed cities are written to stderr as one JSON array (`logCityInfos`), which Alfred shows in the workflow's debugger. Time conversion isn't implemented: a query starting with a digit lists every city.

When the list can't be loaded, the script returns a single explanatory result: the file is missing, the file exists but can't be read (no Full Disk Access), or Clock's list is empty.

### Testing

Run `results.js` from the workflow folder, with the query as its argument. In Alfred it reads Clock's real city list, but outside Alfred that usually fails: a terminal or Claude Code session normally lacks Full Disk Access (see [Access](#access)). So when the environment variable `WCC_CITIES_PLIST` is set, the script reads the file it names instead. Alfred never sets it.

`test/cities.plist` is a city list for testing, in the same format as Clock's:

```zsh
WCC_CITIES_PLIST=test/cities.plist ./results.js "new"
WCC_CITIES_PLIST=/nonexistent ./results.js          # the "can't find" result
```

The computed values go to stderr and the Alfred JSON to stdout, so `2>/dev/null` shows just the JSON. (osascript also echoes the returned JSON to stderr, after the computed values.)

`test/` is in `.wfignore`, so it isn't shipped.

#### The test city list

Its entries come from the database Clock picks cities from, `/System/Library/PrivateFrameworks/AppSupport.framework/Versions/A/Resources/CityInfo.db` (SQLite; tables `cities` and `locales`), so the identifiers, coordinates and time zones are real. A city's `countryName` is its `country_override` if it has one, otherwise its locale's `country_name`; that matches every entry in the stale copy. `displayNameIncludingCountryUsesOnlyCountry` is set where the city and country names are the same, which is a guess at Clock's rule. Clock's live list doesn't always use the database's country names: it has shown London's country as "Great Britain" and US cities' as "USA", where the database has "England" and "U.S.A.".

The cities are chosen for edge cases:

| City | Edge case |
|---|---|
| Auckland, Wellington | Southern hemisphere daylight saving; two cities in the same zone (local city tiebreak) |
| Kolkata | Half-hour offset (+5:30) |
| Kathmandu | 45-minute offset (+5:45); zone stored as the old alias `Asia/Katmandu` |
| Singapore | City-state: city and country names are the same |
| Hong Kong | Country override "Hong Kong SAR, China", but locale code `CN` (so its flag would be China's) |
| London | Country override "England"; UTC+0 in winter |
| Vatican City | No locale code or country name in the database: no flag, no country |
| Longyearbyen | 78°N: midnight sun and polar night |
| New York | Northern hemisphere daylight saving |
| Phoenix | No daylight saving, unlike the rest of its region; same country as New York |
| Amundsen–Scott Station | The South Pole, −90° exactly; zone `Antarctica/South_Pole` (an alias, following New Zealand time) |

## No public API

The Clock app (`/System/Applications/Clock.app`, bundle ID `com.apple.clock`) has no supported way for another app to read its World Clock cities:

- No AppleScript dictionary (no `.sdef`, no `OSAScriptingDefinition`; `sdef /System/Applications/Clock.app` fails with error -192), so AppleScript only has the generic `activate`/`quit` and UI scripting through System Events.
- No Automator actions (nothing for Clock in `/System/Library/Automator`).
- The App Intents it declares in `NSUserActivityTypes` are all for alarms (`MTCreateAlarmIntent`, `MTGetAlarmsIntent`, …). The only other App Intent is `OpenTabIntent` in the World Clock widget extension ("Open Clock Tab" in Shortcuts), which opens a tab and returns nothing.
- `Info.plist` has no `CFBundleURLTypes`; its URL schemes are under `PrivateURLSchemes` (see [Opening Clock](#opening-clock)).

## Where the cities are stored

The current list is in the Clock app's sandbox container:

```
~/Library/Containers/com.apple.clock/Data/Library/Preferences/com.apple.mobiletimer.plist
```

under the key `cities`. Each entry looks like this (from an older copy of the same domain; the live file has the same shape):

```
{
  city = {
    name = Wellington;              // localized
    unlocalizedName = Wellington;
    countryName = "New Zealand";
    unlocalizedCountryName = "New Zealand";
    timeZone = "Pacific/Auckland";  // IANA name
    latitude = "-41.28333";
    longitude = "174.7833";
    localeCode = NZ;
    identifier = 316;
    yahooCode = "NZXX0049|2351310";
    displayNameIncludingCountryUsesOnlyCountry = 0;
  };
  languageCode = en;
  type = 2;
}
```

The array is in the order the cities appear in Clock. Checked on macOS 27.2 against a Clock app showing Auckland, Canberra, Los Angeles, New York and London: the container file lists exactly those, in that order, and had been modified that day.

Things that look like the answer but aren't:

- `~/Library/Preferences/com.apple.mobiletimer.plist`, which is what `defaults read com.apple.mobiletimer` and `NSUserDefaults` (suite `com.apple.mobiletimer`) read, holds a stale copy last written by macOS 14.5 (`citiesLastModified` 2024-07-15). Clock no longer updates it.
- `~/Library/Group Containers/group.com.apple.mobiletimerd/` holds Core Data stores (`local.sqlite`, `analytics.sqlite`). The alarms moved there (`MTAlarmStorageMigratedToCoreData = 1` in `com.apple.mobiletimerd` preferences); the cities aren't needed from it.

### Access

Both containers are covered by macOS app data protection: reading them fails with "Operation not permitted" unless the reading process has Full Disk Access. Alfred asks for Full Disk Access on first launch, so scripts run by Alfred can normally read the file. A process without it (including a terminal or Claude Code session that hasn't been granted it) can't, which matters when testing scripts outside Alfred.

The workflow should still handle the file being unreadable or missing (Full Disk Access not granted, or a future macOS moving it) with a single explanatory result rather than an empty list or a script error.

### Reading it

Read the file directly; don't go through `NSUserDefaults` or `defaults`, which return the stale copy. In JXA:

```js
ObjC.import("Foundation");
const path = $("~/Library/Containers/com.apple.clock/Data/Library/Preferences/com.apple.mobiletimer.plist").stringByExpandingTildeInPath;
const prefs = ObjC.deepUnwrap($.NSDictionary.dictionaryWithContentsOfFile(path)); // undefined if unreadable
const cities = (prefs && prefs.cities) || [];
cities.map(c => c.city.name + ": " + new Intl.DateTimeFormat("en-NZ", {
  timeZone: c.city.timeZone, weekday: "short", hour: "numeric", minute: "2-digit"
}).format(new Date()));
```

From a terminal with Full Disk Access, for a quick look:

```zsh
plutil -extract cities json -o - ~/Library/Containers/com.apple.clock/Data/Library/Preferences/com.apple.mobiletimer.plist |
  jq -r '.[].city | "\(.unlocalizedName)\t\(.timeZone)"'
```

`Intl.DateTimeFormat` in JXA accepts every zone seen so far, including the tzdata alias `Australia/Canberra`. JXA and Foundation ship with macOS, so the workflow needs no dependencies (unlike `jq`, which only ships from macOS 15).

## Opening Clock

Clock reopens on the last-used tab (`LAST_SELECTED_VIEW` in Clock's preferences). Ways to land on the World Clock tab:

- **Shortcuts "Open Clock Tab"** (`OpenTabIntent`), with Destination World Clock. Works. Its `ClockDestination` enum has the cases `worldclock`, `alarm`, `timer` and `stopwatch`. The system delivers the intent to Clock itself, which logs `didSelectTab MTTab(rawValue: 0) with delegate … MTAppIntentsProvider` and then `-[MTAAppController appIntentsProvider:didSelectTab:]: Handling AppIntents action for MTProviderTabClock`. There's no public API for one app to perform another app's App Intent (Shortcuts does it through private system services), so a workflow has to go through a shortcut: ship a one-action `.shortcut` file for the user to import, then run it with `shortcuts run "<name>"`.
- **URL schemes don't work.** Clock's `Info.plist` lists `clock-worldclock`, `clock-alarm`, `clock-stopwatch`, `clock-sleep-alarm`, `clock-timer` and `clock-timer-running` under `PrivateURLSchemes`, and Launch Services maps them to Clock (`lsregister -dump` lists them as claimed schemes). Clock receives them (its log shows `MTASceneManager … openURLContexts:` with the URL) but does nothing more: on macOS 27.2, `clock-worldclock://`, `clock-worldclock:`, `clock-worldclock:/`, `clock-worldclock://worldclock`, `clock-worldclock://open`, `clock-stopwatch://`, `clock-timer://` and `clock-alarm://` were each followed by no `didSelectTab` or other Clock log line (and where the window was watched, the tab didn't change). The schemes are undocumented, and the Mac app appears to accept and ignore them.
- **Clock's View menu**, chosen with System Events after activating Clock. Needs Accessibility access for Alfred, which Alfred also asks for on first launch. Not yet tested.
- Setting `LAST_SELECTED_VIEW` in the container's `com.apple.clock.plist` before launching Clock. Writing another app's preferences is fragile (`cfprefsd` caches them while Clock runs) and risks corrupting its settings; avoid.

To check what Clock does with an input, watch its own log while trying it:

```zsh
/usr/bin/log stream --style compact --predicate 'process == "Clock" AND subsystem == "com.apple.mobiletimer.logging"'
```

(Use `/usr/bin/log`: in zsh, `log` is a shell builtin.)

## Ideas

An initial brainstorm of what the workflow should do. Decisions so far are in [Design](#design); the rest is undecided.

### Core behaviour

- Triggered by a keyword, the workflow reads the cities from Clock's list (see [Where the cities are stored](#where-the-cities-are-stored)): city, country, coordinates and time zone. The offset isn't stored but follows from the IANA time zone, daylight saving included.
- For each city, show the current local time, using the current time and the Mac's own time zone as the reference.
- Show the daylight situation in each city, ideally without an online API: how long since or until sunrise or sunset, reflected in both the result's icon and its subtitle. Sunrise and sunset can be calculated from the coordinates and date, so this should be possible offline. States could include day, golden hour, twilight and night, and polar regions can have 24-hour daylight or darkness with no sunrise or sunset to count down to.
- ↩ copies the city's info to the clipboard.
- ⌥↩ opens Clock on the World Clock tab for editing the list (see [Opening Clock](#opening-clock) for how).
- Read-only: adding, removing and reordering cities stays in Clock.
- Possibly an optional city list in the workflow's own configuration, for when Clock's list can't be read.

### Feature ideas

- **Live times:** times and countdowns keep updating while Alfred is open.
- **Time conversion:** e.g. `wcc 3pm` shows what 3pm local time is in every city, and `wcc 9am London` converts from a city's time. Useful for planning calls.
- **Working hours:** mark cities where it's outside working hours or the middle of the night (e.g. "Asleep · 2:14 AM"). Combined with conversion, find an hour that suits everyone. Working hours could be a setting.
- **Day labels:** "Tomorrow" or "Yesterday" when a city's date differs from local.
- **Upcoming clock changes:** e.g. "Clocks go back Sunday (−1h)" when a city's daylight saving change is close.
- **Country flags** in the subtitle, from the country code (e.g. `NZ` → 🇳🇿).
- **More copy options:** copy just the time, or all cities as a list for pasting into a message; Large Type for showing the time across a room.
- **Cities not in Clock:** e.g. `wcc tokyo` matches any time zone macOS knows when the city isn't in the list. Without coordinates these would show the time only, no daylight info.
- **Local city:** if one of the cities is in the Mac's time zone, mark it as local and use it as the reference in subtitles (e.g. "+11h from you").
- **Small extras:** day length and how it's changing (e.g. "10h 12m, +2m/day").
- Weather is out of scope: it would need an online service and an API key. So is moon phase: it's the same everywhere at a given moment, so it isn't a property of a city, and would suit a separate workflow.

## Caveats

The file location and format are undocumented and private to Apple. They have already changed once (the move into the sandbox container left the old copy behind), and could change again in any macOS update without notice.
