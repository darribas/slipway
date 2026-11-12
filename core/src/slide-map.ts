// Map a deck's source lines to reveal.js slide indices, for editor ↔ preview
// sync (cursor in the editor → `Reveal.slide(h, v)` in the preview, and the
// other way round).
//
// This is a best-effort line scanner, not a markdown parser. It mirrors how
// pandoc lays out a revealjs deck at `slide-level: 2` (what renderDeck uses):
//
//   - a `title:` in the YAML frontmatter produces a title slide at h = 0;
//   - a level-1 heading starts a new horizontal slide; level-2 headings and
//     horizontal rules that follow it become vertical slides beneath it;
//   - a level-2 heading or horizontal rule with no level-1 heading above
//     starts a new horizontal slide;
//   - deeper headings stay inside the current slide;
//   - headings and rules inside fenced code blocks, fenced divs (`:::`) and
//     HTML comments are ignored.
//
// Known gap: pandoc promotes a div whose *first block* is a heading into a
// section of its own (e.g. `::: notes` immediately followed by `# Title`).
// That is unusual markup and is not modelled; the map is off by one slide
// after such a div.
//
// It is checked against pandoc's real output for the fixture decks in
// test/slide-map.test.ts.

import YAML from "yaml";

export interface SlideSpan {
  /** Horizontal index, as reveal.js counts it. */
  h: number;
  /** Vertical index within the horizontal stack (0 for a flat slide). */
  v: number;
  /** First source line of the slide, 0-based, inclusive. */
  startLine: number;
  /** Last source line of the slide, 0-based, inclusive. */
  endLine: number;
}

