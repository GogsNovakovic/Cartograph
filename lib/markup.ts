// The formatting an explanation may use, parsed for rendering: inline code,
// bold and bullet lists, in paragraphs. The prompt permits exactly these.
// Models don't reliably keep to it, so whatever else arrives is reduced to
// its text: a heading becomes a bold line, a numbered list a bullet list,
// a link its words, and any backtick or asterisk left unpaired is dropped
// rather than printed. Pure, so it runs the same in a script.

export type Inline = { kind: "text" | "code"; text: string; bold: boolean };

export type Block = { kind: "paragraph"; inlines: Inline[] } | { kind: "list"; items: Inline[][] };

const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*(?:[-*+•]|\d{1,3}[.)])\s+(.*)$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?/;
// A run of backticks, then the shortest text up to the same run.
const CODE = /(`+)([\s\S]*?[^`])\1(?!`)/g;

export function parseMarkup(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let items: string[] | null = null;

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", inlines: parseInline(paragraph.join(" ")) });
    if (items !== null) blocks.push({ kind: "list", items: items.map(parseInline) });
    paragraph = [];
    items = null;
  };

  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(QUOTE, "");
    if (line.trim() === "" || RULE.test(line)) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "paragraph", inlines: parseInline(heading[1]).map((inline) => ({ ...inline, bold: true })) });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      if (paragraph.length > 0) {
        blocks.push({ kind: "paragraph", inlines: parseInline(paragraph.join(" ")) });
        paragraph = [];
      }
      (items ??= []).push(bullet[1]);
      continue;
    }
    // An indented line under a bullet continues it.
    if (items !== null && /^\s+/.test(raw) && items.length > 0) {
      items[items.length - 1] += " " + line.trim();
      continue;
    }
    if (items !== null) flush();
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

export function parseInline(text: string): Inline[] {
  // Code first, so nothing inside a code span is read as formatting.
  const pieces: Array<{ code: boolean; text: string }> = [];
  let at = 0;
  for (const match of text.matchAll(CODE)) {
    if (match.index > at) pieces.push({ code: false, text: text.slice(at, match.index) });
    pieces.push({ code: true, text: match[2].trim() });
    at = match.index + match[0].length;
  }
  if (at < text.length) pieces.push({ code: false, text: text.slice(at) });

  // Bold markers are paired in order; an odd one out is dropped, not shown.
  const markers = pieces.reduce((n, piece) => (piece.code ? n : n + (piece.text.split("**").length - 1)), 0);
  let usable = markers - (markers % 2);
  let bold = false;
  const inlines: Inline[] = [];
  const push = (kind: Inline["kind"], value: string) => {
    if (value === "") return;
    const last = inlines[inlines.length - 1];
    if (last && last.kind === kind && last.bold === bold && kind === "text") last.text += value;
    else inlines.push({ kind, text: value, bold });
  };
  for (const piece of pieces) {
    if (piece.code) {
      push("code", piece.text);
      continue;
    }
    const parts = piece.text.split("**");
    parts.forEach((part, i) => {
      if (i > 0 && usable > 0) {
        bold = !bold;
        usable--;
      }
      push("text", clean(part));
    });
  }
  return inlines;
}

// What's left once the permitted formatting is read: a link's words without
// its address, and no stray marker characters.
function clean(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)\s]*\)/g, "$1").replace(/[`*]/g, "");
}

export type Linked<T> = string | { text: string; target: T };

// Leading and trailing characters that can sit around a path in prose
// without being part of it.
const OPEN = /^[("'“‘[]/;
const CLOSE = /[.,;:!?)"'”’\]]$/;

// Splits prose into plain runs and the repository paths in it. `resolve`
// says whether a candidate names something; a word is tried as written,
// then with surrounding punctuation peeled off, longest first, so a path
// with brackets or parentheses in it survives.
export function linkPaths<T>(text: string, resolve: (candidate: string) => T | null): Linked<T>[] {
  const out: Linked<T>[] = [];
  let plain = "";
  let at = 0;
  for (const match of text.matchAll(/\S+/g)) {
    const word = match[0];
    const found = findIn(word, resolve);
    if (!found) continue;
    plain += text.slice(at, match.index + found.start);
    if (plain) out.push(plain);
    out.push({ text: found.text, target: found.target });
    plain = "";
    at = match.index + found.start + found.text.length;
  }
  plain += text.slice(at);
  if (plain) out.push(plain);
  return out;
}

function findIn<T>(word: string, resolve: (candidate: string) => T | null): { start: number; text: string; target: T } | null {
  const starts = [0];
  for (let s = 0; s < 2 && OPEN.test(word.slice(s)); s++) starts.push(s + 1);
  for (const start of starts) {
    let candidate = word.slice(start);
    for (let peeled = 0; peeled <= 3 && candidate !== ""; peeled++) {
      const target = resolve(candidate);
      if (target !== null) return { start, text: candidate, target };
      if (!CLOSE.test(candidate)) break;
      candidate = candidate.slice(0, -1);
    }
  }
  return null;
}
