// Scratch'n'Stick titles: how text from elsewhere starts a note, and how a
// note that's one long line is shown as a title and a preview. Loaded beside
// lib.js by every script, with loadLib (see "Loading lib.js" in DESIGN.md),
// and, like lib.js, run in the global scope: its function declarations become
// globals, while its top-level const and let stay private to this file. It
// stands alone, using nothing from lib.js.
//
//   newNoteText(seed)        a new note's starting text: the seed as a heading,
//                            or the seed exactly as given
//   seedHeading(seed)        the heading a seed becomes, or null
//   splitTitleLine(line)     a long line split into { title, rest }, or null
//
// See "Title, timestamps, empty notes" and "Text as a heading" in DESIGN.md.
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

// Helpers, private to this file (top-level const).

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
