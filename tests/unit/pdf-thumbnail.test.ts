import assert from 'node:assert/strict';
import test from 'node:test';

import { thumbnailLoader } from '../../src/lib/pdf-thumbnail';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a card and the dialog for the same file share one render', async () => {
  let renders = 0;
  const loader = thumbnailLoader(async (id) => { renders += 1; return `blob:${id}`; }, 2, () => undefined);
  const [card, dialog] = await Promise.all([loader.load('a'), loader.load('a')]);
  assert.equal(card, 'blob:a');
  assert.equal(dialog, 'blob:a');
  assert.equal(await loader.load('a'), 'blob:a', 'and a later look is not a new render');
  assert.equal(renders, 1);
});

test('no more renders run at once than the limit, and every file still gets its turn', async () => {
  let active = 0;
  let peak = 0;
  const loader = thumbnailLoader(async (id) => {
    active += 1;
    peak = Math.max(peak, active);
    await tick();
    active -= 1;
    return `blob:${id}`;
  }, 2, () => undefined);
  const urls = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((id) => loader.load(id)));
  assert.deepEqual(urls, ['blob:a', 'blob:b', 'blob:c', 'blob:d', 'blob:e']);
  assert.equal(peak, 2);
});

test('a render that fails is null, is not retried, and does not stop the next one', async () => {
  let asked = 0;
  const loader = thumbnailLoader(async (id) => {
    asked += 1;
    if (id === 'bad') throw new Error('not a PDF');
    return `blob:${id}`;
  }, 1, () => undefined);
  assert.equal(await loader.load('bad'), null);
  assert.equal(await loader.load('good'), 'blob:good');
  assert.equal(await loader.load('bad'), null);
  assert.equal(asked, 2);
});

test('clearing revokes every address it made and forgets them', async () => {
  const revoked: string[] = [];
  let renders = 0;
  const loader = thumbnailLoader(async (id) => { renders += 1; return id === 'bad' ? null : `blob:${id}`; }, 2, (url) => revoked.push(url));
  await Promise.all([loader.load('a'), loader.load('b'), loader.load('bad')]);
  loader.clear();
  assert.deepEqual(revoked.sort(), ['blob:a', 'blob:b']);
  await loader.load('a');
  assert.equal(renders, 4, 'a file looked at again after a clear is rendered again');
});

test('clearing drops the renders still waiting, which resolve to nothing without being drawn', async () => {
  let release: () => void = () => undefined;
  const drawn: string[] = [];
  const loader = thumbnailLoader(async (id) => {
    drawn.push(id);
    await new Promise<void>((resolve) => { release = resolve; });
    return `blob:${id}`;
  }, 1, () => undefined);
  const loads = ['a', 'b', 'c'].map((id) => loader.load(id));
  await tick();
  loader.clear();
  release();
  assert.deepEqual(await Promise.all(loads), [null, null, null]);
  assert.deepEqual(drawn, ['a'], 'b and c were waiting, and never started');
});
