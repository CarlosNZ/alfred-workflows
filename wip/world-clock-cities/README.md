# World Clock

## Usage

See the current time in each city from the macOS **Clock** app's World Clock list with the `wcc` keyword, or set a Hotkey for it.

Each city shows its time, how far ahead or behind you it is, and today's sunrise and sunset. A clock change in the coming week is shown too. Type a city or country to narrow the list: `wcc new` matches New York and New Zealand.

- <kbd>↩</kbd> Show the city's details
- <kbd>⌘</kbd><kbd>↩</kbd> Open the city's details in a window of its own, which stays open
- <kbd>⌥</kbd><kbd>↩</kbd> Edit your cities in the Clock app
- <kbd>⌃</kbd> (held) See whether each city is in its working day, and how long it has left

The cities are the ones in Clock's World Clock list, in the same order, so add, remove and reorder them in Clock.


## Converting a time

Type a time to see it in every city, with whether people there are working, and how far into or out of their working day it falls. Handy for finding a meeting time that suits everyone.

- `wcc 3pm` or `wcc 15:30`: the next 3pm in your time zone
- `wcc 9am mon`: 9am next Monday
- `wcc 9am London`: 9am in London
- `wcc +5`, `wcc +90m` or `wcc -3`: five hours from now, 90 minutes from now, three hours ago

Hold <kbd>⌃</kbd> to see each city's offset instead, and whether it's light or dark there at that time.


## Configuration

- **Keyword** and **Hotkey**
- **Time format**: follow your Mac's setting, or always 12- or 24-hour time
- **Home city**: include the city in your Mac's time zone
- **Sort by time zone**: Clock's order, or by UTC offset
- **Working day start time** and **end time**: the working day behind each city's working status
- **City pictures**: download city images from Wikimedia Commons for the details
- **Action keys**: which modifier key does each action
- **Window buttons**, **Corner radius** and **Transparency**: the look of the details window


## Permissions

Alfred needs Full Disk Access to read Clock's list of cities, which it asks for when you first set it up. Editing your cities in Clock (<kbd>⌥</kbd><kbd>↩</kbd>) uses Alfred's Accessibility access to switch Clock to its World Clock tab.

<!-- end of Alfred readme -->

---

For how the workflow is built, see the [developer notes](DEVELOPMENT.md).
