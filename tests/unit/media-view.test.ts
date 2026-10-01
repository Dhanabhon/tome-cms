import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { readMediaView, writeMediaView } from '../../src/lib/media-view';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function stubStorage(storage: unknown) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

test('a library with no storage opens as a grid', () => {
  assert.equal(readMediaView(), 'grid');
  assert.doesNotThrow(() => writeMediaView('list'));
});

test('storage that throws gives a grid, and writing to it does not throw', () => {
  const refuse = () => { throw new Error('blocked'); };
  stubStorage({ getItem: refuse, setItem: refuse });
  assert.equal(readMediaView(), 'grid');
  assert.doesNotThrow(() => writeMediaView('list'));
});

test('a list is read back as a list, and anything else is a grid', () => {
  const values = new Map<string, string>();
  stubStorage({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  assert.equal(readMediaView(), 'grid');
  writeMediaView('list');
  assert.equal(values.get('tomecms.media.view'), 'list');
  assert.equal(readMediaView(), 'list');
  values.set('tomecms.media.view', 'tiles');
  assert.equal(readMediaView(), 'grid');
});
