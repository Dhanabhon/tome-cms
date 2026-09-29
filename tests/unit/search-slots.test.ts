import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HttpError } from '../../src/server/http/errors';
import { whileSearching } from '../../src/server/http/search-limit';

const deferred = () => {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => { finish = resolve; });
  return { finish, promise };
};

test('only two searches run at once, the rest are told to try again, and a finished one frees its place', async () => {
  const first = deferred();
  const second = deferred();
  const running = [whileSearching(() => first.promise), whileSearching(() => second.promise)];

  await assert.rejects(
    whileSearching(async () => 'never runs'),
    (error: unknown) => error instanceof HttpError && error.status === 429,
    'a third waits for nobody: the database is the thing being protected',
  );

  first.finish();
  await running[0];
  assert.equal(await whileSearching(async () => 'ran'), 'ran', 'a place is free again');

  // A search that fails gives its place back too.
  await assert.rejects(whileSearching(async () => { throw new Error('boom'); }), /boom/);
  second.finish();
  await running[1];
  assert.equal(await whileSearching(async () => 'ran again'), 'ran again');
});
