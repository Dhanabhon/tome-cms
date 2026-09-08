import assert from 'node:assert/strict';
import test from 'node:test';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:55432/test',
  TOME_CMS_PUBLIC_URL: 'http://localhost:4321',
  TOME_CMS_INSTALL_TOKEN: 'unit-test-install-token-32-bytes-long',
  BETTER_AUTH_SECRET: 'unit-test-better-auth-secret-32-bytes',
  TOME_CMS_CONTEXT_SECRET: 'unit-test-context-secret-32-bytes-long',
  TOME_CMS_RECOVERY_PEPPER: 'unit-test-recovery-pepper-32-bytes-long',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'unit-test',
  S3_SECRET_ACCESS_KEY: 'unit-test-secret',
  S3_BUCKET: 'unit-test-media',
  MEDIA_PUBLIC_URL: 'http://localhost:9000/unit-test-media/',
});

test('recovery codes carry 128 random bits and verify only through keyed hashes', async () => {
  const { generateRecoveryCodes, hashRecoveryCode, verifyRecoveryCodeHash } = await import('../../src/server/auth/recovery');
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) {
    assert.match(code, /^(?:[a-f0-9]{4}-){7}[a-f0-9]{4}$/);
    assert.equal(code.replaceAll('-', '').length, 32, '16 random bytes are encoded without truncation');
    const hash = hashRecoveryCode(code);
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.notEqual(hash, code);
    assert.equal(verifyRecoveryCodeHash(` ${code.toUpperCase()} `, hash), true);
    assert.equal(verifyRecoveryCodeHash(`${code.slice(0, -1)}0`, hash), code.endsWith('0'));
  }

  const firstHash = hashRecoveryCode(codes[0]!);
  process.env.TOME_CMS_RECOVERY_PEPPER = 'different-unit-test-recovery-pepper-value';
  assert.notEqual(hashRecoveryCode(codes[0]!), firstHash, 'the server-only pepper keys every stored hash');
});
