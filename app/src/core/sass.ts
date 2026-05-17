import * as sass from "sass";

export function compileScss(scssText: string): string {
  if (!scssText.trim()) return "";
  const result = sass.compileString(scssText, { style: "expanded" });
  return result.css;
}
