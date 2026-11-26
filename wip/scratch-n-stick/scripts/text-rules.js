// Scratch'n'Stick text rules, the hand-tuned judgements about a note's text:
// how text from elsewhere starts a note, the size of the window a new sticky
// note opens at for that text, and how a note that's one long line is shown
// as a title and a preview. Loaded beside
// lib.js by every script, with loadLib (see "Loading lib.js" in DESIGN.md),
// and, like lib.js, run in the global scope: its function declarations become
// globals, while its top-level const and let stay private to this file. It
// stands alone, using nothing from lib.js.
//
//   newNoteText(seed)        a new note's starting text: the seed as a heading,
//                            or the seed exactly as given
//   seedHeading(seed)        the heading a seed becomes, or null
//   splitTitleLine(line)     a long line split into { title, rest }, or null
//   fittedNoteSize(text, …)  the size of a new sticky note's window, fitted to
//                            its starting text
//
// See "Title, timestamps, empty notes", "Text as a heading" and "A new sticky
// note's size" in DESIGN.md.
//
// Lengths count what a reader sees as one character (an emoji with modifiers,
// a letter with combining accents, a flag) as one.

// ---------------------------------------------------------------------------
// Tuning
//
// The boundaries below are meant to be adjusted by hand. dev/test-storage.sh's
// "Titles" cases use them as they are, so run it after changing one and update
// any case whose expected split moves.

// Seed text of at most this many characters can become a heading.
const HEADING_MAX_LENGTH = 60;

// A note that's a single line longer than this is split into a title and a
// preview, with the title at most this long. Alfred cuts a long title short to
// fit its window, so this is about what shows of a title in Alfred's default
// width, not the title's own limit (TITLE_MAX_LENGTH in lib.js).
const SPLIT_LENGTH = 65;

// A title made of whole sentences must be at least this long, or a break at
// punctuation is tried first, so "Hi Sam." doesn't make the whole title.
const SENTENCE_TITLE_MIN_LENGTH = 20;

// A break at punctuation (; : a dash, or a comma) only counts if the title it
// leaves is at least this long, so a comma near the start isn't used.
const PUNCTUATION_BREAK_MIN_LENGTH = 40;

// Words whose full stop doesn't end a sentence, matched with their case.
// macOS's sentence splitter breaks after them ("Ask Dr. | Patel"), and can't be
// told not to.
const ABBREVIATIONS = ["Mr", "Mrs", "Ms", "Mx", "Dr", "Prof", "St", "Jr", "Sr", "No", "vs", "etc", "approx", "e.g", "i.e", "cf"];

// A new sticky note whose starting text doesn't fit its window's usual size
// opens bigger (fittedNoteSize). Long text widens the window until it's no
// more than NOTE_SHAPE times as tall as it's wide (1 is square, more allows
// taller, less keeps it wider), then makes it taller. The window is never
// wider than NOTE_MAX_WIDTH_FRACTION of the screen or NOTE_MAX_WIDTH points,
// or taller than NOTE_MAX_HEIGHT_FRACTION of the screen; longer text scrolls.
const NOTE_SHAPE = 1;
const NOTE_MAX_WIDTH_FRACTION = 0.4;
const NOTE_MAX_WIDTH = 800;
const NOTE_MAX_HEIGHT_FRACTION = 0.7;

// ---------------------------------------------------------------------------

const ABBREVIATION_END = new RegExp(`(?:^|\\s|\\()(?:${ABBREVIATIONS.map((word) => word.replace(/\./g, "\\.")).join("|")})\\.\\s*$`);

// A new note's starting text, from `seed`: text typed after the keyword, the
// clipboard, or a selection. A seed that reads as a heading (seedHeading)
// becomes `# <heading>` and an empty line, so the caret, at the end of the
// text, starts the note's body. Any other seed is kept exactly as given.
function newNoteText(seed) {
  const heading = seedHeading(seed);
  return heading === null ? seed : `# ${heading}\n\n`;
}

