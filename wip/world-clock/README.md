# World Clock

Developer notes. Research for a workflow that shows the current time in each city from the macOS Clock app's World Clock list. There is no workflow yet (no `info.plist`, so `bin/wf` ignores this folder); this file records how the data can be read.

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

## Design sketch

- Script Filter in an external JXA script: one row per city, in Clock's order, with the local time and day as the title and the offset from local time in the subtitle (e.g. "Sat 2:15 PM · +2h"). Filtering by city or country name.
- Actions: copy the time; open Clock on the World Clock tab, via a bundled shortcut if the user has imported it and plain `open -b com.apple.clock` otherwise (see [Opening Clock](#opening-clock)).
- Fallback: an optional city list in User Configuration, used when Clock's list can't be read.
- The coordinates could drive extras such as a day/night icon per city.
- Read-only: adding, removing and reordering cities stays in Clock.

## Caveats

The file location and format are undocumented and private to Apple. They have already changed once (the move into the sandbox container left the old copy behind), and could change again in any macOS update without notice.
