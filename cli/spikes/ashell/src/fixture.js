// SPIKE CODE (Phase 4.2) — load the fixture deck (./deck) through the jsc
// bridge, synchronously, into the RenderInputs shape core expects.

export function loadFixtureInputs(dir) {
  const read = (rel) => jsc.readFile(dir + "/deck/" + rel);
  const snippet = read("demos/_snippet.qmd");
  return {
    qmd: read("demos/slide.qmd"),
    stylesheet: read("theme.scss"),
    stylesheetIsPrecompiled: false,
    bib: read("references.bib"),
    assets: new Map(),
    includes: new Map([["demos/_snippet.qmd", snippet], ["_snippet.qmd", snippet]]),
  };
}

/** A ProjectFS over the jsc bridge (async interface, synchronous underneath). */
export function jscProjectFS(root) {
  const walk = (rel, out) => {
    for (const name of jsc.listFiles(rel ? root + "/" + rel : root)) {
      if (!name || name === "node_modules" || name.charAt(0) === ".") continue;
      const path = rel ? rel + "/" + name : name;
      if (jsc.isDirectory(root + "/" + path)) walk(path, out);
      else out.push(path);
    }
    return out;
  };
  return {
    listFiles: async () => walk("", []).sort(),
    readText: async (path) => jsc.readFile(root + "/" + path),
    readBytes: async (path) => {
      throw new Error("readBytes not needed for the fixture: " + path);
    },
  };
}
