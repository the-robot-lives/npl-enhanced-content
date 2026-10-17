/**
 * cards plugin — the .card file format and its parser.
 *
 * A card file is a small YAML subset, enough for a framed terminal card
 * and nothing more:
 *
 *   # full-line comments only; "---" / "..." document markers are ignored
 *   name: render-demo          # the NAME spelled into the top/bottom rule
 *   title: SemText in one file
 *   subtitle: read it three ways   # optional; the line under the title
 *   footer: semtext.dev/docs      # optional; the line above the bottom rule
 *   theme: zigzag              # optional; see `render-card --list-themes`
 *   width: 64                  # optional frame width in columns (24..120)
 *   description: |             # literal block scalar; ">" folds to one paragraph
 *     The body prose, wrapped to the frame.
 *     ## A section               # a "#"-heading line starts a new section
 *     More prose, under its own heading.
 *
 * Rules kept deliberately small: `key: value` scalars (optionally quoted
 * with ' or "), literal `|`/folded `>` block scalars for description,
 * full-line comments only (a `#` inside a value is data), and one card per
 * file. Unknown keys and empty values are warnings, never errors;
 * structural failures (a header line without a colon, a block scalar under
 * another key, a bad width) are CardFileError with a 1-based line number.
 * The parser never executes anything — every value stays text.
 */

export interface CardFile {
  /** The NAME in the frame rules. */
  name: string;
  /** The underlined heading line, or null. */
  title: string | null;
  /** The line under the title, or null. */
  subtitle: string | null;
  /** The prose body, sections included ('' allowed). */
  description: string;
  /** The line above the bottom rule, or null. */
  footer: string | null;
  /** Theme id, or null for the default theme. */
  theme: string | null;
  /** Requested frame width in columns, or null for the default. */
  width: number | null;
  /** Non-fatal notes (unknown keys, empty values, name fallback). */
  warnings: string[];
}

/** One section of a description: the prose before its next "#"-heading. */
export interface CardSection {
  /** The "#"-heading text, or null for the prose before any heading. */
  heading: string | null;
  /** The section's lines ('' = a paragraph break). */
  body: string;
}

const HEADING_PATTERN = /^#{1,6} +(.+?) *$/;

/**
 * Split a description into sections at "#"-heading lines (a Markdown-ish
 * convention, 1–6 #s): prose before any heading is the intro section with
 * a null heading. Heading lines only count at the START of a description
 * line — a # inside a sentence is data, as everywhere else in a card.
 */
export function splitSections(description: string): CardSection[] {
  const sections: CardSection[] = [];
  let current: CardSection = { heading: null, body: '' };
  for (const line of description.split('\n')) {
    const match = HEADING_PATTERN.exec(line);
    if (match) {
      if (current.body !== '' || current.heading !== null) sections.push(current);
      current = { heading: match[1]!, body: '' };
      continue;
    }
    current.body = current.body === '' ? line : `${current.body}\n${line}`;
  }
  if (current.body !== '' || current.heading !== null) sections.push(current);
  return sections;
}

export class CardFileError extends Error {
  /** 1-based line the failure sits on. */
  readonly line: number;
  constructor(message: string, line: number) {
    super(message);
    this.name = 'CardFileError';
    this.line = line;
  }
}

const KEY_PATTERN = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/;

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  return value;
}

/**
 * One block scalar body off the lines after the `|`/`>` marker line.
 * Indentation is fixed by the first body line; less-indented non-blank
 * lines end the block. Returns the scalar text and the index of the first
 * line AFTER the block (the caller resumes the header there).
 */
function readBlockScalar(lines: string[], markerLine: number): { text: string; end: number } {
  const marker = lines[markerLine]!.trim();
  const value = marker.slice(marker.indexOf(':') + 1).trim(); // the part after "key:"
  const folded = value.startsWith('>');
  // `|` and `>` keep one trailing newline; `|-` / `>-` strip it.
  const keepChomp = !value.includes('-');
  const body: string[] = [];
  let indent: number | null = null;
  let j = markerLine + 1;
  for (; j < lines.length; j++) {
    const line = lines[j]!;
    if (line.trim() === '') {
      body.push('');
      continue;
    }
    const lineIndent = line.length - line.trimStart().length;
    if (lineIndent === 0) break;
    if (indent === null) indent = lineIndent;
    if (lineIndent < indent) break;
    body.push(line.slice(indent));
  }
  while (body.length > 0 && body[body.length - 1] === '') body.pop();
  let text: string;
  if (folded) {
    // Folded: single newlines become spaces; blank lines split paragraphs.
    const paragraphs: string[] = [];
    let paragraph: string[] = [];
    for (const line of body) {
      if (line === '') {
        paragraphs.push(paragraph.join(' '));
        paragraph = [];
      } else {
        paragraph.push(line);
      }
    }
    if (paragraph.length > 0) paragraphs.push(paragraph.join(' '));
    text = paragraphs.join('\n');
  } else {
    text = body.join('\n');
  }
  if (keepChomp && text !== '') text += '\n';
  return { text, end: j };
}

/**
 * Parse a .card document. `label` names the source for the name fallback:
 * when `name:` is absent the card's NAME defaults to the label's basename
 * without its .card extension (and a warning says so).
 */
export function parseCardFile(source: string, opts: { label?: string } = {}): CardFile {
  const warnings: string[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  let name: string | null = null;
  let title: string | null = null;
  let subtitle: string | null = null;
  let description = '';
  let footer: string | null = null;
  let theme: string | null = null;
  let width: number | null = null;

  let i = 0;
  for (; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#') || trimmed === '---' || trimmed === '...') continue;
    const match = KEY_PATTERN.exec(raw);
    if (!match) {
      throw new CardFileError(`line ${i + 1}: expected "key: value" (name, title, subtitle, description, footer, theme or width)`, i + 1);
    }
    const key = match[1]!.toLowerCase();
    const rest = match[2]!.trim();
    if (key === 'description') {
      if (rest === '') {
        description = '';
        continue;
      }
      if (rest.startsWith('|') || rest.startsWith('>')) {
        const block = readBlockScalar(lines, i);
        description = block.text;
        i = block.end - 1; // the for-update re-advances past the block
        continue;
      }
      description = unquote(rest);
      continue;
    }
    if (rest === '') {
      warnings.push(`line ${i + 1}: "${key}" has no value; ignored`);
      continue;
    }
    if (rest.startsWith('|') || rest.startsWith('>')) {
      throw new CardFileError(`line ${i + 1}: block scalars are only supported for "description"`, i + 1);
    }
    const value = unquote(rest);
    if (key === 'name') {
      name = value;
    } else if (key === 'title') {
      title = value;
    } else if (key === 'subtitle') {
      subtitle = value;
    } else if (key === 'footer') {
      footer = value;
    } else if (key === 'theme') {
      theme = value;
    } else if (key === 'width') {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || String(parsed) !== value) {
        warnings.push(`line ${i + 1}: width "${value}" is not an integer; ignored`);
      } else {
        width = parsed;
      }
    } else {
      warnings.push(`line ${i + 1}: unknown key "${match[1]}" ignored`);
    }
  }

  if (name === null) {
    const base = (opts.label ?? 'card').split('/').pop() ?? 'card';
    name = base.replace(/\.card$/i, '');
    warnings.push('no "name:" — using the file name');
  }
  return { name, title, subtitle, description, footer, theme, width, warnings };
}
