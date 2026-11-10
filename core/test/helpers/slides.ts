// Test helper: read the slide structure out of pandoc's revealjs HTML as a
// list of "h.v" indices, the way reveal.js numbers them. Top-level <section>
// elements under .slides are horizontal slides; <section>s nested inside one
// are its vertical slides. The footnotes section pandoc appends at the end of
// the document is skipped: it is a slide, but no source line produces it.

export function htmlSlideIndices(html: string): string[] {
  const start = html.indexOf('<div class="slides">');
  if (start < 0) throw new Error("no .slides container in HTML");
  const out: string[] = [];
  const tag = /<(\/?)section\b[^>]*>/g;
  tag.lastIndex = start;
  let depth = 0;
  let h = -1;
  let v = -1;
  let pendingFlat = false; // a depth-1 section with no nested sections (yet)
  let m: RegExpExecArray | null;
  while ((m = tag.exec(html))) {
    if (m[1] === "") {
      depth += 1;
      if (depth === 1 && /\bid="footnotes"/.test(m[0])) {
        pendingFlat = false;
      } else if (depth === 1) {
        h += 1;
        v = -1;
        pendingFlat = true;
      } else if (depth === 2) {
        v += 1;
        pendingFlat = false;
        out.push(`${h}.${v}`);
      }
    } else {
      if (depth === 1 && pendingFlat) out.push(`${h}.0`);
      depth -= 1;
      if (depth < 0) break;
    }
    // Stop once we leave the slides container.
    if (depth === 0 && html.slice(tag.lastIndex, tag.lastIndex + 200).match(/^\s*<\/div>/)) break;
  }
  return out;
}
