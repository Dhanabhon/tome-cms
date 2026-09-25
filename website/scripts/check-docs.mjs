#!/usr/bin/env node
/**
 * The site's own rules, checked on every build.
 *
 * Every page has a twin in the other language, so a reader who switches never lands on a
 * missing page. No page carries the marks the /humanizer skill names: em and en dashes, and
 * the words that give machine-written prose away.
 *
 * Usage: node scripts/check-docs.mjs [--self-test]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = fileURLToPath(new URL('../src/content/docs/', import.meta.url));
const PAGE = /\.(md|mdx)$/;
const DASH = /[\u2013\u2014]/;
// The skill's high-frequency list, less the words with an ordinary technical meaning in these
// pages ("key" as in API key, "landscape" as in a picture's orientation).
const WORDS = /\b(additionally|crucial|delve[sd]?|delving|fostering|garner(?:s|ed)?|interplay|intricate|intricacies|pivotal|showcas(?:e|es|ed|ing)|tapestry|testament|underscor(?:e|es|ed|ing)|vibrant|seamless(?:ly)?)\b/i;

/** Every page under a directory, as paths relative to it with forward slashes. */
export function pagesIn(directory, base = directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return pagesIn(path, base);
    return PAGE.test(entry.name) ? [relative(base, path).split('\\').join('/')] : [];
  });
}

/** Pages whose twin in the other language is missing. */
export function missingTwins(pages) {
  const thai = new Set(pages.filter((page) => page.startsWith('th/')).map((page) => page.slice(3)));
  const english = new Set(pages.filter((page) => !page.startsWith('th/')));
  return [
    ...[...english].filter((page) => !thai.has(page)).map((page) => `th/${page} is missing (twin of ${page})`),
    ...[...thai].filter((page) => !english.has(page)).map((page) => `${page} is missing (twin of th/${page})`),
  ];
}

/** Lines outside code that carry a dash or a listed word. */
export function marks(text) {
  const found = [];
  let fenced = false;
  text.split('\n').forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const prose = line.replace(/`[^`]*`/g, '');
    if (DASH.test(prose)) found.push(`line ${index + 1}: an em or en dash`);
    const word = prose.match(WORDS);
    if (word) found.push(`line ${index + 1}: "${word[0]}"`);
  });
  return found;
}

function selfTest() {
  const pages = ['index.mdx', 'start/install.md', 'th/index.mdx', 'th/running/backups.md'];
  const twins = missingTwins(pages);
  if (twins.length !== 2 || !twins.includes('th/start/install.md is missing (twin of start/install.md)')
    || !twins.includes('running/backups.md is missing (twin of th/running/backups.md)')) {
    throw new Error(`missingTwins is wrong: ${JSON.stringify(twins)}`);
  }
  const text = ['A plain line.', 'A line \u2014 with a dash.', '```', 'code \u2014 is fine', '```', 'This is crucial.', 'Use `seamless` in code.'].join('\n');
  const found = marks(text);
  if (found.length !== 2 || !found[0].startsWith('line 2') || !found[1].includes('crucial')) {
    throw new Error(`marks is wrong: ${JSON.stringify(found)}`);
  }
  console.log('check-docs self-test passed.');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const pages = pagesIn(DOCS);
  const problems = [
    ...missingTwins(pages),
    ...pages.flatMap((page) => marks(readFileSync(join(DOCS, page), 'utf8')).map((mark) => `${page} ${mark}`)),
  ];
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`${pages.length} pages: every page has its twin, and none carries a listed mark.`);
}
