import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  signEnrollmentContext,
  verifyEnrollmentContext,
  type EnrollmentClaims,
} from '../../src/server/auth/context';

const secret = 'context-test-secret-that-is-at-least-32-bytes';
const now = new Date('2026-09-09T12:00:00.000Z');
const claims: EnrollmentClaims = {
  v: 1,
  id: randomUUID(),
  purpose: 'install',
  exp: Math.floor(now.getTime() / 1_000) + 600,
};

function signUnchecked(value: unknown): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

test('signed enrollment contexts verify only for their intended purpose', () => {
  const context = signEnrollmentContext(claims, secret);
  assert.deepEqual(verifyEnrollmentContext(context, 'install', secret, now), claims);
  assert.throws(() => verifyEnrollmentContext(context, 'recovery', secret, now), /invalid or expired/i);
});

test('signed enrollment contexts reject tampering and malformed input', () => {
  const context = signEnrollmentContext(claims, secret);
  const [payload, signature] = context.split('.');
  const tampered = `${payload}.${signature!.slice(0, -1)}${signature!.endsWith('A') ? 'B' : 'A'}`;

  for (const invalid of ['', 'payload-only', `${context}.extra`, '***.***', tampered]) {
    assert.throws(() => verifyEnrollmentContext(invalid, 'install', secret, now), /invalid or expired/i);
  }
  assert.throws(
    () => verifyEnrollmentContext(signUnchecked({ ...claims, extra: true }), 'install', secret, now),
    /invalid or expired/i,
  );
});

test('signed enrollment contexts expire at the declared second', () => {
  const context = signEnrollmentContext({ ...claims, exp: Math.floor(now.getTime() / 1_000) }, secret);
  assert.throws(() => verifyEnrollmentContext(context, 'install', secret, now), /invalid or expired/i);
});

test('VPS proxy keeps the app private and does not preserve spoofed or bearer-bearing requests', () => {
  const deployment = readFileSync(new URL('../../scripts/deploy-vps.sh', import.meta.url), 'utf8');
  const enrollmentLocation = deployment.match(
    /location = \/api\/auth\/passkey\/generate-register-options \{([\s\S]*?)\n    \}/,
  )?.[1] ?? '';

  assert.match(deployment, /Environment=HOST=127\.0\.0\.1/);
  assert.match(deployment, /proxy_set_header X-Forwarded-For \\\$remote_addr;/);
  assert.doesNotMatch(deployment, /proxy_add_x_forwarded_for/);
  assert.match(enrollmentLocation, /access_log off;/);
  assert.match(enrollmentLocation, /error_log \/dev\/null emerg;/);
  assert.match(enrollmentLocation, /proxy_pass http:\/\/127\.0\.0\.1:\$\{APP_PORT\};/);
});
