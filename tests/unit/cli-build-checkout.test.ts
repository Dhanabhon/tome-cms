import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { findCheckout } from '../../src/cli/build/checkout.js';

async function fakeCheckout(name = 'tome-cms', manifests = true) {
  const root = await mkdtemp(join(tmpdir(), 'tome-checkout-'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name }));
  await mkdir(join(root, 'src', 'themes', 'plain'), { recursive: true });
  if (manifests) await writeFile(join(root, 'src', 'themes', 'manifests.ts'), '');
  return root;
}

test('a checkout is found from its root and from any directory inside it', async (t) => {
  const root = await fakeCheckout();
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(findCheckout(root), root);
  assert.equal(findCheckout(join(root, 'src', 'themes', 'plain')), root);
});

test('this repository is a checkout', () => {
  const repository = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
  assert.equal(findCheckout(fileURLToPath(new URL('.', import.meta.url))), repository);
});

test('outside a checkout there is none: another package, a package without themes, or no package at all', async (t) => {
  const other = await fakeCheckout('some-site');
  const bare = await fakeCheckout('tome-cms', false);
  const empty = await mkdtemp(join(tmpdir(), 'tome-nothing-'));
  const broken = await mkdtemp(join(tmpdir(), 'tome-broken-'));
  await writeFile(join(broken, 'package.json'), '{ not json');
  t.after(() => Promise.all([other, bare, empty, broken].map((path) => rm(path, { recursive: true, force: true }))));
  assert.equal(findCheckout(join(other, 'src', 'themes')), null);
  assert.equal(findCheckout(bare), null);
  assert.equal(findCheckout(empty), null);
  assert.equal(findCheckout(broken), null);
});
