#!/usr/bin/osascript
-- Opens the Clock app on its World Clock tab, for editing the list of cities
-- (⌥↩ on a city).
--
-- Clock reopens on whichever tab was used last, and offers no URL or
-- scripting interface to pick one, so this presses the menu item for the tab
-- through System Events: the item whose key is ⌘1 (View › World Clock). It's
-- found by its key rather than its name or position, which depend on the
-- language and on Clock's menus. The press is the accessibility AXPress action
-- on the item, which works whether or not Clock is in front, unlike a
-- keystroke; JXA's equivalent (actions.byName("AXPress").perform()) silently
-- does nothing, hence AppleScript.
--
-- Needs Accessibility access for Alfred, and Automation access to System
-- Events, which macOS asks for the first time. Without either, or if no item
-- has ⌘1, Clock still opens, on its last tab, and the reason goes to stderr
-- (Alfred's debugger).

on run argv
	-- reopen gives Clock a window if it's running with none, as clicking its
	-- Dock icon does.
	tell application "Clock"
		reopen
		activate
	end tell
	try
		tell application "System Events" to tell process "Clock"
			-- On launch, the menus aren't set up until the window is.
			repeat 50 times
				if (count of windows) > 0 then exit repeat
				delay 0.1
			end repeat
			repeat with barItem in (menu bar items 2 thru -1 of menu bar 1)
				set theMenu to menu 1 of barItem
				set cmdKeys to value of attribute "AXMenuItemCmdChar" of menu items of theMenu
				set cmdModifiers to value of attribute "AXMenuItemCmdModifiers" of menu items of theMenu
				repeat with i from 1 to count of cmdKeys
					-- Modifiers 0 is ⌘ alone.
					if item i of cmdKeys is "1" and item i of cmdModifiers is 0 then
						perform action "AXPress" of menu item i of theMenu
						return
					end if
				end repeat
			end repeat
		end tell
		log "Clock has no menu item with ⌘1, so it's open on its last tab"
	on error message number code
		log "Couldn't switch Clock to World Clock (" & code & "): " & message
	end try
end run
