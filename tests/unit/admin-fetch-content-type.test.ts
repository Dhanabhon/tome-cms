import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

// Astro refuses a POST, PUT, PATCH or DELETE that has no content-type unless its Origin equals
// the URL it sees. Behind Caddy that URL is http:// while the browser's Origin is https://, so
// such a request got a plain-text 403 in production (deleting a file, 1.0.3) and passed every
// test over plain HTTP. Every mutating request the admin sends therefore names its content type.
async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

function enclosingObject(text: string, index: number): string {
  let start = index;
  for (let depth = 0; start > 0; start -= 1) {
    if (text[start] === '}') depth += 1;
    if (text[start] === '{') { if (depth === 0) break; depth -= 1; }
  }
  let end = index;
  for (let depth = 0; end < text.length; end += 1) {
    if (text[end] === '{') depth += 1;
    if (text[end] === '}') { if (depth === 0) break; depth -= 1; }
  }
  return text.slice(start, end + 1);
}

test('every mutating request from the admin names its content type', async () => {
  const missing: string[] = [];
  for (const file of [...await sources('src/components'), ...await sources('src/lib')]) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/method: ?'(POST|PUT|PATCH|DELETE)'/g)) {
      if (!/content-type/i.test(enclosingObject(text, match.index))) {
        missing.push(`${file}:${text.slice(0, match.index).split('\n').length}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
