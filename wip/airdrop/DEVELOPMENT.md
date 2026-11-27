# AirDrop

Developer notes for a Universal Action that opens Apple's AirDrop panel with the files, URLs or text it's given already loaded, so the user only picks the device, and a keyword that does the same with what's on the clipboard. The user guide is in [README.md](README.md).

## To-do

- Test the keyword from Alfred with files copied in Finder, with copied text, and with a screenshot copied to the clipboard (⇧⌃⌘4).

## Design

- **Apple's panel, not a device list in Alfred.** The public API is `NSSharingService` named `NSSharingServiceNameSendViaAirDrop`, whose `performWithItems:` shows the AirDrop panel. There's no public API to list nearby devices or to choose the recipient in code, so the device is always picked in the panel.
- **JXA through the ObjC bridge**, in one external script (`airdrop.js`, type 8, input as argv), so nothing needs installing or compiling. A compiled helper app was the fallback if the panel didn't work from `osascript`, but it does, which avoids signing and notarising a binary (see [Compiled binaries](../../README.md#compiled-binaries)).
- **Text becomes a file.** Text is written to a `.txt` file in `$alfred_workflow_cache/items/<UUID>/`, named after its first line (up to 40 characters, with `/`, `:` and `\` replaced), which is what the recipient sees. Each run gets its own folder, as the AirDrop daemon may still be reading an earlier run's files; folders older than a day are removed at the start of each run.
- **URLs** are arguments that look like `scheme://…` and are sent as `NSURL`s. Existing absolute paths are sent as files (folders too). Anything else is text.
- **The clipboard keyword runs the same script with no input** (the Keyword object takes no argument, and Alfred passes one empty string), which the script takes to mean the clipboard; a Universal Action always passes at least one item. The keyword is the User Configuration variable `keyword`, `airdrop` by default. It sends, in this order of preference:
  - **Files copied in Finder** (file URLs on the pasteboard). These come first because Finder also puts the files' names on the pasteboard as text and their icons as an image.
  - **Text**, treated like an argument: a path, a URL or text.
  - **An image**, such as a screenshot copied to the clipboard, saved as `Image.png` in the run's folder in the cache.
- **Errors only** reach the user: the script prints a message to stdout when it can't show the panel, which a Post Notification shows ("only show if populated"). A successful run prints nothing, so there's no notification for it. Done and Cancel can't be told apart (see below), so the workflow never claims something was sent.
- **Runs concurrently** (Run Script `concurrently`), so a second AirDrop isn't queued behind a panel that's still open.

## How it works

`airdrop.js`:

1. Turns the arguments, or with none the clipboard's contents, into items: file URLs, URLs, and file URLs for text and images written to the cache.
2. Makes the process an accessory app (`NSApplicationActivationPolicyAccessory`: no Dock icon) and calls `performWithItems:` on the AirDrop service, after checking `canPerformWithItems:` (false when AirDrop is unavailable, such as with Wi-Fi off).
3. Runs the run loop until the panel has appeared and closed again, then exits. The panel's windows belong to this process, so it has to keep running while the panel is open. If no window appears within 30 seconds, it reports that the panel didn't open; a panel left open is closed after 10 minutes.

### The panel and the transfer

Found by watching the unified log (`/usr/bin/log show --predicate 'process == "sharingd"'`; `log` alone is a zsh builtin) while sending:

- The panel is Apple's AirDrop share extension (`com.apple.share.AirDrop.send`), hosted for the calling process and shown in an `SHKTransparentWindow` the size of the display. The window starts invisible and becomes visible 0.3 to 4 seconds after `performWithItems:`.
- When a device is picked, the extension hands the send to the system AirDrop daemon, `sharingd`, which issues its own sandbox tokens for the files, holds an OS transaction and power assertion, and runs the ask and upload itself.
- Pressing Done closes the panel, and the calling process tears the extension down within milliseconds, but the daemon's upload carries on to the end. Tested with a 1.5 GB file, pressing Done mid-upload, both with the script still running and with it exiting as soon as the panel closed. So the script doesn't wait for transfers.
- The sharing service's delegate reports `sharingService:didShareItems:` for Cancel as well as Done ("Completed Successfully" in the extension's log), so the script can't tell whether anything was sent, and doesn't use a delegate.
- A failed send (the receiving device not answering the ask) fails in the daemon on its own timeline, whatever the script does; the daemon retries the ask before giving up.

### Window placement and activation

`osascript` started in the background isn't always made the active app, and the panel once opened behind the frontmost window. The script calls `activateIgnoringOtherApps:` and then `orderFrontRegardless` on the panel's windows once they're visible, which brings it to the front. macOS chooses the display: in testing the panel opened on either display of a two-display setup. Positioning it hasn't been tried.

## Testing

Run the script directly; the progress lines go to stderr:

```zsh
alfred_workflow_cache=/tmp/airdrop-test wip/airdrop/airdrop.js ~/Desktop/file.pdf "https://example.com" "Some text
on two lines"
```

Check that the panel appears in front with every item loaded, that the script exits when the panel closes (Done or Cancel) with nothing on stdout, and that `/tmp/airdrop-test/items/` holds a `.txt` file per text argument. A run with no arguments (or one empty argument, as the keyword passes) sends the clipboard, and logs which kind of contents it found (`clipboard: text`, `clipboard: 2 file(s)` or `clipboard: image`).

The `osascript` process doesn't answer Accessibility requests (error -25204), so System Events can't press the panel's buttons. Posting a mouse click with `CGEventPost` works: the panel sits centred in a display-sized window named "AirDrop" (find it with `CGWindowListCopyWindowInfo` by the script's pid), with Cancel 131 points right of and 102 points below the window's centre.

## Caveats

- AirDrop has to be on, with the receiving device awake and discoverable. "No People Found" in the panel is AirDrop's, not the workflow's.
- A device signed in to the same Apple ID accepts automatically, so the ask stage lasts under a second.
