import assert from 'node:assert/strict';
import test from 'node:test';

import { assertSameOrigin } from '../../src/server/auth/origin';

const configuredOrigin = 'https://cms.example.com';

test('accepts the configured origin and ignores request host headers', () => {
  assert.doesNotThrow(() => assertSameOrigin(new Request('https://internal.invalid/api/auth/sign-out', {
    headers: { Host: 'attacker.example', Origin: configuredOrigin },
    method: 'POST',
  }), configuredOrigin));
});

test('rejects cross-origin and missing-origin mutations', () => {
  for (const origin of ['https://attacker.example', 'null']) {
    assert.throws(
      () => assertSameOrigin(new Request(`${configuredOrigin}/api/auth/sign-out`, { headers: { Origin: origin }, method: 'POST' }), configuredOrigin),
      /origin/i,
    );
  }
  assert.throws(
    () => assertSameOrigin(new Request(`${configuredOrigin}/api/auth/sign-out`, { method: 'POST' }), configuredOrigin),
    /origin/i,
  );
});

test('allows safe GET and HEAD requests without an Origin header', () => {
  for (const method of ['GET', 'HEAD']) {
    assert.doesNotThrow(() => assertSameOrigin(new Request(`${configuredOrigin}/api/auth/get-session`, { method }), configuredOrigin));
  }
});

test('accepts loopback HTTP outside production', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    for (const origin of ['http://localhost:4321', 'http://127.0.0.1:4321', 'http://[::1]:4321']) {
      assert.doesNotThrow(() => assertSameOrigin(new Request(`${origin}/api/auth/get-session`), origin));
    }
    assert.throws(
      () => assertSameOrigin(new Request('http://cms.example.com/api/auth/get-session'), 'http://cms.example.com'),
      /HTTPS/i,
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('rejects HTTP configuration in production', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(
      () => assertSameOrigin(new Request('http://localhost:4321/api/auth/get-session'), 'http://localhost:4321'),
      /HTTPS/i,
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
