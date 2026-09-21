import assert from 'node:assert/strict';
import test from 'node:test';

import { withRetry } from '../../src/server/ai/typesafe';

/** A sender that answers each call with the next status in the list, and counts. */
function replies(...statuses: number[]) {
  const sent = { count: 0 };
  const send = async () => new Response(null, { status: statuses[Math.min(sent.count++, statuses.length - 1)] });
  return { send, sent };
}
const noWait = async () => undefined;

test('a burst of "try again" is waited out', async () => {
  // The service was measured failing a request with 503 and then answering the same
  // request eight times running. Two short waits turn most of those into answers.
  const { send, sent } = replies(503, 529, 200);
  const waits: number[] = [];
  const response = await withRetry(send, async (milliseconds) => { waits.push(milliseconds); });
  assert.equal(response.status, 200);
  assert.equal(sent.count, 3);
  assert.equal(waits.length, 2);
  assert.ok(waits[1]! > waits[0]!, 'backing off, not asking again at the same pace');
});

test('it gives up rather than waiting forever', async () => {
  const { send, sent } = replies(503, 503, 503, 503);
  assert.equal((await withRetry(send, noWait)).status, 503);
  assert.equal(sent.count, 3, 'three attempts, then the failure is reported');
});

test('a refusal that is not "try again" is not tried again', async () => {
  // A malformed request stays malformed; asking three times only triples the wait.
  for (const status of [400, 401, 422]) {
    const { send, sent } = replies(status, 200);
    assert.equal((await withRetry(send, noWait)).status, status);
    assert.equal(sent.count, 1, `${status} was retried`);
  }
});
