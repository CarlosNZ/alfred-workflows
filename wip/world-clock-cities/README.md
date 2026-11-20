# World Clock

Developer notes for a workflow that shows the current time in each city from the macOS Clock app's World Clock list. So far it shows the list of cities as designed in [Results layout](#results-layout); converting a typed time isn't built yet. This file also records how the data can be read, and ideas for what comes next.

## Design

- **One keyword**, `wcc` by default (User Configuration variable `keyword`; `wc` is taken by Word Count). `wcc` alone lists every city. What's typed after it decides the mode: text starting with a digit, `+` or `-` is a time to convert (`wcc 3pm`, `wcc 9am London`, `wcc +5` for five hours from now; see [Time input](#time-input)); anything else narrows the list (`wcc new` matches New York and New Zealand). Meeting planning is part of the time mode rather than a separate keyword.
- **A hotkey for the city list** only, for glancing at the times. A hotkey for the time mode would save nothing, since a time has to be typed anyway. Ship it unassigned so each user picks their own.
- **JXA**, in external script files run as Script Filters (type 8, input as argv). JXA reads the plist through Foundation and does time zone maths with `Intl`, so nothing needs installing. One Script Filter handles every mode, with its logic split across files in `lib/` (see [Code layout](#code-layout)).
- **The local city** is the one in the Mac's current time zone (`NSTimeZone.localTimeZone`), detected automatically, with no setting. It's the reference for relative values ("+11h", and the weekday shown when a city's date differs), so it should follow the Mac when travelling, which a fixed home city setting wouldn't; the locale (e.g. `en_NZ`) doesn't change with location, so it can't be used. Cities are compared by offset (same UTC offset now and the same next clock change), not by zone name, because aliases don't resolve: `Australia/Canberra` stays `Australia/Canberra` in both `Intl` and Foundation, never `Australia/Sydney`. When several cities share the zone (Auckland and Wellington), the first in Clock's order wins. If that proves a problem, a "Set as local city" modifier could store a choice in `$alfred_workflow_data`, used only as a tiebreaker between cities in the Mac's zone.

### City properties

What the workflow knows about each city, and where each value comes from. How they're shown is in [Results layout](#results-layout).

Values marked ⏱ depend on a moment in time: the current time, or the time typed in the time mode. The functions computing them take that moment as input, so the list and the time mode share them.

A typed time always means its next occurrence (now or later), since the time mode is for planning ahead: at 3:30pm, `wcc 3pm` is 3pm tomorrow in the Mac's zone, while at exactly 3:00pm it's now. `wcc 9am London` is the next 9am in London's zone. Every result in the time mode shows its city's weekday, so each row says which day the time falls on there.

| Property | Source | Derivation |
|---|---|---|
| City name | `name` | As stored; already localized for the entry's `languageCode`. |
| Country | `countryName` | As stored. When `displayNameIncludingCountryUsesOnlyCountry` is true (city-states such as Singapore), show the country alone, as Clock does. Shown shortened where `lib/format.js` has a short name (Great Britain → UK, U.S.A. → USA). |
| Flag | `localeCode` | Kept as the country code; shown by mapping each letter to a regional indicator symbol (A–Z → U+1F1E6–U+1F1FF), so `NZ` → 🇳🇿. No flag if the code is missing or isn't two letters. |
| Local city | `timeZone` | See [Design](#design). |
| ⏱ Local time | `timeZone` | The moment, shown with `NSDateFormatter`, a short time style and the city's `timeZone`, which follows the Mac's date and time settings, including 24-hour time. |
| ⏱ Day label | `timeZone` | The city's full weekday after the time ("1:33 AM Thursday"): in the list only when the city's calendar date differs from the Mac's, in the time mode always. |
| ⏱ UTC offset | `timeZone` | In minutes, from `NSTimeZone.secondsFromGMTForDate`. Shown as e.g. "UTC+13", "UTC+5:45". |
| ⏱ Offset from local | `timeZone` | The city's UTC offset minus the Mac's, e.g. "+11h", "−2h", "−7h 15m", "±0h". |
| ⏱ Upcoming clock change | `timeZone` | `NSTimeZone.nextDaylightSavingTimeTransitionAfterDate` for the date, and `secondsFromGMTForDate` on either side of it for the shift (e.g. London 28 Mar 2027, +1h; Tokyo none). Shown only when it's close: within 7 days in the list, and between now and the typed time in the time mode. |
| ⏱ Working status | `timeZone` | The city's local hour against a working day from User Configuration: e.g. working, evening, asleep. The main value in the time mode. |
| ⏱ Daylight state | `latitude`, `longitude` | The sun's elevation, from the solar position calculation below, in bands that don't overlap, so each city has one state: day (above 6°), golden hour (6° down to sunrise/sunset at −0.833°), civil twilight (to −6°), nautical twilight (to −12°), astronomical twilight (to −18°), night (below −18°). Photographers' golden hour usually runs to −4°, overlapping civil twilight; here the horizon splits them. Shown in the ⌃ details. |
| ⏱ Phase of the day | `latitude`, `longitude` | The sun's elevation and whether it's rising or setting (before or after solar noon), as one of the [phases of the day](#phases-of-the-day): night, dawn, sunrise, morning, afternoon, sunset, dusk. Shown as an icon. |
| ⏱ Previous and next sun event | `latitude`, `longitude` | The previous sunrise or sunset and the next. The nearer is shown with the time since or until it, e.g. "Sunset in 2h" or "Sunset 41m ago". |
| ⏱ Sunrise and sunset | `latitude`, `longitude` | When the sun's elevation crosses −0.833° (horizon, allowing for refraction and the sun's disc). |
| ⏱ Day length and change | `latitude`, `longitude` | Sunset minus sunrise; the change is today's length minus yesterday's, e.g. "10h 12m, +2m/day". |

Country names come from `Localizable_Countries.loctable` in `/System/Library/PrivateFrameworks/AppSupport.framework/Versions/A/Resources/`: a name for each of 242 country codes, plus 15 per-city overrides keyed by city identifier (London → England, Hong Kong → Hong Kong SAR, China), in each language Clock supports. English has four versions (`en`, `en_GB`, `en_AU`, `en_CA`), which differ only for US (U.S.A./USA), AE (U.A.E./UAE), VI and MO. `resources/clock-countries.csv` lists them all, with a column for the name to show. TO-DO: fill in that column and use it as the short-name map in `lib/format.js`, applied only to entries whose `languageCode` is English (`en` or `en_…`); other languages show the stored name.

`describeCity` (in `lib/cities.js`) computes them all for a city at a moment, as one object of raw values: times are `Date`s, including the moment itself, and are shown in the city's time zone; offsets, durations and day lengths are in minutes; states are codes (`goldenHour`, `polarNight`); the day label is a `dayOffset` of −1, 0 or 1; the country is as stored, with its code. All text, including times, offsets, flags and short country names, comes from `lib/format.js`, so display options (such as a time format) only touch that layer. The local city is an `isLocal` flag, decided once over the whole list (`findLocalCity`) so that filtering doesn't change it. `polar` is `midnightSun` or `polarNight` when the sun doesn't cross the horizon on the city's current date (not merely because the city is inside a polar circle); the day length is then 1440 or 0 minutes, and the previous or next sunrise or sunset is null when it's more than a day away. The working day is a constant in `lib/time.js` until it moves to User Configuration: asleep 22:00–7:00, morning to 9:00, working to 17:00, then evening. It ignores weekends, which differ between countries; TO-DO: add the Weekend status in [Icon states](#icon-states).

The sun values come from the NOAA solar position algorithm (after Meeus): about 50 lines of plain JavaScript, accurate to about a minute, and offline. Near the poles the sunrise equation has no solution on some days; that's 24-hour daylight or darkness, with no sunrise or sunset to count down to and no day length change.

### Results layout

Each mode answers one question, and a result's icon and title answer it. The list answers "what's it like there right now?", so its icon shows the sky. The time mode answers "does this time suit them?", so its icon shows the working status. The rest of a city's properties are behind a modifier and Large Type rather than in the subtitle. The list is built, with placeholder icons; the time mode, ⌥ and ⌘ aren't yet.

#### The list

At 10:33 PM on a Thursday in Auckland (sun times approximate):

```
[night]      10:33 PM • Auckland 🏠
             🇳🇿 New Zealand | Sunset 2h ago
[night]      8:33 PM • Canberra
             🇦🇺 Australia | −2h | Sunset 41m ago
[night]      1:33 AM • Los Angeles
             🇺🇸 USA | −21h | Sunrise in 5h
[night]      4:33 AM • New York
             🇺🇸 USA | −18h | Sunrise in 2h
[morning]    9:33 AM • London
             🇬🇧 UK | −13h | Sunset in 7h
```

- **Title:** the time, the full weekday when the city's date differs from the Mac's ("1:33 AM Wednesday"), " • ", then the city. The time comes first because it's the answer, and that way the times start in a column, which city names of different lengths would break. One-digit hours aren't padded: padding them to line up with two-digit hours looked wonky in Alfred's proportional font. Times have an ordinary space before AM/PM; the system formatter's narrow no-break space (U+202F) is too narrow to see in Alfred's font. The local city ends with 🏠.
- **Subtitle:** flag and country | offset from local | the nearer of the previous and next sunrise or sunset. Parts are divided by " | " rather than a dot, which looked poor before a minus sign. The local city has no offset. During polar day or night, "Midnight sun" or "Polar night" replaces the sun event. Working status is left out: the time already says it's evening.
- **Clock change:** when one is within 7 days, it replaces the sun event, e.g. "🇬🇧 UK | −13h | Clocks go back Sun (−1h)".
- **Icon:** the [phase of the day](#phases-of-the-day).

#### The time mode

`wcc 8am` at the same moment, which is 8am on Friday in Auckland:

```
[morning]    8:00 AM Friday • Auckland 🏠
             🇳🇿 New Zealand | Early morning | work in 1h
[asleep]     6:00 AM Friday • Canberra
             🇦🇺 Australia | Asleep | work in 3h
[working]    11:00 AM Thursday • Los Angeles
             🇺🇸 USA | Working | 6h left
[working]    2:00 PM Thursday • New York
             🇺🇸 USA | Working | 3h left
[evening]    7:00 PM Thursday • London
             🇬🇧 UK | Evening | 2h after work
```

- **Title:** as in the list, but always with the weekday, since crossing into another day is the main risk when planning a meeting.
- **Subtitle:** flag and country | working status | how far into or out of the working day, for sliding a meeting by an hour or two. There's no offset, since the converted times already show it.
- **Clock change:** when one falls between now and the typed time, it replaces the working day detail, e.g. "🇬🇧 UK | Evening | Clocks go back Sun (−1h)".
- **Icon:** the [working status](#working-statuses).

#### Icon states

##### Phases of the day

The list's icons. A phase is a range of the sun's elevation, split by whether the sun is rising (before solar noon) or setting (after), so dawn and dusk differ. The hours a phase covers depend on the city's latitude and the season. Morning and afternoon split at solar noon rather than 12:00, since the icon pictures the sky; with daylight saving, solar noon can be near 1:30 PM.

| Phase | Sun elevation | Sun | Word |
|---|---|---|---|
| `night` | Below −6° | Either | Night |
| `dawn` | −6° to −0.833° (the horizon) | Rising | Dawn |
| `sunrise` | −0.833° to 6° | Rising | Sunrise |
| `morning` | Above 6° | Rising | Morning |
| `afternoon` | Above 6° | Setting | Afternoon |
| `sunset` | 6° to −0.833° | Setting | Sunset |
| `dusk` | −0.833° to −6° | Setting | Dusk |

The phases are defined in one list, `DAY_PHASES` in `lib/sun.js`: each has its code, word, elevation range and range of hours from solar noon (−12 to 0 rising, 0 to 12 setting), and the first that matches wins. Changing a boundary or adding a phase (a midday within an hour of noon, say, listed before morning and afternoon) only touches that list, plus an icon for a new phase.

The icon design is to be decided. One idea: a horizon with the sun's path arcing over it, the sun on the left while rising and on the right while setting, below the line at night, and the sky's colour from the phase; a rooster or a moon could mark sunrise and night.

Polar day and night have no phases of their own: the polar night's noon sun can reach dawn, and the midnight sun can be in sunset around midnight, so the icon follows the sun and the subtitle says "Midnight sun" or "Polar night". The finer elevation bands (golden hour, the three twilights) stay as the daylight state, shown in the ⌃ details.

##### Working statuses

The time mode's icons. The hours are the city's local time, from `WORKING_DAY` in `lib/time.js` (to move to User Configuration). The colours are a traffic light for scanning which cities a time suits.

| Status | Local hours | Icon | Word | Detail |
|---|---|---|---|---|
| `morning` | 7:00–9:00 | Amber, coffee cup | Early morning | Until work starts: "work in 1h" |
| `working` | 9:00–17:00 | Green, briefcase | Working | Until work ends: "3h left" |
| `evening` | 17:00–22:00 | Amber, lamp | Evening | Since work ended: "2h after work" |
| `asleep` | 22:00–7:00 | Red, bed | Asleep | Until work starts: "work in 3h" |
| `weekend` | Saturday and Sunday, except the asleep hours | Grey, deckchair | Weekend | None |

The detail is left out when the start of work it counts to falls on a weekend. TO-DO: the `weekend` status; Saturday and Sunday by default, with an override by country code for countries whose weekend is Friday and Saturday.

#### Durations

- **Offsets from local:** hours, with minutes only for zones that have them: "+11h", "−2h", "−7h 15m", "±0h".
- **Sunrise and sunset:** to the nearest hour from an hour away ("Sunset in 2h", "Sunrise 5h ago"), and in minutes under an hour ("Sunset in 41m").
- **Working day details:** exact hours and minutes ("2h 30m left"), since they decide whether a meeting fits.

#### More details

- **⌃ (held):** the subtitle shows the daylight state and sun times, e.g. "Nautical twilight | Sunrise 5:45 AM | Sunset 7:52 PM | Day 14h 6m (+2m/day)". The `day` state reads "Daylight" here, so it isn't confused with the day length.
- **⌥:** opens Clock (see [Opening Clock](#opening-clock)).
- **⌘:** a copy variant; its subtitle shows what it copies.
- **Large Type (⌘L, `text.largetype`):** every property, one per line, including the UTC offset and the next clock change however far away.
- **`rerun`:** the list reruns every second (a run takes about 0.1s), so times and countdowns stay current while Alfred is open.

The icons are image files in `icons/`, since Alfred's item icons are paths: 12 PNGs (7 phases, 5 working statuses), drawn by a JXA script with AppKit (`NSBezierPath` to PNG), so they can be regenerated from code. A phase's icon is `icons/phase-<phase>.png`. TO-DO: design the icons. The ones there are placeholders, a plain colour with the phase's word, from `resources/make-placeholder-icons.js` (run from the workflow folder), which draws one for each phase in `DAY_PHASES`; rerun it after adding a phase.

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
- No named times (`midnight`, `noon`): numbers only, so the time mode is simply any query starting with a digit, `+` or `-`.

A time can also be relative to now, starting with `+` (later) or `-` (earlier):

```
+                      doesn't resolve
+5, +5h                5 hours from now
+90m                   90 minutes from now
+1:30                  1 hour 30 minutes from now
+1:3                   doesn't resolve (minutes incomplete)
-3                     3 hours ago
```

Rules:

- A number alone, or with `h`, is hours; with `m`, it's minutes; `H:MM` is hours and minutes. Units in any case.
- `−` (U+2212) is accepted as well as `-`.
- The result is exactly that far from now, not rounded: at 10:33, `+5` is 15:33.
- Relative times are the one way to reach the past, for "what time was it there when they sent that?".
- A relative time is the same moment everywhere, so it takes no day name and needs no city to anchor it. Text after it narrows the list instead, as in the list mode (`wcc +5 new`).

Open questions:

- What to show while the input doesn't resolve: probably a single "Keep typing…" item echoing the input. Falling back to the part that did resolve would mislead (`3:2` showing 03:00).
- Input that can't become valid by typing more (`25:00`, `13pm`, `3:75`): a single "can't read that time" result.
- Where a city goes alongside a day (`wcc 12:00 mon London`).

## How it works

### Code layout

- `results.js`: the Script Filter. Loads the files in `lib/`, chooses the mode from the query, and turns the results into Alfred's JSON, including the messages for when the list can't be loaded.
- `lib/cities.js`: reading Clock's city list, and matching cities against a query.
- `lib/time.js`: time zone calculations, and reading typed times.
- `lib/sun.js`: the sun's position, sunrise and sunset, the daylight state, and the phases of the day.
- `lib/format.js`: turning those values into text: times, offsets, durations, flags, short country names, and each city result's title, subtitle, ⌃ details and Large Type.
- `icons/`: result icons (see [More details](#more-details)).

JXA has no `import`, and `Library()` only loads from `~/Library/Script Libraries`, which a workflow can't ship in. So `results.js` reads each `lib/` file and runs it with an indirect `eval` (`(0, eval)(source)`), which runs it in the global scope. Each file's top-level functions become globals, available to `results.js` and the other files; its top-level `const` and `let` stay private to it. The catches:

- All functions share one namespace, and a name defined twice silently resolves to the later file's. Name functions for what they do on their own (`matchesCity`, not `matches`).
- An error's line number is within its file, but the error doesn't say which file.
- `lib/` paths are relative to the working directory. Alfred runs scripts from the workflow folder; when running `results.js` by hand, do the same.

### Behaviour

`results.js` reads the cities (see [Reading it](#reading-it)), keeps them in Clock's order, and filters them in the script: every word typed must start a word of the city's name or country, ignoring case and accents. Alfred's own filtering is off, because it would hide every city when a time is typed. Each item's `uid` is Clock's `identifier` for the city: on a rerun, Alfred keeps the selection on the item with the selected item's `uid`, where without one it jumps back to the first item. `skipknowledge: true` in the output stops Alfred reordering the items by usage, which `uid`s would otherwise allow, so they stay in Clock's order.

Every result defines ⌘, ⌥ and ⌃ modifiers (`withInertMods` in `results.js`); those without an action of their own are inert (`valid: false`, with the result's own subtitle). Without them Alfred applies its own modifiers, ⌥ "Search in Finder" and ⌃ "Search with default fallback", which the `strictmods` flag in the JSON doesn't stop. ⇧ is left alone for Quick Look.

The Script Filter runs 0.2s after typing pauses (Run Behaviour › Custom delay; in `info.plist`, `queuedelaymode` 2 and `queuedelaycustom` 2, in tenths of a second), and immediately for the first character. That skips most partly typed times without slowing down filtering, which "Automatic after last character typed" (`queuedelaymode` 1) did.

Each result is laid out as in [The list](#the-list), and the output asks Alfred to rerun the script every second. The computed values for the listed cities are also written to stderr as one JSON array (`logCityInfos`), which Alfred shows in the workflow's debugger. Time conversion isn't implemented: a query starting with a digit lists every city at the current time.

When the list can't be loaded, the script returns a single explanatory result: the file is missing, the file exists but can't be read (no Full Disk Access), or Clock's list is empty.

### Testing

Run `results.js` from the workflow folder, with the query as its argument. In Alfred it reads Clock's real city list, but outside Alfred that usually fails: a terminal or Claude Code session normally lacks Full Disk Access (see [Access](#access)). So when the environment variable `WCC_CITIES_PLIST` is set, the script reads the file it names instead. Alfred never sets it. That file is read directly, not through cfprefsd, which caches a file once it has read it and would miss later edits to it.

`test/cities.plist` is a city list for testing, in the same format as Clock's:

```zsh
WCC_CITIES_PLIST=test/cities.plist ./results.js "new"
WCC_CITIES_PLIST=/nonexistent ./results.js          # the "can't find" result
```

The computed values go to stderr and the Alfred JSON to stdout, so `2>/dev/null` shows just the JSON. (osascript also echoes the returned JSON to stderr, after the computed values.)

`test/` and `resources/` are in `.wfignore`, so they aren't shipped.

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

The file isn't always current. Adding or removing a city writes it straight away, but reordering doesn't (checked on macOS 27.2 by watching the file's modification time): the new order reaches cfprefsd, the service that holds apps' preferences and writes them to their files, when Clock quits, and the file only when Clock next launches. While Clock is open after a reorder, neither has it, and if Clock is force quit, the new order is lost. So the workflow reads the list through cfprefsd (see [Reading it](#reading-it)), which shows a reorder once Clock has quit; nothing shows it sooner.

Things that look like the answer but aren't:

- `~/Library/Preferences/com.apple.mobiletimer.plist`, which is what `defaults read com.apple.mobiletimer` and `NSUserDefaults` (suite `com.apple.mobiletimer`) read, holds a stale copy last written by macOS 14.5 (`citiesLastModified` 2024-07-15). Clock no longer updates it.
- `~/Library/Group Containers/group.com.apple.mobiletimerd/` holds Core Data stores (`local.sqlite`, `analytics.sqlite`). The alarms moved there (`MTAlarmStorageMigratedToCoreData = 1` in `com.apple.mobiletimerd` preferences); the cities aren't needed from it.

### Access

Both containers are covered by macOS app data protection: reading them fails with "Operation not permitted" unless the reading process has Full Disk Access. Alfred asks for Full Disk Access on first launch, so scripts run by Alfred can normally read the file. A process without it (including a terminal or Claude Code session that hasn't been granted it) can't, which matters when testing scripts outside Alfred.

The workflow should still handle the file being unreadable or missing (Full Disk Access not granted, or a future macOS moving it) with a single explanatory result rather than an empty list or a script error.

### Reading it

Read it through cfprefsd with the container file's full path, without `.plist`, as the domain. Not by the domain name `com.apple.mobiletimer` (`NSUserDefaults` suite, or `defaults read com.apple.mobiletimer`), which gets the stale copy in `~/Library/Preferences`. In JXA:

```js
ObjC.import("Foundation");
ObjC.import("CoreFoundation");
const domain = $("~/Library/Containers/com.apple.clock/Data/Library/Preferences/com.apple.mobiletimer").stringByExpandingTildeInPath;
const ref = $.CFPreferencesCopyAppValue($("cities"), domain);
const cities = (ref && ObjC.deepUnwrap(ObjC.castRefToObject(ref))) || []; // empty if unreadable
cities.map(c => c.city.name + ": " + new Intl.DateTimeFormat("en-NZ", {
  timeZone: c.city.timeZone, weekday: "short", hour: "numeric", minute: "2-digit"
}).format(new Date()));
```

Without Full Disk Access, cfprefsd returns nothing, the same as when there's no list. To tell those apart, `loadCities` (in `lib/cities.js`) also reads the file directly with `NSDictionary.dictionaryWithContentsOfFile`, which fails without access, and falls back to the file's list if cfprefsd has none.

From a terminal with Full Disk Access, for a quick look (the first through cfprefsd, the second from the file):

```zsh
defaults read ~/Library/Containers/com.apple.clock/Data/Library/Preferences/com.apple.mobiletimer.plist cities | grep unlocalizedName
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
