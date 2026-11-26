// The script of a note's page, its View mode in the window's web view.
// lib.js inlines it into each window bundle's view.html (notePageHtml), so a
// changed script reaches every window that opens afterwards, rather than
// WebKit keeping a copy it loaded earlier.
//
// The page renders window.NOTE, the note's text from note.js beside it, with
// markdown-it. NOTE is null in a window that opened in Edit: its page shows
// nothing until the switch to View reloads it with the note.
//
// The page tells the window things by changing its URL's fragment, which the
// web view reports with its `changed` event (scripts/changed.sh):
//
//   #ready-<opacity>-<n>   the note has been drawn: show the web view at
//                          <opacity> (it starts at 0, which hides WebKit's
//                          own fill until the note is there)
//   #t-<line>-<x|o>-<n>    the task box of source line <line> (counting from
//                          0) was ticked (x) or unticked (o)
//
// <n> counts the page's messages, so that each one changes the URL.
//
// Only function declarations at the top level: dev/test-window.sh loads this
// file in JXA, without a document, to test the task rule.

// A markdown-it renderer for notes: CommonMark with tables and strikethrough,
// raw HTML escaped (so a note can't run script in the page), bare URLs as
// links, and task boxes.
function noteMarkdown(markdownit) {
  const md = markdownit({ html: false, linkify: true, typographer: false });
  md.core.ruler.after("inline", "note_tasks", noteTaskRule);
  return md;
}

// A core rule, after `inline`: a list item whose paragraph starts with "[ ] ",
// "[x] " or "[X] " gets a checkbox in place of that, carrying the paragraph's
// first source line (`map`), which is the line window.js ticks.
function noteTaskRule(state) {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    if (inline.type !== "inline" || tokens[i - 1].type !== "paragraph_open" || tokens[i - 2].type !== "list_item_open")
      continue;
    const match = /^\[([ xX])\] /.exec(inline.content);
    const first = inline.children && inline.children[0];
    if (!match || !inline.map || !first || first.type !== "text" || !first.content.startsWith(match[0])) continue;
    const done = match[1] !== " ";
    first.content = first.content.slice(match[0].length);
    const box = new state.Token("html_inline", "", 0);
    box.content = `<input type="checkbox" data-line="${inline.map[0]}"${done ? " checked" : ""}>`;
    inline.children.unshift(box);
    tokens[i - 2].attrJoin("class", done ? "task done" : "task");
  }
}

// Gives the page the note's font size and, when sticky, its colour, from
// note.js, so they change with the note's without view.html being rewritten.
// Run in the page's head, before anything is drawn.
function showNoteLook() {
  const root = document.documentElement.style;
  if (typeof NOTE_TINT === "string") root.setProperty("--tint", NOTE_TINT);
  if (typeof NOTE_FONT_SIZE === "number" && NOTE_FONT_SIZE > 0) root.setProperty("--font-size", `${NOTE_FONT_SIZE}px`);
}

// Renders the note, keeps the scroll position across reloads, fades the text
// at the top and bottom while there's more beyond, sends task ticks, and
// says when the note has been drawn. `form` is "quick" or
// "sticky".
function startNotePage(form) {
  if (typeof NOTE !== "string") return;
  let messages = 0;
  const send = (message) => history.replaceState(null, "", `#${message}-${++messages}`);

  const note = document.getElementById("note");
  if (typeof markdownit === "function") {
    note.innerHTML = noteMarkdown(markdownit).render(NOTE);
  } else {
    // markdown-it didn't load: the note as plain text, rather than nothing.
    const pre = document.createElement("pre");
    pre.textContent = NOTE;
    note.appendChild(pre);
  }

  // The page reloads when a tick is refused, after a switch from Edit, and
  // when a sticky note's colour or the note's font size changes: each time
  // it opens where it was.
  try {
    const saved = sessionStorage.getItem("scrollY");
    if (saved !== null) note.scrollTop = Number(saved);
    addEventListener("pagehide", () => sessionStorage.setItem("scrollY", String(note.scrollTop)));
  } catch (e) {
    // No session storage: the page opens at the top.
  }

  // The fade at each edge shows while there's more beyond it, shortening
  // over the last of the scroll, so the start and end of the note are never
  // faded.
  const fade = () => {
    const most = 5 * parseFloat(getComputedStyle(note).fontSize);
    const length = (beyond) => `${Math.max(0, Math.min(most, beyond))}px`;
    note.style.setProperty("--fade-top", length(note.scrollTop));
    note.style.setProperty("--fade-bottom", length(note.scrollHeight - note.scrollTop - note.clientHeight));
  };
  fade();
  note.addEventListener("scroll", fade, { passive: true });
  addEventListener("resize", fade);
  for (const image of note.querySelectorAll("img")) image.addEventListener("load", fade);

  document.addEventListener("change", (event) => {
    const box = event.target;
    if (!box.matches("input[type=checkbox][data-line]")) return;
    box.parentElement.classList.toggle("done", box.checked);
    send(`t-${box.dataset.line}-${box.checked ? "x" : "o"}`);
  });

  // Two animation frames after rendering, the note has been drawn. Shown any
  // sooner (one frame after rendering), the web view showed WebKit's own
  // fill for a moment in a sticky window.
  requestAnimationFrame(() => requestAnimationFrame(() => send(`ready-${notePageOpacity(form)}`)));
}

// The opacity to show the web view at: 1 when sticky; in a quick view, the
// theme stylesheet's --opacity (see noteThemeStylesheet in lib.js), or 1
// without one.
function notePageOpacity(form) {
  if (form === "sticky") return 1;
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--opacity"));
  return isFinite(value) ? Math.round(Math.min(1, Math.max(0, value)) * 100) / 100 : 1;
}
