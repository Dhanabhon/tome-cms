import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Almanac's palette, measured rather than trusted, in both schemes.
 *
 * The theme writes its colours over the core's token names on an Almanac page, so every shared
 * piece -- the menu, the language switch, the theme toggle, the focus ring -- is drawn in them
 * too. That makes the pairs below the same pairs the core measures, plus the six panel tones.
 */
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const CSS = read('src/themes/almanac/theme.css');

const LIGHT = ':root:has(> body.almanac) {';
const DARK_SYSTEM = ":root:not([data-theme='light']):has(> body.almanac) {";
const DARK_CHOSEN = ":root[data-theme='dark']:has(> body.almanac) {";

type Rgb = readonly [number, number, number];

/** OKLCH to sRGB, clamped to gamut -- enough for contrast, which only needs luminance. */
function oklchToRgb(lightness: number, chroma: number, hueDegrees: number): Rgb {
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const gamma = (v: number) => (v > 0.0031308 ? 1.055 * v ** (1 / 2.4) - 0.055 : 12.92 * v);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => Math.min(1, Math.max(0, gamma(channel)))) as unknown as Rgb;
}

function contrast(foreground: Rgb, background: Rgb): number {
  const luminance = ([r, g, b]: Rgb) => {
    const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  };
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

function block(selector: string): string {
  const start = CSS.indexOf(selector);
  assert.notEqual(start, -1, `${selector} is missing from Almanac's stylesheet`);
  return CSS.slice(start + selector.length, CSS.indexOf('}', start));
}

/** Every declaration in a block, as written. */
function declarations(selector: string): Map<string, string> {
  return new Map([...block(selector).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

/** The literal oklch() colours of a block, keyed by token name. */
function colours(selector: string): Map<string, { hue: number; rgb: Rgb }> {
  const found = new Map<string, { hue: number; rgb: Rgb }>();
  for (const [name, value] of declarations(selector)) {
    const match = /^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)$/.exec(value);
    if (match) found.set(name, { hue: Number(match[3]), rgb: oklchToRgb(Number(match[1]) / 100, Number(match[2]), Number(match[3])) });
  }
  return found;
}

const TONES = [0, 1, 2, 3, 4, 5];
// [foreground, background, minimum]: 4.5 for anything read, 3 for a mark that is only seen.
const PAIRS: ReadonlyArray<readonly [string, string, number]> = [
  // Ink and the quieter text on the page, the cards and the hero band.
  ...['--color-paper', '--color-paper-2', '--color-paper-3', '--color-surface'].flatMap((surface) => [
    ['--color-ink', surface, 4.5] as const,
    ['--color-ink-2', surface, 4.5] as const,
    ['--color-muted', surface, 4.5] as const,
    ['--color-link', surface, 4.5] as const,
    ['--color-accent', surface, 4.5] as const,
    ['--color-focus', surface, 3] as const,
    ['--color-rule-strong', surface, 3] as const,
  ]),
  // The label on a filled button, at rest and under the cursor.
  ['--color-accent-ink', '--color-accent', 4.5],
  ['--color-accent-ink', '--color-accent-hover', 4.5],
  // A card with no cover: its letter, in the tone's own text colour, on the tone.
  ...TONES.map((index) => [`--almanac-tone-${index}-ink`, `--almanac-tone-${index}`, 4.5] as const),
];

for (const [scheme, selector] of [['light', LIGHT], ['dark', DARK_CHOSEN]] as const) {
  test(`Almanac's ${scheme} palette holds AA contrast`, () => {
    const palette = colours(selector);
    const failures: string[] = [];
    for (const [foreground, background, minimum] of PAIRS) {
      const fg = palette.get(foreground);
      const bg = palette.get(background);
      assert.ok(fg && bg, `${scheme} declares ${foreground} and ${background} as oklch()`);
      const ratio = contrast(fg.rgb, bg.rgb);
      if (ratio < minimum) failures.push(`${foreground} on ${background}: ${ratio.toFixed(2)} < ${minimum}`);
    }
    assert.deepEqual(failures, []);
  });

  test(`Almanac's ${scheme} accent is moss green, not orange`, () => {
    for (const token of ['--color-accent', '--color-accent-hover', '--color-link']) {
      const hue = colours(selector).get(token)?.hue ?? -1;
      assert.ok(hue >= 120 && hue <= 150, `${token} sits at hue ${hue}`);
    }
  });
}

test('the dark palette is the same whether the system asks for it or the reader chooses it', () => {
  assert.match(CSS, /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme='light'\]\):has\(> body\.almanac\) \{/);
  assert.deepEqual([...declarations(DARK_SYSTEM)], [...declarations(DARK_CHOSEN)]);
  // Dark repaints every colour light paints, so nothing is left behind in the light scheme.
  const lightNames = [...declarations(LIGHT).keys()].filter((name) => name.startsWith('--color-') || name.startsWith('--almanac-tone-'));
  for (const name of lightNames) assert.ok(declarations(DARK_CHOSEN).has(name), `dark repaints ${name}`);
});

test('every colour Almanac draws with is a token: no raw colour outside the token blocks', () => {
  const tokenBlocks = [LIGHT, DARK_SYSTEM, DARK_CHOSEN].map((selector) => block(selector));
  let rest = CSS;
  for (const tokens of tokenBlocks) rest = rest.replace(tokens, '');
  assert.doesNotMatch(rest, /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/i);
});

test("Trirong's faces are in Almanac's stylesheet and in no other", () => {
  const fonts = read('src/themes/almanac/fonts.css');
  assert.match(CSS, /^@import '\.\/fonts\.css';/m);
  for (const weight of [400, 600]) {
    for (const subset of ['latin', 'thai']) {
      assert.match(fonts, new RegExp(`url\\('/fonts/trirong-${subset}-${weight}-normal\\.woff2'\\)`));
    }
  }
  assert.equal(fonts.match(/@font-face/g)?.length, 4, 'two weights, two subsets, nothing else');
  assert.equal(fonts.match(/unicode-range:/g)?.length, 4, 'each face says which characters it carries');
  assert.equal(fonts.match(/font-display: swap;/g)?.length, 4);
  for (const other of ['public/fonts.css', 'src/styles/global.css', 'src/themes/paper/theme.css', 'src/themes/plain/theme.css']) {
    assert.doesNotMatch(read(other), /Trirong/, `${other} does not load Trirong`);
  }
  assert.match(CSS, /--font-display: 'Trirong',/);
});