// The heading text `seed` becomes, or null if it reads as something else. A
// heading is one line of at most HEADING_MAX_LENGTH characters that isn't a
// sentence (it has no sentence break and doesn't end with a full stop; a
// question is fine), doesn't start with Markdown block syntax, and isn't a
// URL, email address or file path. A trailing colon ("Things to buy:") is
// dropped.
function seedHeading(seed) {
  const text = (seed || "").trim();
  if (!text || /[\r\n]/.test(text) || characterCount(text) > HEADING_MAX_LENGTH) return null;
  if (/^(#{1,6}(\s|$)|[-*+](\s|$)|\d{1,9}[.)](\s|$)|>|```|~~~|\||([-*_])(\s*\5){2,}$)/.test(text)) return null;
  if (/^\S+$/.test(text) && (/:\/\//.test(text) || /^(mailto:|www\.)/i.test(text) || /^[^@]+@[^@]+\.[^@]+$/.test(text))) return null;
  if (/^~?\//.test(text)) return null;
  if (/[^.]\.$/.test(text) || text === ".") return null;
  if (sentences(text).length > 1) return null;
  return text.replace(/\s*:$/, "") || null;
}

// `line`, a note's only line once its Markdown is removed, split into a title
// and the rest, which leads the preview: { title, rest }, or null if it's no
// longer than SPLIT_LENGTH or has no good place to split. Tried in turn:
//
//   1. As many whole sentences as fit in SPLIT_LENGTH, if they come to at
//      least SENTENCE_TITLE_MIN_LENGTH.
//   2. The last ; or : or dash (" — ", " – ", " - ") that leaves a title of
//      PUNCTUATION_BREAK_MIN_LENGTH to SPLIT_LENGTH. The dash goes.
//   3. The same for the last comma.
//   4. The whole sentences of 1, however short.
//
// A line is never split mid-sentence without punctuation: then the title is
// the line, cut short as any long title is.
function splitTitleLine(line) {
  if (characterCount(leadingCharacters(line, SPLIT_LENGTH + 1)) <= SPLIT_LENGTH) return null;
  // Breaks are looked for in a little more than SPLIT_LENGTH, so the
  // sentence splitter can see what follows a full stop, and a dash's space.
  const head = leadingCharacters(line, SPLIT_LENGTH + 40);
  const split = (end, restStart = end) => {
    const title = line.slice(0, end).trim();
    const rest = line.slice(restStart).trim();
    return title && rest ? { title, rest } : null;
  };

  // The last sentence found in the head may be cut short, so it's never used.
  const pieces = sentences(head);
  let sentenceEnd = 0;
  for (const piece of pieces.slice(0, -1)) {
    if (characterCount(line.slice(0, sentenceEnd + piece.length).trim()) > SPLIT_LENGTH) break;
    sentenceEnd += piece.length;
  }
  const sentenceSplit = sentenceEnd > 0 ? split(sentenceEnd) : null;
  if (sentenceSplit && characterCount(sentenceSplit.title) >= SENTENCE_TITLE_MIN_LENGTH) return sentenceSplit;

  for (const pattern of [/[;:](?=\s)|\s[—–-]\s/g, /,(?=\s)/g]) {
    let best = null;
    for (const match of head.matchAll(pattern)) {
      const isDash = /[—–-]/.test(match[0]);
      const end = isDash ? match.index : match.index + match[0].length;
      const length = characterCount(line.slice(0, end).trim());
      if (length >= PUNCTUATION_BREAK_MIN_LENGTH && length <= SPLIT_LENGTH) best = split(end, match.index + match[0].length) || best;
    }
    if (best) return best;
  }
  return sentenceSplit;
}

// The size, { width, height } in points, of a new sticky note's window
// content for its starting text `text`: `minimum`, the window's usual size,
// if the text fits it, or bigger, to show the text without scrolling where
// the caps allow, shaped as NOTE_SHAPE says. `font` is the editor's
// monospaced font, { column, line, wide, emoji }: a character's width, a
// line's height, and the widths of a wide (CJK) character and an emoji,
// which, if left out, are two columns. `insets` ({ top, right, bottom, left }) is the space between the
// window's edges and the text. `screen` ({ width, height }) is the screen it
// opens on (its visible frame), and `scroller` the width a scroll bar takes
// from the text when it scrolls (0 for overlay scroll bars).
//
// The text is measured as the editor lays it out, closely enough: wrapped
// at spaces and after hyphens, with a word too long for a line broken
// anywhere, wide characters and emoji at their own widths, and a tab
// TAB_STOP wide. Lines in a fenced code block or a table aren't meant to wrap, so the
// window is at least as wide as the longest of them, within the cap.
// Otherwise it only widens while that makes it shorter, so a list of short
// lines just gets taller.
function fittedNoteSize(text, { font, insets, minimum, screen, scroller = 0 }) {
  const across = insets.left + insets.right;
  const down = insets.top + insets.bottom;
  const maxWidth = Math.max(minimum.width, Math.round(Math.min(screen.width * NOTE_MAX_WIDTH_FRACTION, NOTE_MAX_WIDTH)));
  const maxHeight = Math.max(minimum.height, Math.round(screen.height * NOTE_MAX_HEIGHT_FRACTION));
  const lines = measuredLines((text || "").slice(0, MEASURED_LENGTH), font, minimum.width - across);
  const heightAt = (width) => wrappedLineCount(lines, width - across) * font.line + down;
  const widthFor = (textWidth) => Math.min(maxWidth, Math.max(minimum.width, Math.ceil(textWidth - LAYOUT_SLACK + across)));
  const longest = (rigidOnly) => lines.reduce((max, line) => (rigidOnly && !line.rigid ? max : Math.max(max, line.width)), 0);

  const narrowest = widthFor(longest(true));
  if (narrowest === minimum.width && heightAt(minimum.width) <= minimum.height) return { width: minimum.width, height: minimum.height };
  // The narrowest width no taller than NOTE_SHAPE allows, between the
  // narrowest the code and tables allow and the width where nothing wraps.
  // Wider is never taller, so it's found by bisection.
  let low = narrowest;
  let high = Math.max(low, widthFor(longest(false)));
  if (heightAt(high) <= NOTE_SHAPE * high) {
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (heightAt(middle) <= NOTE_SHAPE * middle) high = middle;
      else low = middle + 1;
    }
  }
  let width = high;
  if (heightAt(width) > maxHeight) width = Math.min(maxWidth, width + scroller);
  return { width, height: Math.min(maxHeight, Math.max(minimum.height, Math.ceil(heightAt(width)))) };
}

// Helpers, private to this file (top-level const).

// NSParagraphStyle's default tab interval, in points.
const TAB_STOP = 28;

// fittedNoteSize measures at most this many characters of a note's text:
// that much overflows the largest window the caps allow at any font size
// the editor has (11 pt and up), so the rest would only make it scroll.
const MEASURED_LENGTH = 20000;

// A little room for rounding when comparing widths in points.
const LAYOUT_SLACK = 0.01;

// An emoji shown as one: one that is by default, or a symbol followed by the
// emoji variation selector. Symbols such as © and ™ are text, one column.
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️|\p{Regional_Indicator}/u;

// East Asian wide characters: Hangul, CJK ideographs and punctuation, kana,
// and fullwidth forms.
const WIDE_CHARACTER =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{3FFFD}]/u;

// `text`'s lines measured for wrapping, in `font` (as for fittedNoteSize):
// each { width, rigid, tokens }, its width unwrapped (less trailing spaces),
// whether it's in a fenced code block or a table, and its words and runs of
// spaces, each { width, space }. A word wider than `narrowest`, the
// narrowest the text can be laid out, also has `chars`, its characters'
// widths, to be broken anywhere.
const measuredLines = (text, font, narrowest) => {
  const { column, wide = 2 * column, emoji = 2 * column } = font;
  const segmenter = segmenterFor("grapheme");
  const charWidths = (word) =>
    Array.from(segmenter ? segmenter.segment(word) : word, (part) => {
      const char = segmenter ? part.segment : part;
      return char === "\t" ? TAB_STOP : EMOJI.test(char) ? emoji : WIDE_CHARACTER.test(char) ? wide : column;
    });
  const lines = [];
  let fence = null;
  for (const line of text.split(/\r\n|\r|\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    const rigid = fence !== null || Boolean(marker) || /^\s*\|/.test(line);
    if (marker && fence === null) fence = marker[1];
    else if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
    const tokens = (line.match(/[^\s-]*-+(?=\S)|\S+|\s+/g) || []).map((part) => {
      const space = /^\s/.test(part);
      const chars = charWidths(part);
      const width = chars.reduce((sum, w) => sum + w, 0);
      return !space && width > narrowest ? { width, space, chars } : { width, space };
    });
    const trailing = tokens.length && tokens[tokens.length - 1].space ? tokens[tokens.length - 1].width : 0;
    lines.push({ width: tokens.reduce((sum, t) => sum + t.width, 0) - trailing, rigid, tokens });
  }
  return lines;
};

// How many lines `lines` (from measuredLines) take wrapped at `available`
// points. Spaces at the end of a line hang past its edge, as in the editor.
const wrappedLineCount = (lines, available) => {
  const limit = available + LAYOUT_SLACK;
  let count = 0;
  for (const { tokens } of lines) {
    let rows = 1;
    let x = 0;
    for (const token of tokens) {
      if (token.space || x + token.width <= limit) {
        x += token.width;
        continue;
      }
      if (x > 0) {
        rows++;
        x = 0;
      }
      if (token.width <= limit) {
        x = token.width;
        continue;
      }
      for (const w of token.chars || [token.width]) {
        if (x > 0 && x + w > limit) {
          rows++;
          x = 0;
        }
        x += w;
      }
    }
    count += rows;
  }
  return count;
};

// `text` split into sentences, each with the spaces after it, never breaking
// after one of ABBREVIATIONS. Without Intl.Segmenter, the text is one sentence.
const sentences = (text) => {
  const segmenter = segmenterFor("sentence");
  if (!segmenter) return [text];
  const joined = [];
  for (const { segment } of segmenter.segment(text)) {
    if (joined.length && ABBREVIATION_END.test(joined[joined.length - 1])) joined[joined.length - 1] += segment;
    else joined.push(segment);
  }
  return joined;
};

const segmenters = new Map();

// An Intl.Segmenter for "sentence" or "grapheme", or null where there's none.
const segmenterFor = (granularity) => {
  if (!segmenters.has(granularity)) {
    const supported = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function";
    segmenters.set(granularity, supported ? new Intl.Segmenter(undefined, { granularity }) : null);
  }
  return segmenters.get(granularity);
};

const characterCount = (text) => {
  const segmenter = segmenterFor("grapheme");
  if (!segmenter) return Array.from(text).length;
  let count = 0;
  for (const _ of segmenter.segment(text)) count++;
  return count;
};

// The first `count` characters of `text`, without reading the rest, so a
// very long line costs no more than a short one.
const leadingCharacters = (text, count) => {
  const segmenter = segmenterFor("grapheme");
  let result = "";
  let n = 0;
  for (const part of segmenter ? segmenter.segment(text) : text) {
    if (n++ === count) break;
    result += segmenter ? part.segment : part;
  }
  return result;
};
