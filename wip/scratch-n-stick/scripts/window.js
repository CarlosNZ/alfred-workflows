#!/usr/bin/osascript -l JavaScript

// The note window's actions, run by its Alfred UI events (see ui/):
//
//   window.js launched <id> <form> <mode>   the window opened: records its state
//   window.js save <id> <form> <text>       typing stopped: saves the text
//   window.js toggle <id> <form> <text>     the Edit / View button, or Edit /
//                                           Preview in the actions menu
//   window.js edit <id> <form> <text>       ↩ in View: to Edit
//   window.js view <id> <form> <text>       ⌘↩ in Edit: saves, to View
//   window.js colour <id> <form> <slot>     a colour in the colour picker, or
//                                           ⌘1 to ⌘6: its slot, 1 to 6
//   window.js icon <id> <form> <icon>       an icon, or "none", in the icon
//                                           picker
//   window.js fontsize <id> <form> <size>   a size in the Font size menu, or
//                                           "bigger" (⌘+), "smaller" (⌘−) or
//                                           "default" (⌘0, or Default)
//   window.js collapse <id> <form> <text>   a double-click on a sticky
//                                           window's top strip: collapses or
//                                           expands the window
//   window.js menu <id> <form> <text>       the actions menu's button (…) or
//                                           ⌘K: opens the actions menu
//   window.js trash <id> <form> <text>      Move to Trash in the actions menu:
//                                           moves the note to the Trash and
//                                           closes the window
//   window.js share <id> <form> <text>      Share… in the actions menu: the
//                                           share menu, with the note's file
//   window.js copyrich <id> <form> <text>   Copy as Rich Text: the note,
//                                           rendered, on the clipboard
//   window.js copytext <id> <form> <text>   Copy as Markdown Text: the note's
//                                           Markdown on the clipboard
// (The pickers are drop-downs that scripts/picker.sh opens and closes.)
//   window.js stick <id> <form> <text>      Stick or ⌘D in a quick view: saves,
//                                           then sticks
//   window.js tick <id> <form> <line> <x|o> a task box in View: ticks (x) or
//                                           unticks (o) the task on that line
//                                           (from scripts/changed.sh)
//   window.js quit <id> <form> <text>       the window closed: saves, deletes
//                                           the note if it's empty, and keeps
//                                           a sticky window's state for a
//                                           while (see quit)
//
// <form> is "quick" or "sticky", which says which bundle the window opened
// from (see "Note windows" in lib.js).
//
// <text> is the editor's text ({value:editor.text}). The editor stays in the
// window in View mode, hidden, with the text it had when it was last shown (or
// none), so the mode comes from the window's state, and nothing is saved from
// View mode, where the file is already up to date (switching to View saves
// first). Text and IDs arrive escaped as they were in the window (see
// escapeForAlfredUi in lib.js).
//
// In a quick view these run inside Alfred's own process, which waits for them,
// so nothing here may wait on Alfred (an AppleEvent to Alfred would deadlock).
// The window's scripts get the alfred_* variables but not User Configuration,
// so the notes folder and the window's look come from the context written into
// the note's bundle (by list.js for a quick view, by open.js when sticky).
//
// Collapsing: a double-click on a sticky window's top strip (titlestrip, a
// view along the window's top, under the top row's buttons, which still drags
// the window) shrinks it to that strip, as a double-click on the title bar
// does in Stickies, showing only its close button and the note's title, and
// expands it again. A `window` action's `resize` sets the window's height,
// below its minimum size too, and keeps its top edge where it is. While it's
// collapsed, the window's state says so, and its note's sidecar has
// `collapsed`, the height it expands back to, so a note closed collapsed
// opens collapsed the next time it's sticky (its bundle's context has it too,
// so the parts the window's scripts give it, such as the customise group
// after a colour change, are built hidden). The Edit / View switch, the
// drop-downs and ↩ do nothing while it's collapsed.

ObjC.import("Foundation");
ObjC.import("unistd");

