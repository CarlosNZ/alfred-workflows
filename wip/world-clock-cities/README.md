# World Clock

Developer notes for a workflow that shows the current time in each city from the macOS Clock app's World Clock list. The workflow is a skeleton so far: it lists the cities with their UTC offsets. This file also records how the data can be read, and ideas for what comes next.

## Design

- **One keyword**, `wcc` by default (User Configuration variable `keyword`; `wc` is taken by Word Count). `wcc` alone lists every city. What's typed after it decides the mode: text starting with a digit is a time to convert (`wcc 3pm`, `wcc 9am London`); anything else narrows the list (`wcc new` matches New York and New Zealand). Meeting planning is part of the time mode rather than a separate keyword.
- **A hotkey for the city list** only, for glancing at the times. A hotkey for the time mode would save nothing, since a time has to be typed anyway. Ship it unassigned so each user picks their own.
- **JXA**, in external script files run as Script Filters (type 8, input as argv). JXA reads the plist through Foundation and does time zone maths with `Intl`, so nothing needs installing. JXA can't easily share code between script files, so one script handles every mode.

## How it works

`results.js` is the Script Filter for the keyword. It reads the cities (see [Reading it](#reading-it)), keeps them in Clock's order, and filters them in the script: every word typed must start a word of the city's name or country, ignoring case and accents. Alfred's own filtering is off, because it would hide every city when a time is typed. Items have no `uid`, so Alfred doesn't reorder them by usage.

Each result shows the city name, with the country and current UTC offset as the subtitle. Time conversion isn't implemented: a query starting with a digit lists every city.

When the list can't be loaded, the script returns a single explanatory result: the file is missing, the file exists but can't be read (no Full Disk Access), or Clock's list is empty.

To test without Full Disk Access, run a copy pointed at the stale plist, which has the same shape:

```zsh
sed "s|~/Library/Containers/com.apple.clock/Data/Library/Preferences/com.apple.mobiletimer.plist|$HOME/Library/Preferences/com.apple.mobiletimer.plist|" results.js > /tmp/test.js
osascript -l JavaScript /tmp/test.js "new"
```

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
- **Small extras:** day length and how it's changing (e.g. "10h 12m, +2m/day"), and moon phase.
- Weather is out of scope: it would need an online service and an API key.

## Caveats

The file location and format are undocumented and private to Apple. They have already changed once (the move into the sandbox container left the old copy behind), and could change again in any macOS update without notice.
