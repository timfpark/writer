import { describe, expect, it } from "vitest";
import tokensCss from "./tokens.css?raw";

type Theme = "light" | "dark";
type Declarations = Map<string, string>;

// ADR 0007's contrast targets, each a foreground on a background.
const pairs: [foreground: string, background: string, target: number][] = [
  ["--color-ink", "--color-page", 10],
  ["--color-ink-muted", "--color-page", 7],
  ["--color-text", "--color-chrome", 4.5],
  ["--color-text-muted", "--color-chrome", 4.5],
  ["--color-text", "--color-chrome-raised", 4.5],
  ["--color-text-muted", "--color-chrome-raised", 4.5],
  ["--color-text", "--color-current", 4.5],
  ["--color-border", "--color-chrome", 3],
  ["--color-accent", "--color-chrome", 3],
  ["--color-accent", "--color-page", 3],
  ["--color-accent", "--color-current", 3],
];

function declarationsIn(block: string): Declarations {
  const declarations: Declarations = new Map();
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) {
      declarations.set(name, value.trim());
    }
  }
  return declarations;
}

// Returns the body of the block whose header matches, found by balancing
// braces, so a nested :root inside an @media rule is read whole.
function blockAfter(css: string, header: RegExp): string {
  const match = header.exec(css);
  if (!match) {
    throw new Error(`tokens.css has no block matching ${header}`);
  }
  const open = css.indexOf("{", match.index);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(open + 1, index);
  }
  throw new Error(`tokens.css has an unclosed block matching ${header}`);
}

function themes(css: string): Record<Theme, Declarations> {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const light = declarationsIn(blockAfter(source, /^:root\s*\{/m));
  const darkMedia = blockAfter(
    source,
    /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/,
  );
  const dark = new Map([
    ...light,
    ...declarationsIn(blockAfter(darkMedia, /:root\s*\{/)),
  ]);
  return { light, dark };
}

function resolve(declarations: Declarations, name: string): string {
  const value = declarations.get(name);
  if (value === undefined) {
    throw new Error(`tokens.css does not define ${name}`);
  }
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  return reference?.[1] ? resolve(declarations, reference[1]) : value;
}

function luminance(hex: string): number {
  const digits = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!digits) {
    throw new Error(`expected a #rrggbb color, got ${hex}`);
  }
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((offset) => {
    const channel = parseInt(digits.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("design tokens", () => {
  const byTheme = themes(tokensCss);

  describe.each(["light", "dark"] as const)("%s theme", (theme) => {
    it.each(pairs)("%s on %s meets %d:1", (foreground, background, target) => {
      const declarations = byTheme[theme];
      const ratio = contrast(
        resolve(declarations, foreground),
        resolve(declarations, background),
      );
      expect(ratio).toBeGreaterThanOrEqual(target);
    });
  });

  it("defines a dark value for every semantic color", () => {
    const darkMedia = blockAfter(
      tokensCss,
      /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/,
    );
    const darkNames = [...declarationsIn(darkMedia).keys()];
    const semantic = [...byTheme.light.keys()].filter((name) =>
      name.startsWith("--color-"),
    );
    expect(darkNames.sort()).toEqual(semantic.sort());
  });
});
