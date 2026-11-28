// The script of a note's page, its View mode in the window's web view.
// lib.js inlines it into each window bundle's view.html (notePageHtml), so a
// changed script reaches every window that opens afterwards, rather than
// WebKit keeping a copy it loaded earlier.
//
// The page renders window.NOTE, the note's text from note.js beside it, with
// markdown-it. NOTE is null in a window that opened in Edit: its page shows
// nothing until the switch to View reloads it with the note. Links and images
// are resolved against window.NOTE_BASES, also from note.js (see
// noteResolvedAddress).
//
// The page tells the window things by changing its URL's fragment, which the
// web view reports with its `changed` event (scripts/changed.sh):
//
//   #ready-<opacity>-<rrggbb>-<n>
//                          the note has been drawn: show the web view at
//                          <opacity> (it starts at 0, which hides WebKit's
//                          own fill until the note is there), and, in a quick
//                          view, the strip above it in the page's background
//                          colour, <rrggbb> (left out if it can't be read)
//   #t-<line>-<x|o>-<n>    the task box of source line <line> (counting from
//                          0) was ticked (x) or unticked (o)
//
// <n> counts the page's messages, so that each one changes the URL.
//
// Only function declarations at the top level: dev/test-window.sh loads this
// file in JXA, without a document, to test the task rule.

// A markdown-it renderer for notes: CommonMark with tables and strikethrough,
// raw HTML escaped (so a note can't run script in the page), bare URLs as
// links, file: URLs allowed, and task boxes. With `bases` (see
// noteResolvedAddress), relative and "~/" addresses of links and images are
// resolved against them.
//
// Every address markdown-it reads (inline links and images, reference
// definitions, autolinks and bare URLs) goes through normalizeLink and then
// validateLink, so these two are the only places addresses are changed or
// refused. The note's text itself is never changed.
function noteMarkdown(markdownit, bases) {
  const md = markdownit({ html: false, linkify: true, typographer: false });
  md.validateLink = noteLinkAllowed;
  if (bases) {
    const normalise = md.normalizeLink;
    md.normalizeLink = (url) => noteResolvedAddress(normalise(url), bases);
  }
  md.core.ruler.after("inline", "note_tasks", noteTaskRule);
  return md;
}

// markdown-it's own check of an address, but allowing file: URLs, which point
// at a local file by its full address: refuses javascript: and vbscript:, and
// data: other than a GIF, PNG, JPEG or WebP image.
function noteLinkAllowed(url) {
  const value = url.trim().toLowerCase();
  if (/^(javascript|vbscript):/.test(value)) return false;
  if (value.startsWith("data:")) return /^data:image\/(gif|png|jpeg|webp);/.test(value);
  return true;
}

// `address`, as markdown-it has normalised it (percent-encoded), resolved
// against `bases`, { folder, home }: the file:// URLs of the notes folder and
// of the home folder, each percent-encoded and ending in "/". A relative path
// is from the notes folder, which is the note's own folder, as in other
// Markdown apps; one starting "~/" is from the home folder, so a note synced
// to another Mac or account finds the same file there. An address with a
// scheme, an absolute path and a fragment are left as they are.
//
// Both sides are already encoded, so joining them makes a valid URL, and "./"
// and "../" are left for WebKit to resolve as it loads the URL.
function noteResolvedAddress(address, bases) {
  if (!address || /^[a-z][a-z0-9+.-]*:/i.test(address) || /^[#/]/.test(address)) return address;
  if (address.startsWith("~/")) return bases.home + address.slice(2);
  return bases.folder + address;
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
    const bases = typeof NOTE_BASES === "object" && NOTE_BASES ? NOTE_BASES : null;
    note.innerHTML = noteMarkdown(markdownit, bases).render(NOTE);
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
  requestAnimationFrame(() => requestAnimationFrame(() => send(`ready-${notePageOpacity(form)}${notePagePanel()}`)));
}

// The page's background colour as "-rrggbb", for #ready, or "" if it can't be
// read: a quick view's strip above the page takes it (see scripts/changed.sh),
// so the two look like one panel. It's read from the page, rather than worked
// out by lib.js, as the theme stylesheet's colour depends on the appearance.
function notePagePanel() {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(getComputedStyle(document.documentElement).backgroundColor);
  return match ? "-" + match.slice(1, 4).map((c) => Number(c).toString(16).padStart(2, "0")).join("") : "";
}

// The opacity to show the web view at: 1 when sticky; in a quick view, the
// theme stylesheet's --opacity (see noteThemeStylesheet in lib.js), or 1
// without one.
function notePageOpacity(form) {
  if (form === "sticky") return 1;
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--opacity"));
  return isFinite(value) ? Math.round(Math.min(1, Math.max(0, value)) * 100) / 100 : 1;
}
