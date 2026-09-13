import assert from 'node:assert/strict';
import test from 'node:test';

import { z } from 'zod';

import { adminErrorResponse, HttpError } from '../../src/server/http/errors';
import { parseJson } from '../../src/server/http/json';

const schema = z.object({ name: z.string().min(1) }).strict();
const request = (body: string, contentType = 'application/json') => new Request('http://localhost/api/admin/test', {
  method: 'POST',
  headers: { 'content-type': contentType },
  body,
});

test('Admin JSON and errors stay bounded, classified, and secret-free', async () => {
  assert.deepEqual(await parseJson(request('{"name":"Tome"}'), schema), { name: 'Tome' });

  const cases: Array<[() => Promise<unknown>, number]> = [
    [() => parseJson(request('{'), schema), 400],
    [() => parseJson(request('{"name":""}'), schema), 400],
    [() => parseJson(request('{"name":"Tome"}', 'text/plain'), schema), 415],
    [() => parseJson(request(`{"name":"${'x'.repeat(1_000_001)}"}`), schema), 413],
    [() => parseJson(request(`${'['.repeat(257)}0${']'.repeat(257)}`), z.unknown()), 400],
    [() => parseJson(request('1e400'), z.unknown()), 400],
  ];
  for (const [operation, status] of cases) {
    await assert.rejects(operation(), (error: unknown) => (
      (error instanceof HttpError && error.status === status) || (status === 400 && error instanceof z.ZodError)
    ));
  }

  for (const status of [401, 403, 404, 409, 413, 415, 429, 503] as const) {
    const response = adminErrorResponse(new HttpError(status, `Safe ${status}`), 'request-1');
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: `Safe ${status}`, requestId: 'request-1' });
  }

  const conflict = adminErrorResponse({ code: '23505', message: 'PRIVATE SQL DETAIL' }, 'request-2');
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { error: 'That value already exists.', requestId: 'request-2' });

  const messages: string[] = [];
  const originalError = console.error;
  console.error = (...values: unknown[]) => { messages.push(values.map(String).join(' ')); };
  try {
    const unexpected = adminErrorResponse({ code: 'XX000', message: 'PRIVATE SELECT * FROM secrets' }, 'request-3');
    assert.equal(unexpected.status, 500);
    assert.deepEqual(await unexpected.json(), { error: 'The request could not be completed.', requestId: 'request-3' });
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(messages, ['Admin request failed [request-3] database_error']);
});