function run(argv) {
  const workflowFolder = $(loadLib(argv, "lib.js")).stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.js;
  loadLib(argv, "text-rules.js");
  const [command, escapedId, form, ...rest] = argv;
  const id = unescapeFromAlfredUi(escapedId || "");
  if (form !== "quick" && form !== "sticky") throw new Error(`Unknown form: ${form}`);
  const context = readNoteContext(id, form);
  if (!context) throw new Error(`No window context for ${JSON.stringify(id)}`);
  const store = noteStore(context.folder);
  switch (command) {
    case "launched":
      return launched(store, workflowFolder, context, id, form, rest[0]);
    case "save":
      save(store, id, form, unescapeFromAlfredUi(rest[0] || ""));
      return;
    case "toggle":
    case "edit":
    case "view":
      return switchMode(store, workflowFolder, context, id, form, unescapeFromAlfredUi(rest[0] || ""), command === "toggle" ? null : command);
    case "quit":
      quit(store, id, form, unescapeFromAlfredUi(rest[0] || ""));
      return;
    case "stick":
      return stick(store, id, form, unescapeFromAlfredUi(rest[0] || ""));
    case "colour":
      return setColour(store, workflowFolder, context, id, form, rest[0]);
    case "icon":
      return setIcon(store, workflowFolder, context, id, form, rest[0]);
    case "fontsize":
      return setFontSize(store, workflowFolder, context, id, form, rest[0]);
    case "collapse":
      return toggleCollapsed(store, workflowFolder, context, id, form, unescapeFromAlfredUi(rest[0] || ""));
    case "menu":
      return actionsMenu(store, workflowFolder, id, form, unescapeFromAlfredUi(rest[0] || ""));
    case "trash":
      return trashNote(store, id, form, unescapeFromAlfredUi(rest[0] || ""));
    case "share":
    case "copyrich":
    case "copytext":
      return shareNote(store, workflowFolder, id, form, command, unescapeFromAlfredUi(rest[0] || ""));
    case "tick":
      return tick(store, context, id, form, Number(rest[0]), rest[1]);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// The window has opened. Records its state, except in a quick view of a note
// that's already sticky: that view finishes as Stick does, carrying on to the
// stick route, which brings the sticky window to the front, so a note is never
// open in two windows. (↩ on a sticky note doesn't open a quick view at all,
// so this only catches a note sticky after the results were listed; see
// noteItem in list.js.) And if a quick view's note has changed since list.js
// wrote its bundle (an edit elsewhere just before ↩), it shows the note as it
// is now, so a stale text can't be saved over it: in the editor, or by
// reloading the page.
//
// A sticky window's size is saved when it closes, collapsed or not, and
// restored when it opens (`frameautosave`), so it's set here to match: a
// collapsed window to the collapsed height, and one that isn't collapsed but
// opened shorter than its minimum height (closed collapsed, with its sidecar
// changed since, by a sync from another Mac, say) to the default height.
function launched(store, workflowFolder, context, id, form, mode) {
  if (form === "quick" && stickyNotePid(id) !== null) {
    return JSON.stringify({ finish: { variables: { stick_note: escapeForAlfredUi(id) } } });
  }
  const pid = $.getppid();
  const collapsed = form === "sticky" && context.collapsed != null;
  const launched = form === "sticky" ? processLaunchTime(pid) : null;
  writeNoteState(id, { form, pid, ...(launched === null ? {} : { launched }), mode, collapsed });
  closeNotePickerState(id);
  if (form === "sticky") return stickyWindowSize(workflowFolder, pid, collapsed);
  const note = form === "quick" ? store.read(id) : null;
  if (!note || textHash(note.text) === context.textHash) return;
  if (mode === "edit") {
    updateNoteContext(id, form, { textHash: textHash(note.text) });
    return JSON.stringify({ update: { ids: { editor: { text: escapeForAlfredUi(note.text) } } } });
  }
  return JSON.stringify({ update: { ids: { web: { src: writeNotePage(id, form, note.text) } } } });
}

// Typing has stopped: saves the editor's text, if it's the editor's (see
// isEditorText). The event fires about a second after the last keystroke, so
// it can come after a switch to View, which has already saved the text.
function save(store, id, form, text) {
  if (isEditorText(windowState(id), form, text)) store.save(id, text);
}

// Switches the window to mode `to` ("edit" or "view"), or to the other mode
// when `to` is null, through the saved file. Both modes are in the window all
// the time (see "Note windows" in lib.js), so it prints an update: to Edit, it
// fades the web view out and shows the editor, with the file's text and the
// caret at its end; to View, it saves the editor's text, hides the editor and
// reloads the web view's page with the file's text (the page has the web view
// shown once it has drawn; see scripts/changed.sh). The toggle button changes
// its symbol and tooltip, and a quick view's key hints name the other
// mode's key. It also remembers the mode in the note's sidecar, so
// the note reopens in it. The icon picker closes, if it's open (see
// scripts/picker.sh). Does nothing when the window is already in mode
// `to` (⌘↩ is a shortcut of the whole window, so it also reaches this in View
// mode), or when it has no state of its form (its `launched` failed, or it
// handed over to a sticky window), since then its mode is unknown.
function switchMode(store, workflowFolder, context, id, form, text, to) {
  const state = windowState(id);
  if (!state || state.form !== form || state.collapsed) return;
  const from = state.mode === "view" ? "view" : "edit";
  if (to === from) return;
  if (from === "edit") store.save(id, text);
  const mode = from === "edit" ? "view" : "edit";
  const note = store.read(id);
  const current = note ? note.text : "";
  const options = noteWindowOptions(context, { workflowFolder, id, form, mode });
  const { image, tooltip, accessibility } = findNoteComponent(noteWindowPart(options, "actions"), "toggle");
  const ids = { toggle: { image, tooltip, accessibility } };
  // A quick view's key hints are replaced rather than updated, so they're
  // laid out for their new text: Alfred UI doesn't measure a label again
  // when an update changes it.
  const replace = form === "quick" ? { ids: { keyhints: noteWindowPart(options, "keyhints") } } : undefined;
  if (closeNotePickerState(id)) Object.assign(ids, noteDropdownsClosed());
  if (mode === "edit") {
    Object.assign(ids, { web: { opacity: 0 }, editor: { hidden: false, text: escapeForAlfredUi(current), focus: true } });
    // A quick view's strip along the top has the page's colour in View (see
    // scripts/changed.sh), and Alfred's own background in Edit.
    if (form === "quick") ids.titlestrip = { opacity: 0 };
  } else {
    Object.assign(ids, { editor: { hidden: true }, web: { src: writeNotePage(id, form, current) } });
  }
  writeNoteState(id, Object.assign(state, { mode }));
  store.updateMeta(id, { mode });
  return JSON.stringify({ replace, update: { ids } });
}

// Gives the note the colour in the palette's slot `slot` (1 to 6, of the
// palette in the window's context): records it in the note's
// sidecar (which works for a new note that isn't saved yet) and in the
// window's context, so what the window's scripts give it later matches, and
// prints the replace action for the top row's customise group, whose dot
// shows the colour, and for the colour picker, which marks it and comes back
// hidden; the other drop-down and the catcher are hidden too, so choosing
// closes the open picker. A sticky window's tint has already been updated by
// the action that ran this (see noteColourAction in lib.js), but its page
// covers it, so in View the page is reloaded with the new tint too. Does
// nothing without a state of the window's form, as for switchMode.
function setColour(store, workflowFolder, context, id, form, slot) {
  const colour = notePaletteColour(context.palette || noteDefaultPalette(), slot);
  if (!colour) throw new Error(`Unknown colour: ${slot}`);
  const state = windowState(id);
  if (!state || state.form !== form) return;
  store.updateMeta(id, { colour: colour.slot });
  updateNoteContext(id, form, { colour: colour.slot });
  const mode = state.mode === "view" ? "view" : "edit";
  const options = noteWindowOptions(Object.assign(context, { colour: colour.slot }), { workflowFolder, id, form, mode });
  const customise = noteWindowPart(options, "customise");
  const colourpicker = findNoteComponent(noteWindowPart(options, "content"), "colourpicker");
  closeNotePickerState(id);
  const ids = noteDropdownsClosed();
  delete ids.colourpicker;
  if (form === "sticky" && mode === "view") {
    const note = store.read(id);
    ids.web = { src: writeNotePage(id, form, note ? note.text : "") };
  }
  return JSON.stringify({ replace: { ids: { customise, colourpicker } }, update: { ids } });
}

// Gives the note the icon named `name`, or no icon for "none": records it in
// the note's sidecar (removing the key for none; this works for a new note
// that isn't saved yet) and in the window's context, and prints the replace
// action for the top row's customise group, whose icon button shows it, and
// for the icon picker, which marks it and comes back hidden; the other
// drop-down and the catcher are hidden too, so choosing closes the open
// picker. Does nothing without a state of the window's form, as for
// switchMode.
function setIcon(store, workflowFolder, context, id, form, name) {
  if (name !== "none" && !noteIconByName(name)) throw new Error(`Unknown icon: ${name}`);
  const state = windowState(id);
  if (!state || state.form !== form) return;
  const icon = name === "none" ? null : name;
  store.updateMeta(id, { icon });
  updateNoteContext(id, form, { icon });
  const mode = state.mode === "view" ? "view" : "edit";
  const options = noteWindowOptions(Object.assign(context, { icon }), { workflowFolder, id, form, mode });
  const customise = noteWindowPart(options, "customise");
  const iconpicker = findNoteComponent(noteWindowPart(options, "content"), "iconpicker");
  closeNotePickerState(id);
  const ids = noteDropdownsClosed();
  delete ids.iconpicker;
  return JSON.stringify({ replace: { ids: { customise, iconpicker } }, update: { ids } });
}

// Gives the note the font size `choice`: a size in points, from the Font size
// menu; "bigger" or "smaller" (⌘+ and ⌘−), the next size in the menu's list
// from the size it's shown at; or "default" (⌘0, or the menu's Default), no
// size of its own, so it takes the `font_size` setting's. Records it in the
// note's sidecar (removing the key for the default; this works for a new note
// that isn't saved yet) and in the window's context, and prints an update of
// the editor's font, which keeps its text, selection and undo, even hidden in
// View, and the replace action for the top row's customise group, whose menu
// marks the size. In View the page is reloaded at the new size. Like choosing
// a colour, it closes the open picker. Does nothing when the size doesn't
// change (⌘+ at the largest size), or without a state of the window's form,
// as for switchMode.
function setFontSize(store, workflowFolder, context, id, form, choice) {
  if (!/^(\d+|bigger|smaller|default)$/.test(choice || "")) throw new Error(`Unknown font size: ${choice}`);
  const state = windowState(id);
  if (!state || state.form !== form) return;
  const mode = state.mode === "view" ? "view" : "edit";
  const before = noteWindowOptions(context, { workflowFolder, id, form, mode });
  let ownFontSize = null;
  if (choice === "bigger" || choice === "smaller") ownFontSize = steppedNoteFontSize(noteShownFontSize(before), choice === "bigger" ? 1 : -1);
  else if (choice !== "default") ownFontSize = noteOwnFontSize({ fontSize: Number(choice) });
  if (ownFontSize === before.ownFontSize) return;
  store.updateMeta(id, { fontSize: ownFontSize });
  updateNoteContext(id, form, { ownFontSize });
  const options = noteWindowOptions(Object.assign(context, { ownFontSize }), { workflowFolder, id, form, mode });
  const customise = noteWindowPart(options, "customise");
  const editor = findNoteComponent(noteWindowPart(options, "content"), "editor");
  closeNotePickerState(id);
  const ids = Object.assign(noteDropdownsClosed(), { editor: { font: editor.font } });
  if (mode === "view") {
    const note = store.read(id);
    ids.web = { src: writeNotePage(id, form, note ? note.text : "") };
  }
  return JSON.stringify({ replace: { ids: { customise } }, update: { ids } });
}

// The size a sticky window that has just opened is given (see launched): the
// collapsed height if it's collapsed; otherwise the default height if it
// opened shorter than its minimum, or nothing.
function stickyWindowSize(workflowFolder, pid, collapsed) {
  const layout = noteCollapsedLayout();
  if (collapsed) return JSON.stringify({ window: { resize: { height: layout.height } } });
  const minimum = readNoteTemplate(workflowFolder, "window").window.minsize.height;
  const height = noteWindowHeight(pid);
  if (height !== null && height < minimum) return JSON.stringify({ window: { resize: { height: layout.defaultHeight } } });
}

// A double-click on a sticky window's top strip: collapses the window, or
// expands it if it's collapsed (see "Collapsing" above). Collapsing saves the
// editor's text in Edit, records the window's height (or the default height,
// if it can't be measured), closes the open drop-down, and prints the update
// that hides the note and the top row's groups and shows the note's title,
// with the resize to the collapsed height. Expanding prints the
// reverse, with the resize back to the recorded height, and puts the caret
// back in the editor in Edit. Does nothing without a state of the window's
// form, as for switchMode, or in a quick view.
function toggleCollapsed(store, workflowFolder, context, id, form, text) {
  const state = windowState(id);
  if (form !== "sticky" || !state || state.form !== form) return;
  const mode = state.mode === "view" ? "view" : "edit";
  const layout = noteCollapsedLayout();
  const collapsing = !state.collapsed;
  let expandTo = null;
  if (collapsing) {
    if (mode === "edit") store.save(id, text);
    const height = noteWindowHeight(state.pid);
    expandTo = height !== null && height > layout.height ? height : layout.defaultHeight;
  }
  const height = collapsing ? layout.height : noteCollapsedHeight({ collapsed: context.collapsed }) || layout.defaultHeight;
  store.updateMeta(id, { collapsed: expandTo });
  updateNoteContext(id, form, { collapsed: expandTo });
  writeNoteState(id, Object.assign(state, { collapsed: collapsing }));
  const note = store.read(id);
  const options = noteWindowOptions(Object.assign(context, { collapsed: expandTo }), { workflowFolder, id, form, mode });
  options.text = note ? note.text : "";
  const ids = { content: { hidden: collapsing }, customise: { hidden: collapsing }, actions: { hidden: collapsing } };
  if (closeNotePickerState(id)) Object.assign(ids, noteDropdownsClosed());
  if (!collapsing) {
    ids.collapsedtitle = { hidden: true };
    if (mode === "edit") ids.editor = { focus: true };
  }
  const actions = { update: { ids }, window: { resize: { height } } };
  // The title is replaced rather than updated, so it's laid out with its
  // text: Alfred UI doesn't measure a label again when an update changes it.
  if (collapsing) actions.replace = { ids: { collapsedtitle: noteWindowPart(options, "collapsedtitle") } };
  return JSON.stringify(actions);
}

// The actions menu's button (…) or ⌘K: prints the popupmenu action that
// opens the actions menu (noteActionsMenu) for the window as it is now, its
// mode, whether it's collapsed and whether its note is blank (the editor's
// `text` in Edit, the file's in View), at the point under the button
// (`menuanchor`). Does nothing without a state of the window's form, as for
// switchMode.
function actionsMenu(store, workflowFolder, id, form, text) {
  const state = windowState(id);
  if (!state || state.form !== form) return;
  const mode = state.mode === "view" ? "view" : "edit";
  const note = mode === "edit" ? null : store.read(id);
  const blank = isBlankText(mode === "edit" ? text : note ? note.text : "");
  const menu = noteActionsMenu({
    workflowFolder,
    note: escapeForAlfredUi(id),
    form,
    mode,
    collapsed: Boolean(state.collapsed),
    blank,
  });
  return JSON.stringify({ popupmenu: { src: "menuanchor", menu } });
}

// Share…, Copy as Rich Text and Copy as Markdown Text in the actions menu
// (`how` is "share", "copyrich" or "copytext"). Each first saves the editor's text in Edit, so it uses the
// note as it is on screen (a new note is saved then, as sharing it makes it
// worth keeping), and does nothing for a blank note.
//
// Alfred UI's `share` action opens macOS's share menu with the file at the
// path in its `src`, so Share… shares the note's .md file, which services take
// as an attachment (Notes does). It shares only files: any other string is
// taken for a file named after its last path component, which doesn't exist,
// and nothing can use it; and a .txt file of the text is an attachment in
// Notes too, so there's no sharing the text itself. The menu opens at the top
// centre of the window, or under it when there's no room above, whatever view
// the action names, so it names none. Copy as Rich Text puts the note,
// rendered as the View page renders it, on the clipboard instead
// (copyNoteAsRichText in lib.js), for pasting with its formatting, and Copy as
// Markdown Text puts its Markdown there as plain text (copyNoteAsMarkdownText),
// without switching to Edit to select it.
// Does nothing without a state of the window's form, as for switchMode.
function shareNote(store, workflowFolder, id, form, how, text) {
  const state = windowState(id);
  if (!state || state.form !== form) return;
  if (state.mode !== "view") store.save(id, text);
  const note = store.read(id);
  if (!note || isBlankText(note.text)) return;
  if (how === "copyrich") {
    copyNoteAsRichText(workflowFolder, note.text);
    return;
  }
  if (how === "copytext") {
    copyNoteAsMarkdownText(note.text);
    return;
  }
  return JSON.stringify({ share: { src: store.notePath(id) } });
}

// Move to Trash in the actions menu: moves the note to the Trash through
// Finder (as ⌥↩ in the results does, so "Put Back" works; its sidecar stays),
// after saving the editor's text in Edit, so the note in the Trash is the one
// on screen, then closes the window. A note that's blank or was never saved
// is deleted outright instead, as when its window closes. The window's state
// is marked `trashed`, so its `quit` doesn't save the note back (see quit).
// A note moved to the Trash posts the same notification as ⌥↩ in the results
// does, through the workflow's "notify" trigger (postNotesNotification), as a
// window's script isn't in Alfred's flow of objects; a sticky window waits for
// it to be sent, as its helper quits when the window closes, and macOS then
// refuses it. One deleted outright posts none, as there's nothing in the
// Trash to tell of. If Finder can't move it, the notification says why, and
// the error stops here, so the window stays open. Does nothing without a
// state of the window's form, as for switchMode.
function trashNote(store, id, form, text) {
  const state = windowState(id);
  if (!state || state.form !== form) return;
  if (state.mode !== "view") store.save(id, text);
  if (!store.deleteIfEmpty(id)) {
    const note = store.read(id);
    const wait = form === "sticky";
    try {
      store.trash(id);
    } catch (e) {
      postNotesNotification(noteTrashFailedMessage(e), workflowVariable, { wait });
      throw e;
    }
    if (note) postNotesNotification(noteTrashedMessage(note.title), workflowVariable, { wait });
  }
  writeNoteState(id, Object.assign(state, { trashed: true }));
  return JSON.stringify(noteCloseAction(form).src);
}

// A task box was clicked in the page: ticks the task on `line` (counting from
// 0) when `to` is "x", unticks it when "o". The page has already changed its
// box, so this prints nothing, but it rewrites the page's note.js, so a later
// reload shows the tick. It only changes the note if it still has the text the
// page was given (the hash in the window's context) and the line is still a
// task box in the other state; otherwise the note has changed under the page
// (an edit elsewhere), so it reloads the page with the note as it is now.
// Does nothing without a View state of the window's form.
function tick(store, context, id, form, line, to) {
  if (to !== "x" && to !== "o") throw new Error(`Unknown tick: ${to}`);
  const state = windowState(id);
  if (!state || state.form !== form || state.mode !== "view") return;
  const note = store.read(id);
  const text = note ? note.text : "";
  const ticked = note && textHash(text) === context.textHash ? toggleNoteTask(text, line, to === "x") : null;
  if (ticked === null) return JSON.stringify({ update: { ids: { web: { src: writeNotePage(id, form, text) } } } });
  store.save(id, ticked);
  writeNotePage(id, form, ticked);
}

// Stick (its button or ⌘D) in a quick view: saves the editor's text, then
// finishes with the variables `stick_note` and `stick_mode` (the view's mode), so
// Alfred carries on to the stick route, where open.js writes the sticky
// window's bundle from the note on disk, to open in the same mode. The save
// has to come first, here: once the view finishes, Alfred runs the stick route
// without waiting for the view's `quit`, so a note whose text was only in the
// editor (a new note with text, or typing within the last second) would open
// blank or stale in its sticky window.
function stick(store, id, form, text) {
  const state = windowState(id);
  save(store, id, form, text);
  const mode = state && state.form === form ? state.mode : "";
  return JSON.stringify({ finish: { variables: { stick_note: escapeForAlfredUi(id), stick_mode: mode } } });
}

// The window has closed. Saves the editor's text (see isEditorText), then
// deletes the note, with its window bundles, if it's empty or was never saved,
// and otherwise records the window's mode in the note's sidecar, so the note
// reopens in the mode it was last in, whether or not it was ever switched.
// A quick view's state is removed. A sticky window's is kept, with the time
// it closed, and Alfred starts a forget timer that removes it a little later, so
// that if the session is ending (a restart, shutdown or logout, which closes
// the window this way too) the note can be reopened afterwards (see
// "Reopening sticky notes" in lib.js).
// A state of the other form is another window's: this was a quick view that
// handed over to the note's sticky window (see launched), so it leaves
// everything alone. A note moved to the Trash from its window (see trashNote)
// isn't saved back: its state and bundles are removed, and nothing else.
function quit(store, id, form, text) {
  const state = windowState(id);
  if (state && state.form !== form) return;
  if (state && state.trashed) {
    removeNoteState(id);
    removeNoteBundle(id);
    return;
  }
  if (isEditorText(state, form, text)) store.save(id, text);
  if (store.deleteIfEmpty(id)) {
    removeNoteState(id);
    removeNoteBundle(id);
    return;
  }
  const exists = store.exists(id);
  if (state && exists) store.updateMeta(id, { mode: state.mode === "view" ? "view" : "edit" });
  if (state && exists && form === "sticky") keepClosedNoteState(id, state);
  else removeNoteState(id);
}

// Whether `text`, a window's {value:editor.text}, is its editor's text, and so
// can be saved: only in Edit mode, since in View the editor is hidden and has
// the text it was last shown with, which ticks may have changed since. With no
// state (the window's `launched` failed), the mode is unknown, so only
// non-blank text counts (a window that opens in View has an empty editor). A
// state of the other form is another window's.
function isEditorText(state, form, text) {
  if (!state) return !isBlankText(text);
  return state.form === form && state.mode === "edit";
}

// The window's state (see "Window state" in lib.js), or null if there's none
// or it's a closed sticky window's, kept for reopening, which no open window
// acts on.
function windowState(id) {
  const state = readNoteState(id);
  return state && state.closed == null ? state : null;
}

// Runs lib.js from this script's own folder, wherever the script is run from
// (JXA has no require). See "Loading lib.js" in DEVELOPMENT.md.
function loadLib(argv, relativePath) {
  const args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments);
  let script = args[args.length - argv.length - 1];
  if (!script.startsWith("/")) script = `${$.NSFileManager.defaultManager.currentDirectoryPath.js}/${script}`;
  const path = $(script).stringByDeletingLastPathComponent.stringByAppendingPathComponent(relativePath).stringByStandardizingPath.js;
  const source = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  if (source.isNil()) throw new Error(`Can't load ${path}`);
  (0, eval)(source.js);
  return path;
}
