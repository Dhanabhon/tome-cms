import assert from 'node:assert/strict';
import { test } from 'node:test';

import { markRenderDegraded, memoForRequest, renderDegraded, withRequestMemo } from '../../src/server/request-memo';

test('within one request a read is made once, and each request makes its own', async () => {
  let reads = 0;
  const read = () => memoForRequest('settings', async () => { reads += 1; return { reads }; });

  const first = await withRequestMemo(async () => [await read(), await read(), await Promise.all([read(), read()])]);
  assert.equal(reads, 1, 'four reads, one query, even when they overlap');
  assert.deepEqual(first[0], { reads: 1 });

  await withRequestMemo(async () => { await read(); });
  assert.equal(reads, 2, 'the next request reads again, so an edit is seen at once');
});

test('outside a request nothing is kept, and a failed read is not kept either', async () => {
  let reads = 0;
  const read = () => memoForRequest('x', async () => { reads += 1; return reads; });
  await read();
  await read();
  assert.equal(reads, 2, 'a script or a job reads fresh every time');

  let attempts = 0;
  await withRequestMemo(async () => {
    const flaky = () => memoForRequest('flaky', async () => { attempts += 1; if (attempts === 1) throw new Error('once'); return 'ok'; });
    await assert.rejects(flaky(), /once/);
    assert.equal(await flaky(), 'ok', 'a failure is not remembered');
  });
});

test('a render marked degraded is that request alone, even when two requests interleave', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const failing = withRequestMemo(async () => {
    assert.equal(renderDegraded(), false, 'a request starts whole');
    await gate;
    markRenderDegraded();
    await Promise.resolve();
    return renderDegraded();
  });
  const whole = withRequestMemo(async () => {
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return renderDegraded();
  });
  assert.deepEqual(await Promise.all([failing, whole]), [true, false]);
  markRenderDegraded();
  assert.equal(renderDegraded(), false, 'outside a request there is nothing to mark');
});
