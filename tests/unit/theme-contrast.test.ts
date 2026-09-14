import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Pins the contrast of both themes to WCAG AA.
 *
 * This is not decoration: writing the dark palette by eye produced light text on
 * a light code block, because the code surface was keyed to --color-ink, which
 * inverts with the theme. A computed check catches that; a screenshot does not,
 * unless somebody happens to open a page with a code block in dark mode.
 */
const CSS = readFileSync(new URL('../../src/styles/installer-tokens.css', import.meta.url), 'utf8');

type Rgb = readonly [number, number, number];

function gamma(channel: number): number {
  return channel > 0.0031308 ? 1.055 * channel ** (1 / 2.4) - 0.055 : 12.92 * channel;
}

/** OKLCH to sRGB, clamped to gamut — enough for contrast, which only needs luminance. */
function oklchToRgb(lightness: number, chroma: number, hueDegrees: number): Rgb {
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
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

/** Reads every token declaration, mixed or literal, from one selector block. */
function readDeclarations(selector: string): Map<string, string> {
  const start = CSS.indexOf(selector);
  assert.notEqual(start, -1, `${selector} is missing from the token file`);
  const block = CSS.slice(start + selector.length, CSS.indexOf('\n  }', start) + 1 || CSS.indexOf('}', start));
  const declarations = new Map<string, string>();
  for (const [, name, value] of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    declarations.set(name, value.trim());
  }
  return declarations;
}

/** Reads the literal oklch() tokens from one selector block. Mixed tokens are skipped. */
function readTheme(selector: string): Map<string, Rgb> {
  const start = CSS.indexOf(selector);
  assert.notEqual(start, -1, `${selector} is missing from the token file`);
  const block = CSS.slice(start, CSS.indexOf('}', start));
  const tokens = new Map<string, Rgb>();
  for (const [, name, l, c, h] of block.matchAll(/--(color-[a-z0-9-]+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g)) {
    tokens.set(name, oklchToRgb(Number(l) / 100, Number(c), Number(h)));
  }
  return tokens;
}

/** [foreground, background, minimum] — 3 is the non-text threshold for focus rings. */
const PAIRS: ReadonlyArray<readonly [string, string, number]> = [
  ['color-ink', 'color-paper-2', 4.5],
  ['color-ink', 'color-paper', 4.5],
  ['color-muted', 'color-paper-2', 4.5],
  ['color-muted', 'color-paper', 4.5],
  ['color-muted', 'color-paper-3', 4.5],
  ['color-ink-2', 'color-paper', 4.5],
  ['color-accent', 'color-paper', 4.5],
  ['color-accent', 'color-paper-2', 4.5],
  ['color-accent', 'color-paper-3', 4.5],
  ['color-accent-ink', 'color-accent', 4.5],
  ['color-focus', 'color-paper-2', 3],
  ['color-focus', 'color-paper', 3],
  ['color-on-dark', 'color-hero', 4.5],
  ['color-on-dark-muted', 'color-hero', 4.5],
  ['color-on-dark', 'color-code-bg', 4.5],
  ['color-on-dark-muted', 'color-code-bg', 4.5],
  // The auth panel inks its text in a brand tone rather than --color-ink. Left out
  // of the first version of this list, which is how it reached a screenshot as dark
  // text on a dark panel.
  ['color-auth-ink', 'color-paper', 4.5],
  ['color-auth-ink', 'color-paper-2', 4.5],
];

for (const [label, selector] of [['light', ':root {'], ['dark', ":root[data-theme='dark'] {"]] as const) {
  test(`${label} theme meets WCAG AA on every surface pair`, () => {
    const theme = readTheme(selector);
    // The dark block only overrides; anything it leaves alone comes from :root.
    const base = selector === ':root {' ? theme : new Map([...readTheme(':root {'), ...theme]);
    for (const [fg, bg, minimum] of PAIRS) {
      const foreground = base.get(fg);
      const background = base.get(bg);
      assert.ok(foreground, `${label}: --${fg} is not a literal oklch token`);
      assert.ok(background, `${label}: --${bg} is not a literal oklch token`);
      const ratio = contrast(foreground, background);
      assert.ok(ratio >= minimum, `${label}: --${fg} on --${bg} is ${ratio.toFixed(2)}, below ${minimum}`);
    }
  });
}

test('the two themes are genuinely different, not a copy', () => {
  const dark = readTheme(":root[data-theme='dark'] {");
  const light = readTheme(':root {');
  assert.ok(dark.size >= 12, 'the dark theme must override the full surface set');
  const paperLight = light.get('color-paper-2');
  const paperDark = dark.get('color-paper-2');
  assert.ok(paperLight && paperDark);
  // Page background must actually invert, or "dark mode" is only a label.
  assert.ok(paperLight[0] > 0.8 && paperDark[0] < 0.3, 'the page background must invert between themes');
});

test('no source file paints a literal white surface', () => {
  // bg-white is never right: --color-surface means the same thing in light and
  // survives the theme flip, and a literal left the public homepage showing a
  // white card on a dark page. text-white is allowed, but only where the surface
  // underneath is dark in both themes, so it is checked by eye, not here.
  const offenders: string[] = [];
  const walk = (dir: URL) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) walk(child);
      else if (/\.(astro|tsx|css)$/.test(entry.name) && readFileSync(child, 'utf8').includes('bg-white')) {
        offenders.push(entry.name);
      }
    }
  };
  walk(new URL('../../src/', import.meta.url));
  assert.deepEqual(offenders, [], 'use bg-surface instead of bg-white');
});

test('both dark blocks declare the same palette', () => {
  // The media-query block and the data-theme block cannot share a rule, so the
  // palette is written twice. Nothing but this test stops the two drifting apart
  // and leaving a reader on a dark OS with a half-updated theme.
  const media = readDeclarations(":root:not([data-theme='light']) {");
  const attribute = readDeclarations(":root[data-theme='dark'] {");
  assert.ok(media.size >= 20, 'the media-query block must carry the whole palette');
  assert.deepEqual([...attribute.keys()].sort(), [...media.keys()].sort(), 'the two dark blocks declare different tokens');
  for (const [name, value] of attribute) {
    assert.equal(media.get(name), value, `--${name} differs between the two dark blocks`);
  }
});

test('the theme has three states, not two', () => {
  // Without the light override a reader on a dark OS could never force light.
  assert.match(CSS, /@media \(prefers-color-scheme: dark\)/, 'the system preference must be honoured');
  assert.match(CSS, /:root\[data-theme='dark'\]/, 'an explicit dark override must exist');
  assert.match(CSS, /:root\[data-theme='light'\][^{]*\{[^}]*color-scheme:\s*light/, 'an explicit light override must exist');
  assert.match(CSS, /:root:not\(\[data-theme='light'\]\)/, 'the system preference must yield to an explicit light choice');
});
