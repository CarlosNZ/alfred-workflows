# Word Count

Developer notes. Counts words, lines and characters in the clipboard or in selected text.

## How it works

Everything is inline bash in `info.plist`; there are no external script files. Counts come from the standard `wc` command.

| Entry point | Input | Script | Output |
|---|---|---|---|
| `wc` keyword (Script Filter) | clipboard (`pbpaste`) | builds a single result as Script Filter JSON | ↩ shows the counts in Large Type |
| ⌃W hotkey | selected text, passed as argv (`$1`) | "selection" action script | Large Type |
| Hotkey with no key assigned | clipboard (`pbpaste`) | "clipboard" action script | Large Type |

## Notes

- The selection script once took its input via `{query}` with only double quotes escaped, so backticks and `$(…)` in selected text were executed. It takes the text as `$1` (`scriptargtype` 1); keep it that way.
- No `version` yet, and the user-facing readme ("About this Workflow") is empty; fill it in before the first release.
- The bundle ID `wc.carlosnz.v1` is due to change (probably to `com.carlosnz.word-count`) before the first release, after which it is fixed.

## Testing

The scripts can be pulled out of `info.plist` by object UID and run under bash, which is what Alfred uses. A helper for the shell session:

```zsh
wcscript() { python3 -c 'import plistlib,sys; print(next(o["config"]["script"] for o in plistlib.load(open("info.plist","rb"))["objects"] if o["uid"].startswith(sys.argv[1])))' $1 }
```

- Script Filter (reads the clipboard; prints JSON): `/bin/bash -c "$(wcscript 868C62D4)" | jq`
- Selection script, with awkward input: ``/bin/bash -c "$(wcscript 09E641C2)" _ 'text with "quotes" > and `backticks`'`` should print the counts and create no files.
