# World Clock

Developer notes for a workflow that shows the current time in each city from the macOS Clock app's World Clock list. So far it shows the list of cities and the time mode as designed in [Results layout](#results-layout), apart from what's marked TO-DO there. This file also records how the data can be read, and ideas for what comes next.

## To-do

- [ ] **Actions** for a city result (see [More details](#more-details)).
  - [ ] **Detail view (↩ inside Alfred, ⌘↩ in its own window):** working, but bare bones: the city, country and time (see [Detail views](#detail-views)). Design decisions to make:
    - [ ] **Content and layout:** which properties it shows (Large Type's list is the starting point) and how they're laid out, in one design that works both inside Alfred (theme width, height to fit) and in a window.
    - [ ] **The time mode (meeting planning):** how the view reflects a typed time. It shows the city now, ticking, whatever the mode. Opened from the time mode, it could show the typed time instead, or both; the typed time doesn't tick, and a window outlives the query that opened it, so a permanent window showing a typed time may mislead later.
  - [ ] **City picture in the detail view** (see [City pictures](#city-pictures)):
    - [x] **Fetching:** a cache of pictures filled in the background by a single fetcher, with a User Configuration option to turn it off and a backoff when offline.
    - [ ] **Showing it:** the picture's size and place in the view (which sets `PICTURE_WIDTH` in `fetch-pictures.js`), what shows while there's none, and crediting it from its `<slug>.json`. The pulse picks the picture up (see [Showing it](#city-pictures)).
    - [ ] **User-Agent contact:** replace the GitHub repo's URL in `USER_AGENT` (in `fetch-pictures.js`) with the workflow's Alfred forum or gallery URL once there is one. Wikimedia's User-Agent policy asks for a way to get in touch, and its rate limits are stricter for clients that don't give one.
  - [ ] **Copy** (modifier to be decided; ⌘ is taken by the detail window): probably not worth having. If kept, to decide what it copies in each mode, e.g. "9:00 AM Monday in London is 10:00 PM Monday in Auckland" in the time mode.
  - [ ] **⌥:** edit the list in the Clock app, on the World Clock tab (see [Opening Clock](#opening-clock) for the ways to get there).
  - [ ] **Alternative details:** show other data in the subtitle while a modifier is held, as ⌃ does with the sun details now.
  - [ ] **Configurable modifiers:** which modifier does which action, as User Configuration options.
  - [ ] **Remove Large Type** (`text.largetype`, `largeTypeText` in `lib/format.js`): it isn't very helpful, and the detail panel replaces it.
- [ ] **Working day in User Configuration:** the hours behind the working status, fixed in `WORKING_DAY` in `lib/time.js` (see [Configuration](#configuration)).
- [ ] **Icons:** design the 12 icons (7 phases, 5 working statuses) to replace the placeholders (see [Icon states](#icon-states)).
- [ ] **Short country names:** fill in the name-to-show column of `resources/clock-countries.csv` and use it in `lib/format.js` (see [City properties](#city-properties)).
- [ ] **Other configuration:** 12- or 24-hour time, showing the home city, sorting by time zone (see [Configuration](#configuration)).

## Design

- **One keyword**, `wcc` by default (User Configuration variable `keyword`; `wc` is taken by Word Count). `wcc` alone lists every city. What's typed after it decides the mode: text starting with a digit, `+` or `-` is a time to convert (`wcc 3pm`, `wcc 9am London`, `wcc +5` for five hours from now; see [Time input](#time-input)); anything else narrows the list (`wcc new` matches New York and New Zealand). Meeting planning is part of the time mode rather than a separate keyword.
- **A hotkey for the city list** only, for glancing at the times. A hotkey for the time mode would save nothing, since a time has to be typed anyway. Ship it unassigned so each user picks their own.
- **JXA**, in external script files run as Script Filters (type 8, input as argv). JXA reads the plist through Foundation and does time zone maths with `Intl`, so nothing needs installing. One Script Filter handles every mode, with its logic split across files in `lib/` (see [Code layout](#code-layout)).
- **The local city** is the one in the Mac's current time zone (`NSTimeZone.localTimeZone`), detected automatically, with no setting. It's the reference for relative values ("+11 hrs", and the weekday shown when a city's date differs), so it should follow the Mac when travelling, which a fixed home city setting wouldn't; the locale (e.g. `en_NZ`) doesn't change with location, so it can't be used. Cities are compared by offset (same UTC offset now and the same next clock change), not by zone name, because aliases don't resolve: `Australia/Canberra` stays `Australia/Canberra` in both `Intl` and Foundation, never `Australia/Sydney`. When several cities share the zone (Auckland and Wellington), the first in Clock's order wins. If that proves a problem, a "Set as local city" modifier could store a choice in `$alfred_workflow_data`, used only as a tiebreaker between cities in the Mac's zone.

### City properties

What the workflow knows about each city, and where each value comes from. How they're shown is in [Results layout](#results-layout).

Values marked ⏱ depend on a moment in time: the current time, or the time typed in the time mode. The functions computing them take that moment as input, so the list and the time mode share them.

A typed time always means its next occurrence (now or later), since the time mode is for planning ahead: at 3:30pm, `wcc 3pm` is 3pm tomorrow in the Mac's zone, while at exactly 3:00pm it's now. `wcc 9am London` is the next 9am in London's zone. Every result in the time mode shows its city's weekday, so each row says which day the time falls on there.

| Property | Source | Derivation |
|---|---|---|
| City name | `name` | As stored; already localized for the entry's `languageCode`. |
| Country | `countryName` | As stored. For a city-state (Singapore), the subtitle leaves the country out, since the title already names it: a city counts as one when `displayNameIncludingCountryUsesOnlyCountry` is true, or when its country has the same name, since Clock doesn't set that flag on every city-state. Shown shortened where `lib/format.js` has a short name (Great Britain → UK, U.S.A. → USA). |
| Flag | `localeCode` | Kept as the country code; shown by mapping each letter to a regional indicator symbol (A–Z → U+1F1E6–U+1F1FF), so `NZ` → 🇳🇿. No flag if the code is missing or isn't two letters. |
| Local city | `timeZone` | See [Design](#design). |
| ⏱ Local time | `timeZone` | The moment, shown with `NSDateFormatter`, a short time style and the city's `timeZone`, which follows the Mac's date and time settings, including 24-hour time. |
| ⏱ Day label | `timeZone` | After the time. In the list, "Yesterday" or "Tomorrow" when the city's calendar date differs from the Mac's ("11:33 PM Yesterday"): the list is about now, relative to you. In the time mode, the full weekday, always ("1:33 AM Thursday"), since "Tomorrow" would be ambiguous when the reference is a typed day, and weekends matter for meetings. |
| ⏱ UTC offset | `timeZone` | In minutes, from `NSTimeZone.secondsFromGMTForDate`. Shown as e.g. "UTC+13", "UTC+5:45", after the offset from local in the list's subtitle. |
| ⏱ Offset from local | `timeZone` | The city's UTC offset minus the Mac's, e.g. "+11 hrs", "−2 hrs", "−7h 15m", "±0 hrs". |
| ⏱ Upcoming clock change | `timeZone` | `NSTimeZone.nextDaylightSavingTimeTransitionAfterDate` for the date, and `secondsFromGMTForDate` on either side of it for the shift (e.g. London 28 Mar 2027, +1h; Tokyo none). Shown in the list only when it's within 7 days. In the time mode, the change that matters is the one between now and the typed time (`clockChangeFromNow`, below). |
| ⏱ Working status | `timeZone`, `localeCode` | The city's local hour against a working day from User Configuration, and its weekday against its country's weekend: e.g. working, evening, asleep, weekend. The main value in the time mode. |
| ⏱ Daylight state | `latitude`, `longitude` | The sun's elevation, from the solar position calculation below, in bands that don't overlap, so each city has one state: day (above 6°), golden hour (6° down to sunrise/sunset at −0.833°), civil twilight (to −6°), nautical twilight (to −12°), astronomical twilight (to −18°), night (below −18°). Photographers' golden hour usually runs to −4°, overlapping civil twilight; here the horizon splits them. Shown in the ⌃ details. |
| ⏱ Phase of the day | `latitude`, `longitude` | The sun's elevation and whether it's rising or setting (before or after solar noon), as one of the [phases of the day](#phases-of-the-day): night, dawn, sunrise, morning, afternoon, sunset, dusk. Shown as an icon. |
| ⏱ Previous and next sun event | `latitude`, `longitude` | The previous sunrise or sunset and the next. The nearer is shown in Large Type with the time since or until it, e.g. "Sunset in 2h" or "Sunset 41m ago". |
| ⏱ Sunrise and sunset | `latitude`, `longitude` | When the sun's elevation crosses −0.833° (horizon, allowing for refraction and the sun's disc). Today's are shown in the list's subtitle. |
| ⏱ Day length and change | `latitude`, `longitude` | Sunset minus sunrise; the change is today's length minus yesterday's, e.g. "10h 12m, +2m/day". |

Country names come from `Localizable_Countries.loctable` in `/System/Library/PrivateFrameworks/AppSupport.framework/Versions/A/Resources/`: a name for each of 242 country codes, plus 15 per-city overrides keyed by city identifier (London → England, Hong Kong → Hong Kong SAR, China), in each language Clock supports. English has four versions (`en`, `en_GB`, `en_AU`, `en_CA`), which differ only for US (U.S.A./USA), AE (U.A.E./UAE), VI and MO. `resources/clock-countries.csv` lists them all, with a column for the name to show. TO-DO: fill in that column and use it as the short-name map in `lib/format.js`, applied only to entries whose `languageCode` is English (`en` or `en_…`); other languages show the stored name.

`describeCity` (in `lib/cities.js`) computes them all for a city at a moment, as one object of raw values: times are `Date`s, including the moment itself, and are shown in the city's time zone; offsets, durations and day lengths are in minutes; states are codes (`goldenHour`, `polarNight`); the day label is a `dayOffset` of −1, 0 or 1; the clock change between now and a typed time is a `clockChangeFromNow` of `{ date, shiftMinutes, daysFromNow, isPast }`, or null (always null in the list, where the moment is now); the working day detail is a `workingDayTiming` of `{ untilStart }`, `{ untilEnd }` or `{ sinceEnd }`, in minutes, or `{ nextWorkday }`, a weekday; the country is as stored, with its code. All text, including times, offsets, flags and short country names, comes from `lib/format.js`, so display options (such as a time format) only touch that layer. The local city is an `isLocal` flag, decided once over the whole list (`findLocalCity`) so that filtering doesn't change it. `polar` is `midnightSun` or `polarNight` when the sun doesn't cross the horizon on the city's current date (not merely because the city is inside a polar circle); the day length is then 1440 or 0 minutes, and the previous or next sunrise or sunset is null when it's more than a day away. The working day is a constant in `lib/time.js` until it moves to User Configuration: asleep 22:00–7:00, morning to 9:00, working to 17:00, then evening. The weekend comes from the city's country code (`weekendDays`), using the Unicode CLDR data that ships with macOS, read through `Intl.Locale`'s week info: Friday and Saturday for Israel, Sunday alone for India, Thursday and Friday for Afghanistan. It already has the UAE's 2022 move to Saturday and Sunday, and updates with macOS. A city without a country code (Vatican City) gets Saturday and Sunday. It's the country's official weekend, which has limits: it can't differ by region (a few Malaysian states take Friday and Saturday), CLDR is wrong for some countries (Brunei's weekend is Friday and Sunday, but CLDR has Saturday and Sunday), and practice can differ from law (India's offices often take Saturday off too). Public holidays and China's shifted working days aren't covered; macOS has no data for them (see [Feature ideas](#feature-ideas)). If a wrong weekend matters, an override keyed by Clock's city identifier would handle even the regional cases.

The sun values come from the NOAA solar position algorithm (after Meeus): about 50 lines of plain JavaScript, accurate to about a minute, and offline. Near the poles the sunrise equation has no solution on some days; that's 24-hour daylight or darkness, with no sunrise or sunset to count down to and no day length change.

### Results layout

Each mode answers one question, and a result's icon and title answer it. The list answers "what's it like there right now?", so its icon shows the sky. The time mode answers "does this time suit them?", so its icon shows the working status. The rest of a city's properties are behind a modifier and Large Type rather than in the subtitle. The list and the time mode are built, with placeholder icons; ⌥ and ⌘ aren't yet.

#### The list

At 10:33 PM on a Thursday in Auckland (sun times approximate):

```
[night]      10:33 PM • Auckland • 🇳🇿
             🏠 (UTC+13) | New Zealand | ☀︎↑ 5:59 AM  ☀︎↓ 8:14 PM
[night]      8:33 PM • Canberra • 🇦🇺
             −2 hrs (UTC+11) | Australia | ☀︎↑ 5:46 AM  ☀︎↓ 7:52 PM
[night]      1:33 AM • Los Angeles • 🇺🇸
             −21 hrs (UTC−8) | USA | ☀︎↑ 6:41 AM  ☀︎↓ 4:46 PM
[night]      4:33 AM • New York • 🇺🇸
             −18 hrs (UTC−5) | USA | ☀︎↑ 6:48 AM  ☀︎↓ 4:34 PM
[morning]    9:33 AM • London • 🇬🇧
             −13 hrs (UTC) | UK | ☀︎↑ 7:27 AM  ☀︎↓ 4:05 PM
```

- **Title:** the time, "Yesterday" or "Tomorrow" when the city's date differs from the Mac's ("11:33 PM Yesterday"), " • ", then the city. The time comes first because it's the answer, and that way the times start in a column, which city names of different lengths would break. One-digit hours aren't padded: padding them to line up with two-digit hours looked wonky in Alfred's proportional font. Times have an ordinary space before AM/PM; the system formatter's narrow no-break space (U+202F) is too narrow to see in Alfred's font. The country's flag comes last, after another " • ": in the subtitle it was too small to read. A city without a country code (Vatican City) has no flag.
- **Subtitle:** offset from local (UTC offset) | country | today's sunrise and sunset in the city, as "☀↑ 7:27 AM  ☀↓ 4:05 PM". The ☀ has the text variation selector (U+FE0E) so it's drawn as a symbol, not an emoji; Clock's own sunrise and sunset icons are SF Symbols, which aren't in the system font, so they can't go in text. The offset comes first so that it starts in a column, like the times. Parts are divided by " | " rather than a dot, which looked poor before a minus sign. The local city shows 🏠 in place of the offset from local, still followed by its UTC offset. During polar day or night, "Midnight sun" or "Polar night" replaces the sun times. Working status is left out: the time already says it's evening.
- **Clock change:** when one is within 7 days, it replaces the sun times, e.g. "−12 hrs (UTC+1) | UK | Clocks go back Sun (−1h)".
- **Icon:** the [phase of the day](#phases-of-the-day).

#### The time mode

`wcc 8am` at the same moment, which is 8am on Friday in Auckland:

```
[morning]    8:00 AM Friday • Auckland • 🇳🇿
             🏠 | New Zealand | Early morning | work in 1h
[asleep]     6:00 AM Friday • Canberra • 🇦🇺
             Australia | Asleep | work in 3h
[working]    11:00 AM Thursday • Los Angeles • 🇺🇸
             USA | Working | 6h left
[working]    2:00 PM Thursday • New York • 🇺🇸
             USA | Working | 3h left
[evening]    7:00 PM Thursday • London • 🇬🇧
             UK | Evening | 2h after work
```

- **Title:** as in the list, but always with the full weekday instead of "Yesterday" or "Tomorrow", since crossing into another day is the main risk when planning a meeting.
- **Subtitle:** country | working status | how far into or out of the working day, for sliding a meeting by an hour or two. There's no offset, since the converted times already show it. The local city's subtitle starts with 🏠, as in the list.
- **Clock change:** when one falls between now and the typed time, it replaces the working day detail, e.g. "UK | Evening | Clocks go back Sun (−1h)". The converted time is already right; the note explains why it differs from what today's offset suggests, and warns that a regular meeting's offset is about to change. It's shown when the city's UTC offset at the typed time differs from now, naming the last change before the typed time, so changes that cancel out (`+8800`, a year ahead) show nothing. The day is named from now, since the change falls between now and the typed time: "today", "tomorrow", a weekday within 6 days, otherwise a date ("Clocks go forward 28 Mar (+1h)"). For a relative time in the past, it's past tense: "Clocks went forward yesterday (+1h)".
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
| `weekend` | The country's weekend days, except the asleep hours | Grey, deckchair | Weekend | Until work starts: "work Mon", or "work in 18h" on the last weekend day |

When weekend days come before the next start of work, the detail names the day work starts instead of counting the hours: "work Mon" on a Friday night (asleep) or a Saturday afternoon (weekend), "work Sun" in Israel. Once the next start of work is the following morning, it counts the hours again: "work in 18h" on a Sunday afternoon.

#### Durations

- **Offsets from local:** whole hours spelled out, so they're closer in length to offsets with minutes: "+11 hrs", "−1 hr", "±0 hrs"; otherwise hours and minutes: "−7h 15m", "+15m". Clock change shifts stay short: "(−1h)".
- **Time since or until sunrise or sunset** (Large Type): to the nearest hour from an hour away ("Sunset in 2h", "Sunrise 5h ago"), and in minutes under an hour ("Sunset in 41m").
- **Working day details:** exact hours and minutes ("2h 30m left", "work in 1h"), since they decide whether a meeting fits. At the end of the working day itself, "work just ended" rather than "0m after work".

#### More details

- **⌃ (held):** the subtitle shows the daylight state and sun times, e.g. "Nautical twilight | Sunrise 5:45 AM | Sunset 7:52 PM | Day 14h 6m (+2m/day)". The `day` state reads "Daylight" here, so it isn't confused with the day length.
- **↩:** shows the city's detail view inside Alfred, and **⌘↩** opens it in a window of its own (see [Detail views](#detail-views)). It's to show every property, including the UTC offset and the next clock change however far away (planned; see [To-do](#to-do)).
- **⌥:** opens Clock, to edit the list (see [Opening Clock](#opening-clock)).
- **Copy** (if kept): its subtitle shows what it copies.
- Which modifier does which action is to be configurable.
- **Large Type (⌘L, `text.largetype`):** every property, one per line. To be removed, since the detail panel replaces it.
- **`rerun`:** the list reruns every second (a run takes about 0.1s), so times and countdowns stay current while Alfred is open.

The icons are image files in `icons/`, since Alfred's item icons are paths: 12 PNGs (7 phases, 5 working statuses), drawn by a JXA script with AppKit (`NSBezierPath` to PNG), so they can be regenerated from code. A phase's icon is `icons/phase-<phase>.png`, and a working status's `icons/status-<status>.png`. TO-DO: design the icons. The ones there are placeholders, a plain colour with the phase's or status's word, from `resources/make-placeholder-icons.js` (run from the workflow folder), which draws one for each phase in `DAY_PHASES` and each working status in its own list; rerun it after adding a phase or status.

### Time input

Alfred reruns the script on every keystroke, so input is often partly typed: it resolves as soon as it's unambiguous, and not before. `readTypedTime` (in `lib/time.js`) reads it and works out the moment it means; its comment lists the results, including `incomplete` (could still become a time), `invalid` (can't) and `unknownCity`.

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
- The time is always its next occurrence, now or later, with or without a day: on a Monday at 11am, `12:00 mon` is today at noon; at 1pm it's next Monday. A time in the current minute counts as now: at 3:00:27pm, `3pm` is today.
- A city after the time, or after the day, reads the time in that city's zone: `9am London`, `12:00 mon London`. It's matched as in the list mode, and resolves once the cities it matches all keep the same time (`new zealand` matches Auckland and Wellington); `lon` (London, Longyearbyen) doesn't resolve yet. Text that matches no city is `unknownCity`.
- The word after the time is read as a day if it can be one, so a city starting with a day's prefix needs enough letters to rule the day out: `9am sa` doesn't resolve (Saturday or Sunday), `9am san` is a city. Likewise a lone `a` or `p` after a space is am or pm: `3 a` is 3am until `3 au` makes it Auckland.
- When the clocks go back and a time happens twice, it's the next of the two. When they go forward past it, it's read with the offset from before the change, as calendar apps do: `2:30` when clocks go forward at 2am is the moment they show 3:30.
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

Input that doesn't give a moment shows a single result in place of the cities (`typedTimeMessage` in `results.js`), since the cities at any other time would mislead (`3:2` showing 03:00, or the current time):

- **Not resolved yet** (`3:2`, `8am t`, `9am lon`): "Keep typing…", with the input as the subtitle. It's usually only seen briefly, since the script waits for typing to pause.
- **Can't become valid by typing more** (`25:00`, `13pm`, `3:75`): "Can't read that time", with examples of times it can read.
- **Text after the time that matches no city** (`9am xyz`): "No city matches “xyz”".

### Configuration

Options for the workflow's User Configuration (saved to the gitignored `prefs.plist`). So far there are the keyword (`keyword`, default `wcc`) and "Download city thumbnails" (`download_thumbnails`, on by default), which fetches the detail view's city pictures from Wikimedia (see [City pictures](#city-pictures)). TO-DO, probably:

- **12- or 24-hour time:** times follow the Mac's setting (System Settings › General › Date & Time); an option would override it for this workflow.
- **Show the home city:** whether the local city is in the list. It's a reference for the others, but its time is already in the menu bar.
- **Sort by time zone:** list the cities by UTC offset instead of in Clock's order (direction to decide).
- **Working day:** the hours behind the working status, a constant in `lib/time.js` until then (see [City properties](#city-properties)).

## How it works

### Code layout

- `results.js`: the Script Filter. Loads the files in `lib/`, chooses the mode from the query, and turns the results into Alfred's JSON, including the messages for when the list can't be loaded.
- `lib/cities.js`: reading Clock's city list, and matching cities against a query.
- `lib/time.js`: time zone calculations, and reading typed times.
- `lib/sun.js`: the sun's position, sunrise and sunset, the daylight state, and the phases of the day.
- `lib/format.js`: turning those values into text: times, offsets, durations, flags, short country names, and each city result's title, subtitle, ⌃ details and Large Type.
- `icons/`: result icons (see [More details](#more-details)).
- `lib/detail.js`, `panel.alfredui/`, `panel.zsh` and `detail.js`: the detail view (see [Detail views](#detail-views)).
- `lib/pictures.js`, `fetch-pictures.zsh` and `fetch-pictures.js`: the cache of city pictures, and the fetcher that fills it (see [City pictures](#city-pictures)).

JXA has no `import`, and `Library()` only loads from `~/Library/Script Libraries`, which a workflow can't ship in. So `results.js` reads each `lib/` file and runs it with an indirect `eval` (`(0, eval)(source)`), which runs it in the global scope. Each file's top-level functions become globals, available to `results.js` and the other files; its top-level `const` and `let` stay private to it. The catches:

- All functions share one namespace, and a name defined twice silently resolves to the later file's. Name functions for what they do on their own (`matchesCity`, not `matches`).
- An error's line number is within its file, but the error doesn't say which file.
- `lib/` paths are relative to the working directory. Alfred runs scripts from the workflow folder; when running `results.js` by hand, do the same.

### Detail views

A city's detail view is one Alfred UI, `panel.alfredui/ui.json`, opened two ways by two Alfred UI objects that differ only in their launch mode, which is a setting of the object, not of `ui.json`:

- **↩:** "Open within Alfred" (`launchmode` 0), stacked (`stackview`), so Esc goes back to the results. The window settings in `ui.json` (title, size, `frameautosave`) don't apply here: the view takes the theme's width and the height its content needs.
- **⌘↩:** "Launch externally" (`launchmode` 1): a window of its own, titled with the city's name, which stays open until closed (Esc or the close button). Each window is a separate `Alfred UI` process.

Each object comes after its own Run Script running `panel.zsh` (modifiers on connections only exist from the Script Filter, so the two routes can't share one Run Script), and opens the path it prints (`{query}`). The ⌘ modifier repeats the item's variables, since a modifier with its own `arg` needs them too. `panel.zsh` takes the city from the variables (`detail_slug`, `detail_city`), not its argument: on ↩ that's the item's `arg`, the city's name, kept for ⌘C and Universal Actions.

**One package per city.** Alfred keeps one window per `.alfredui` path: opening a path that's already open brings its window to the front rather than starting another (tested). So `panel.zsh` gives each city its own package, `$alfred_workflow_cache/panels/<detail_slug>.alfredui`, and prints its path. Each city gets its own window, reopening a city brings its window forward, and `frameautosave` (keyed on the path) remembers each city's position. A city can be open inside Alfred and in its window at the same time (tested). The package holds symlinks to `panel.alfredui/ui.json` and `detail.js`, so edits to them reach every city, and `city.json`, the city's record.

**The pulse.** `ui.json`'s `pulse` runs `./detail.js` (through the package's link) when the view opens (`now: true`) and every second after the previous run ends (`intervalmode: delay`). It prints a JSON `update` setting the labels' text by `id` (`city`, `country`, `time`), from `detailUpdate` in `lib/detail.js`, so the time ticks over on the minute in both views (tested). A run takes about 0.06s of CPU (0.4s of wall time, mostly `osascript` starting up). `detail.js` finds the package from its own path (osascript's fourth argument) and the workflow folder by resolving the link, then loads `lib/` from there like `results.js`. The labels start as a space, filled in by the first pulse; they show in full, unlike Now Playing's app name, which was truncated when its text arrived after layout, possibly because these labels are in an inline layout.

**The city's record.** The pulse describes the city from `city.json` rather than reading Clock's list: `detailVariables` puts the fields `describeCity` reads (and `isLocal`) on each result as `detail_city`, and `panel.zsh` writes them to the package each time the city is opened. That spares reading Clock's list every second, which needs Full Disk Access that the `Alfred UI` helper process may not have (untested). The record is as of the last time the city was opened.

**The view shows now**, not the result's moment: in the time mode it still shows the current time, since the pulse updates it. See [To-do](#to-do).

Notes:

- Alfred's other in-window viewer, the Text View, takes plain text or Markdown only, not HTML. Alfred UI's `webkitview` component renders HTML (`text`, or a URL or file in `src`); it was tried for the ↩ view and dropped for native components, which size to their content inside Alfred (a web view has no height of its own) and can be updated a label at a time.
- New windows all open at the default position, on top of each other, until moved.
- The root view binds ⎋ to a `finish` action. Inside Alfred, Esc in a scripted test once seemed not to leave a web view; not checked since with native components or a real key press.
- When testing with System Events, `key code 36 using command down` reaches Alfred as a plain ↩. Hold ⌘ with `key down command` … `key up command` instead.

### City pictures

A picture of each city, for the detail view. Fetching one takes too long to do when the view opens, so pictures are fetched ahead of time into a cache, by one background process at a time. The detail view doesn't show them yet (see [To-do](#to-do)); to see what's been fetched, open the cache folder in Finder (`~/Library/Caches/com.runningwithcrayons.Alfred/Workflow Data/net.smithnz.carl.worldclockcities/images/`).

**Source.** Wikidata's image (P18) for the city, with Wikipedia's page image as the fallback for a city with none. A trial on the 11 cities in Clock on 21 Nov 2026 (not in the repo):

- Wikipedia's page image (`prop=pageimages`, the article's lead image) gives the flag for a city that's also a country (Singapore, Vatican City), and nothing for "New York", which is a disambiguation page ("New York City" works). It's sometimes the nicer picture (Kathmandu, Longyearbyen).
- Wikidata's image property (P18) of the city's item, fetched as a thumbnail through Commons (`prop=imageinfo`, `iiurlwidth`), gave a photo for all 11, mostly skylines or landmarks, never a flag.
- Wikimedia served 960px-wide thumbnails when asked for 640, 85 KB to 1.1 MB each (PNGs are the large ones).
- A city has to be matched to its item: by name alone it fails on ambiguous names. Clock's coordinates pick the right one (see [Fetching](#city-pictures)).

The fetcher as built found a P18 image for all 12 test cities and all 11 in Clock, so the fallback hasn't been needed yet.

**The setting.** A User Configuration checkbox, "Download city thumbnails" (`download_thumbnails`, `1` or `0`), on by default, for anyone who'd rather the workflow made no network requests or kept nothing on disk. Off, no fetcher is started, and `results.js` deletes `images/` and the fetcher's log whenever it finds them, so cached pictures go too. Deleting them is also how open views will find out: the pulse runs in the `Alfred UI` process, which doesn't see the workflow's settings (as Now Playing found), but it does see the picture disappear. A fetcher already running when the setting is turned off notices the cache has gone before its next city and stops; it may save the picture it's fetching, which the next run of `results.js` deletes. Outside Alfred the variable is unset, which counts as on.

**The cache.** `$alfred_workflow_cache/images/`, with each city's files named after its slug (`citySlug` in `lib/cities.js`, Clock's identifier made safe for a file name, which also names its detail view package):

| File | Meaning |
|---|---|
| `<slug>.jpg` | The picture: a JPEG 960px wide (`PICTURE_WIDTH`), or the original's width when that's smaller. It's moved into place last, with `mv`, so a reader never sees half a file. |
| `<slug>.json` | Where it came from: the Wikidata item and its distance from Clock's coordinates, the source (P18 or Wikipedia's page image), the Commons file page, artist and licence (plain text from Commons' `extmetadata`), and when it was fetched. For checking matches now, and crediting the picture later. |
| `<slug>.none` | No picture found, holding the reason (no item within range, or an item with no image). Not retried. |
| `<slug>.failed` | A failure particular to the city, such as a reply that isn't JSON or a download `sips` can't convert. Its modification time is when to retry, and it holds the delay in seconds, which doubles with each failure on the same scale as the backoff. |
| `.backoff` | See [Backoff](#city-pictures). |
| `.lock` | The fetcher's lock (see [One fetcher at a time](#city-pictures)). |
| `.tmp-<pid>-*` | A fetch's temporary files: replies, headers and downloads, named with its process ID, since a fetch for a view can run alongside the fetcher. Each fetch deletes its own when it ends, and any older than 10 minutes when it starts (`STALE_TEMPORARY_MINUTES`), which are left over from one that was stopped. |

The fetcher's log is `$alfred_workflow_cache/pictures.log`, next to `images/`: one line per city, with the item it matched, the distance and the file, or why it found nothing or failed. Each fetcher that gets the lock empties it, so it covers the last run; it and fetches for a view append to it, so their lines interleave in time order.

**Backoff.** A network failure (no connection, a timeout, or Wikimedia answering 429 or 5xx) isn't the city's fault, and would fail the next city too. So the fetcher stops the whole run at the first one and records a backoff for the whole cache in `images/.backoff`: its modification time (set into the future) is when to try again, and it holds the delay, which starts at 5 minutes and doubles with each failed attempt (10, 20, 40 minutes…) up to a day (`RETRY_DELAY_FIRST`, `RETRY_DELAY_MOST`). A `Retry-After` is used when it's longer. Any request that succeeds deletes the file, so the delay starts at 5 minutes again after the next failure. Being offline for a day therefore costs about nine attempts, each ending at its first request. The next run carries on from the cities still missing.

**Rate limits.** Wikimedia limits clients that send requests in quick succession, answering 429 with a `Retry-After`: in testing, after about 10 requests in a few seconds, with a `Retry-After` of 3 seconds, rising to 45 after a few runs close together. So the fetcher spaces its requests 2 seconds apart (`REQUEST_INTERVAL_SECONDS`), and waits out a 429 whose `Retry-After` is at most 60 seconds, twice at most (`RATE_LIMIT_MOST_WAIT_SECONDS`, `RATE_LIMIT_RETRIES`), before treating it as a network failure. Filling the cache for 11 cities took 88 seconds, about 8 per city (four requests 2 seconds apart), with no 429s; after that, only a newly added city is fetched. A city whose detail view is opened meanwhile doesn't wait its turn (see [A city's view opened before its picture](#city-pictures)).

**Starting the fetcher.** `updatePictureCache` (in `lib/pictures.js`), which `results.js` calls on every run, with Clock's whole list, once it has loaded. With the setting on, it lists `images/` once, reads the modification time of `.backoff` and of any `.failed` file, and stops if `.backoff`'s time is still in the future. Any city with no picture, no `.none`, and no `.failed` waiting for its time is missing; if any are, it starts `fetch-pictures.zsh` with `NSTask` (no shell, so city names can't be read as commands), without waiting for it, passing the missing cities as JSON with their names, countries and coordinates. The fetcher then never reads Clock's list itself, which needs Full Disk Access. Errors in all this are logged to the debugger, never shown as results. It adds nothing measurable to a run (0.11s with the setting on or off, with a full cache).

The fetcher outlives the Script Filter run that started it, and Alfred's window closing (tested in Alfred).

**A city's view opened before its picture.** The fetcher goes through the missing cities in Clock's order, so on a first fill a city's view could open more than a minute before the fetcher reaches it. So `panel.zsh`, which runs each time a view opens, starts a fetch for that city alone (`fetch-pictures.zsh --view`) when the setting is on and the city has neither a picture nor a `.none`. The city's record comes from the result's `detail_picture_city` variable (`pictureFetchRecord` in `lib/pictures.js`, the same record the fetcher gets). The fetch runs in the background, alongside any fetcher already running, without the lock; it doesn't run while `.backoff` is waiting, and sends its four requests without a pause, so the picture is there about 3 seconds after the view opens (tested in a terminal: 3.4 seconds, with the fetcher running). `panel.zsh` still takes 0.01s. If the fetcher reaches the same city meanwhile, both fetch it: the picture and its `.json` are each moved into place whole, so the second just replaces the first, and each fetch's temporary files are its own. The fetcher skips any city that has its picture by the time it gets there. That overlap costs four extra requests at most, which is less trouble than coordinating the two: the fetcher is JXA, which can't take a lock per city. TO-DO: check in Alfred that the fetch survives `panel.zsh` ending (it's started with `&!`), and that the log shows its "for its detail view" line.

**Removed cities.** `updatePictureCache` also deletes the files of any city no longer in Clock's list. It's the one place that reads the whole list on every run (the fetcher only runs, and is only given cities, when a picture is missing), and listing `images/` is one directory read of a few dozen names. Two catches: it compares against the whole list, never the list narrowed by the query, and it isn't called when the list fails to load or is empty, so a lost Full Disk Access permission doesn't empty the cache.

**One fetcher at a time.** `fetch-pictures.zsh` takes a non-blocking lock when it starts and exits at once if another fetcher holds it:

```zsh
zmodload zsh/system
lock=$images/.lock
: >> $lock
zsystem flock -t 0 $lock 2>/dev/null || exit 0
```

`zsystem flock` is built into the zsh that ships with macOS. It needs the lock file to exist (`: >>` creates it, leaving it alone if it does), and it prints an error when it's refused, hence the `2>/dev/null`. The lock belongs to the process, so the kernel releases it when the fetcher exits or crashes and a stale lock can't be left behind, as it can with a PID file or a `mkdir` lock (tested: a second fetcher is refused while the first holds the lock, and gets it once the first exits). So the trigger needn't know whether a fetcher is running: starting a second one costs a zsh startup that exits straight away. The log is only opened once the lock is held, so a refused fetcher leaves the running one's log alone. A fetch for a view is the one exception to the lock (see above). If the cache is deleted (the setting turned off) and made again while a fetcher runs, the new `.lock` is a different file, which another fetcher could hold; so the fetcher checks before each city that `.lock` is still the file it locked (by inode number), and stops if not.

**Scripts.** Everything has to ship with macOS 12, Alfred 6's minimum, which rules out `jq` (macOS 15 on), and zsh can't parse JSON. So the fetcher is two scripts: `fetch-pictures.zsh` takes the lock and runs `fetch-pictures.js` as a child, so the lock is held for as long as the JXA script runs; the JXA script does everything else, running `curl`, `sips` and `mv` through `NSTask` with argument arrays, and reading the replies with `JSON.parse`. Apart from starting a fetch for a view, the zsh script exists only for the lock: JXA can't call `flock` or `open` with `O_EXLOCK` (`$.flock` and `$.open` are undefined, whichever header is imported), and Foundation's only lock, `NSDistributedLock`, is a file that can be left behind. `curl` and `sips` ship with macOS 12.

**Fetching.** `fetch-pictures.js`, one city at a time, to go easy on Wikimedia (for a view, the one city):

1. Match the city to its Wikidata item, by its unlocalized name (so the search is in English): `wbsearchentities` gives the results in order, then one `query` on wikidata.org with `prop=coordinates|pageimages` gives each result's coordinates (P625) and image (Wikidata's page image is its P18), in 2 KB rather than the 1.3 MB of `wbgetentities` claims for 10 items. Of the results within 50 km of Clock's coordinates (`MATCH_RADIUS_KM`), the first whose label, or the alias the search matched, is the city's name wins, otherwise the first. The name rules out Auckland Region, which comes first in the search and whose centre is 5.6 km from Clock's Auckland; search order puts New York City (alias "New York") before the New York Stock Exchange, which is nearer to Clock's coordinates; the distance rules out New York State. Matches so far were 0.2 to 17 km away (Phoenix is the furthest).
2. Take the item's P18 image. If it has none, its English Wikipedia article (from `wbgetentities` sitelinks) and that article's page image, which the API limits to free images.
3. Get the file's thumbnail URL from Commons at 960px (`iiurlwidth`), with its artist and licence.
4. Download it to a temporary file, convert it with `sips` to a JPEG (quality 80; resampled only if wider than 960px, which also shrinks the large PNGs), write `<slug>.json`, and `mv` the picture into place. If there's no picture, write `<slug>.none`; if the fetch fails for this city alone, `<slug>.failed`. On a network failure, write `.backoff` and stop.

Requests carry a User-Agent naming the workflow, its version and a URL to get in touch through, as Wikimedia's API policy asks (`USER_AGENT`): the GitHub repo for now, to be replaced with the workflow's forum or gallery page (see [To-do](#to-do)).

**Showing it** (planned). The pulse already runs every second in each open view, so `detail.js` can check for the city's picture and, once it's there, set it in the `update` it prints. That's one stat a second in a process that runs anyway, and a view shows its picture within a second of it arriving. Telling open views directly would need a way to find and message each `Alfred UI` process, for no visible gain. Now Playing's pulse sets its artwork's image view to a file path in every update, so sending the same path every second is a known pattern; its notes also found that an image arriving by update can keep a smaller placeholder's size, so give the image view a fixed size from the start.

**To check:**

- The picture's size in the view, which sets `PICTURE_WIDTH`.
- That `zsystem flock -t 0` refuses at once, without waiting, on macOS 12's zsh 5.8. Tested only on zsh 5.9.

### Behaviour

`results.js` reads the cities (see [Reading it](#reading-it)), keeps them in Clock's order, and filters them in the script: every word typed must start a word of the city's name or country, ignoring case and accents. Alfred's own filtering is off, because it would hide every city when a time is typed. Each item's `uid` is Clock's `identifier` for the city: on a rerun, Alfred keeps the selection on the item with the selected item's `uid`, where without one it jumps back to the first item. `skipknowledge: true` in the output stops Alfred reordering the items by usage, which `uid`s would otherwise allow, so they stay in Clock's order.

Every result defines ⌘, ⌥ and ⌃ modifiers (`withInertMods` in `results.js`); those without an action of their own are inert (`valid: false`, with the result's own subtitle). Without them Alfred applies its own modifiers, ⌥ "Search in Finder" and ⌃ "Search with default fallback", which the `strictmods` flag in the JSON doesn't stop. ⇧ is left alone for Quick Look.

The Script Filter runs 0.2s after typing pauses (Run Behaviour › Custom delay; in `info.plist`, `queuedelaymode` 2 and `queuedelaycustom` 2, in tenths of a second), and immediately for the first character. That skips most partly typed times without slowing down filtering, which "Automatic after last character typed" (`queuedelaymode` 1) did.

Each result is laid out as in [The list](#the-list), and the output asks Alfred to rerun the script every second. The computed values for the listed cities are also written to stderr as one JSON array (`logCityInfos`), which Alfred shows in the workflow's debugger.

A query starting with a digit, `+`, `-` or `−` is a time (see [Time input](#time-input)). One that gives a moment lists the cities at that moment, laid out as in [The time mode](#the-time-mode) and still in Clock's order, including with an anchor city (`9am London` doesn't move London to the top); the text after a relative time narrows the list. One that doesn't give a moment shows a single message. What the query was read as goes to stderr first, on one line starting "Typed time:" (`logTypedTime`), with the moment also shown in the zone it was read in. Only the list and relative times rerun every second: a typed clock time is a fixed moment, while a relative time moves with the clock.

When the list can't be loaded, the script returns a single explanatory result: the file is missing, the file exists but can't be read (no Full Disk Access), or Clock's list is empty.

### Testing

Run `results.js` from the workflow folder, with the query as its argument. In Alfred it reads Clock's real city list, but outside Alfred that usually fails: a terminal or Claude Code session normally lacks Full Disk Access (see [Access](#access)). So when the environment variable `WCC_CITIES_PLIST` is set, the script reads the file it names instead. Alfred only sets it when it's given a value in the workflow's variables (see below). That file is read directly, not through cfprefsd, which caches a file once it has read it and would miss later edits to it.

`test/cities.plist` is a city list for testing, in the same format as Clock's:

```zsh
WCC_CITIES_PLIST=test/cities.plist ./results.js "new"
WCC_CITIES_PLIST=/nonexistent ./results.js          # the "can't find" result
```

To pretend it's another time, set `WCC_NOW` to an ISO 8601 date and time, e.g. to try a time just before New Zealand's clocks go forward:

```zsh
TZ=Pacific/Auckland WCC_NOW=2026-09-26T12:00+12:00 WCC_CITIES_PLIST=test/cities.plist ./results.js "9am mon"
```

To try another home city, set `TZ` to an IANA zone name: macOS takes the local time zone from it, so the city in that zone becomes the local one. In a terminal:

```zsh
TZ=America/New_York WCC_CITIES_PLIST=test/cities.plist ./results.js
```

In Alfred, set any of these as workflow environment variables (the [𝒙] sheet), with Don't Export ticked. A relative `WCC_CITIES_PLIST` is relative to the workflow folder, so `test/cities.plist` works. They're saved in `info.plist`, but the pre-commit hook blocks a commit while a Don't Export variable has a value, so they can't be committed by mistake. An empty `WCC_CITIES_PLIST` or `WCC_NOW` counts as unset (`environmentValue` in `lib/cities.js`), so they can be left in the sheet, empty, between tests. An empty `TZ` is harmless too: Foundation ignores it, and the workflow takes the Mac's zone from Foundation (`macTimeZone`). JavaScript's own `Date` treats an empty `TZ` as UTC, so a `WCC_NOW` without an offset would be read as UTC; give it one.

To try the detail view's scripts, build a city's package in a scratch cache from a result's variables, then run its pulse (from anywhere, since `detail.js` finds `lib/` itself):

```zsh
item=$(WCC_CITIES_PLIST=test/cities.plist ./results.js 2>/dev/null | jq '.items[0].variables')
export detail_slug=$(jq -r .detail_slug <<< $item) detail_city=$(jq -r .detail_city <<< $item)
package=$(alfred_workflow_cache=/tmp/wcc-test ./panel.zsh)
$package/detail.js
```

The computed values go to stderr and the Alfred JSON to stdout, so `2>/dev/null` shows just the JSON. (osascript also echoes the returned JSON to stderr, after the computed values.)

To try the picture cache, point the cache at a scratch folder. `results.js` starts the fetcher in the background for any city missing a picture, as in Alfred; `fetch-pictures.zsh` can also be run directly, with cities as JSON, and waits until it's done:

```zsh
export alfred_workflow_cache=/tmp/wcc-test WCC_CITIES_PLIST=test/cities.plist
./results.js > /dev/null                 # starts the fetcher if a picture is missing
cat /tmp/wcc-test/pictures.log; ls /tmp/wcc-test/images
./fetch-pictures.zsh '[{"slug":"999","name":"Paris","latitude":48.86,"longitude":2.35}]'
download_thumbnails=0 ./results.js > /dev/null   # deletes the cache and the log
https_proxy=http://127.0.0.1:9 ./results.js      # curl fails, as when offline: sets .backoff
```

A city that isn't in the list (like slug 999 above) is deleted from the cache by the next run of `results.js`. To end a backoff early, delete `images/.backoff`.

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
- **Country flags**, from the country code (e.g. `NZ` → 🇳🇿).
- **More copy options:** copy just the time, or all cities as a list for pasting into a message; Large Type for showing the time across a room.
- **Cities not in Clock:** e.g. `wcc tokyo` matches any time zone macOS knows when the city isn't in the list. Without coordinates these would show the time only, no daylight info.
- **Local city:** if one of the cities is in the Mac's time zone, mark it as local and use it as the reference in subtitles (e.g. "+11h from you").
- **Small extras:** day length and how it's changing (e.g. "10h 12m, +2m/day").
- **Public holidays** in the working status. macOS has no holiday data: CLDR, where the weekends come from, has none, and neither does Foundation or `Intl`. Calendar's holiday calendars are subscriptions served by Apple. A user's subscribed holiday calendars could be read through EventKit, but that needs Calendar access for Alfred and only covers the countries they've added. Otherwise it would need an online source (public holiday feeds, or a keyless API such as Nager.Date), cached a year at a time in `$alfred_workflow_cache`; regional holidays (US and Australian states, New Zealand's anniversary days) are patchy everywhere. The most promising option is offline: [date-holidays](https://www.npmjs.com/package/date-holidays), a maintained JavaScript library with rules for countries worldwide and their regions, which could be vendored. Its code is ISC-licensed but its data is CC-BY-SA-4.0, so shipping it means crediting it, with share-alike terms on the data. It's large (the npm package unpacks to 12 MB, including dependencies such as moment-timezone), so it would load only in the time mode, caching each country's holidays a year at a time. Clock gives a city's country but not its region, so national holidays come free and regional ones would need a per-city setting. TO-DO, if pursued: check that its browser bundle runs under JXA, and how long it takes to load.
- Weather is out of scope: it would need an online service and an API key. So is moon phase: it's the same everywhere at a given moment, so it isn't a property of a city, and would suit a separate workflow.

## Caveats

The file location and format are undocumented and private to Apple. They have already changed once (the move into the sandbox container left the old copy behind), and could change again in any macOS update without notice.