const INCLUDE_RE = /\{\{<\s*include\s+([^\s>]+)\s*>\}\}/g;
const FRONTMATTER_OPEN = /^---\s*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const DIV_RE = /^ {0,3}:{3,}\s*(.*)$/;
const ATX_RE = /^(#{1,6})(?:\s+\S|\s*$)/;
const RULE_RE = /^ {0,3}([-*_])(?: *\1){2,}\s*$/;
const SETEXT_RE = /^(=+|-+)\s*$/;

interface Line {
  text: string;
  /** Line in the deck source this text came from (include lines fan out). */
  origin: number;
}

/**
 * Compute the slide spans of a deck.
 *
 * `includes` is the same map RenderInputs carries (basename and/or project
 * path → file contents). When given, `{{< include … >}}` shortcodes are
 * expanded the way the renderer expands them, and every slide that comes
 * from an included file maps to the line holding the shortcode. Without it,
 * an include line is treated as ordinary content.
 */
export function slideMap(qmd: string, includes?: Map<string, string>): SlideSpan[] {
  const source = qmd.split("\n");
  const lastLine = Math.max(0, source.length - 1);

  // 1. Expand includes, remembering which source line each line came from.
  const lines: Line[] = [];
  source.forEach((raw, origin) => {
    const text = raw.replace(/\r$/, "");
    if (!includes || !text.includes("{{<")) {
      lines.push({ text, origin });
      return;
    }
    const expanded = text.replace(INCLUDE_RE, (match, path: string) => {
      const basename = path.split("/").pop() ?? path;
      return includes.get(basename) ?? includes.get(path) ?? match;
    });
    for (const part of expanded.split("\n")) lines.push({ text: part.replace(/\r$/, ""), origin });
  });

  const spans: SlideSpan[] = [];
  let h = -1;
  let v = 0;
  let underH1 = false; // level-2 breaks nest vertically under a level-1 heading
  let open = false; // is there a slide that loose content can still join?

  const push = (kind: "horizontal" | "nested", startLine: number) => {
    if (kind === "nested" && underH1 && h >= 0) v += 1;
    else {
      h += 1;
      v = 0;
    }
    spans.push({ h, v, startLine, endLine: startLine });
    open = true;
  };

  // 2. Frontmatter: only a `title` makes pandoc emit a title slide.
  let i = 0;
  if (lines.length > 0 && FRONTMATTER_OPEN.test(lines[0].text)) {
    let close = -1;
    for (let j = 1; j < lines.length; j++) {
      if (/^(---|\.\.\.)\s*$/.test(lines[j].text)) {
        close = j;
        break;
      }
    }
    if (close > 0) {
      let hasTitle = false;
      try {
        const meta = YAML.parse(lines.slice(1, close).map((l) => l.text).join("\n"));
        hasTitle = !!meta && typeof meta === "object" && (meta as Record<string, unknown>).title != null;
      } catch {
        hasTitle = lines.slice(1, close).some((l) => /^title\s*:/.test(l.text));
      }
      if (hasTitle) {
        push("horizontal", 0);
        open = false; // body content never joins the title slide
      }
      i = close + 1;
    }
  }

  // 3. Body scan.
  let fence: { char: string; len: number } | null = null;
  let divDepth = 0;
  let inComment = false;
  let paragraphStart = -1; // origin line of the paragraph in progress, or -1
  let pendingRule = -1; // origin line of a rule waiting for its slide's content
  // Enough state to undo the slide a paragraph provisionally opened, should
  // the next line turn that paragraph into a setext heading.
  let previousPosition = { h: -1, v: 0 };
  let previousUnderH1 = false;
  let paragraphCreatedSlide = false;

  const startFromHeading = (level: number, origin: number) => {
    pendingRule = -1;
    if (level === 1) {
      underH1 = false; // force a new horizontal slide…
      push("horizontal", origin);
      underH1 = true; // …and nest what follows beneath it
    } else {
      push("nested", origin);
    }
  };

  const content = (origin: number) => {
    if (pendingRule >= 0) {
      push("nested", pendingRule);
      pendingRule = -1;
    } else if (!open) {
      push("nested", origin);
    }
  };

  for (; i < lines.length; i++) {
    const { text, origin } = lines[i];
    const blank = text.trim() === "";

    if (fence) {
      const m = FENCE_RE.exec(text);
      if (m && m[1][0] === fence.char && m[1].length >= fence.len && text.trim() === m[1]) fence = null;
      continue;
    }
    if (inComment) {
      if (text.includes("-->")) inComment = false;
      continue;
    }
    if (blank) {
      paragraphStart = -1;
      continue;
    }

    const fenceOpen = FENCE_RE.exec(text);
    if (fenceOpen) {
      content(origin);
      fence = { char: fenceOpen[1][0], len: fenceOpen[1].length };
      paragraphStart = -1;
      continue;
    }

    const div = DIV_RE.exec(text);
    if (div) {
      content(origin);
      if (div[1].trim() === "") divDepth = Math.max(0, divDepth - 1);
      else divDepth += 1;
      paragraphStart = -1;
      continue;
    }

    if (text.trimStart().startsWith("<!--")) {
      if (!text.includes("-->")) inComment = true;
      continue;
    }

    if (divDepth > 0) {
      content(origin);
      continue;
    }

    if (paragraphStart >= 0) {
      // Inside a paragraph, `===` / `---` underline it into a setext heading;
      // anything else (including `# text`) is just more paragraph.
      const setext = SETEXT_RE.exec(text);
      if (setext) {
        const level = setext[1][0] === "=" ? 1 : 2;
        // The paragraph opened a slide of its own only if nothing else did;
        // re-anchor: drop a slide this paragraph created, then start the
        // heading's slide at the paragraph's first line.
        const last = spans[spans.length - 1];
        if (last && last.startLine === paragraphStart && paragraphCreatedSlide) {
          spans.pop();
          ({ h, v } = previousPosition);
          underH1 = previousUnderH1;
        }
        startFromHeading(level, paragraphStart);
        paragraphStart = -1;
      }
      continue;
    }

    const atx = ATX_RE.exec(text);
    if (atx) {
      const level = atx[1].length;
      if (level <= 2) startFromHeading(level, origin);
      else content(origin);
      continue;
    }

    if (RULE_RE.test(text)) {
      pendingRule = origin;
      continue;
    }

    // Plain content: starts (or continues) a paragraph.
    previousPosition = { h, v };
    previousUnderH1 = underH1;
    const before = spans.length;
    content(origin);
    paragraphCreatedSlide = spans.length > before;
    paragraphStart = origin;
  }

  // 4. Close the spans: each slide runs up to the line before the next one.
  for (let k = 0; k < spans.length; k++) {
    const next = spans[k + 1];
    spans[k].endLine = next ? Math.max(spans[k].startLine, next.startLine - 1) : lastLine;
  }
  return spans;
}

/** The slide containing `line` (0-based), or null for an empty deck. */
export function slideAtLine(spans: SlideSpan[], line: number): SlideSpan | null {
  let found: SlideSpan | null = null;
  for (const span of spans) {
    if (span.startLine <= line) found = span;
    else break;
  }
  return found ?? spans[0] ?? null;
}

/** The span for reveal indices (h, v), or null when the map has no such slide. */
export function slideAtIndex(spans: SlideSpan[], h: number, v: number): SlideSpan | null {
  return spans.find((s) => s.h === h && s.v === v) ?? spans.find((s) => s.h === h) ?? null;
}
