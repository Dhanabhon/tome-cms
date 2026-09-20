import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

// The same environment the other unit tests stand up, because sealing reads the context
// secret the rest of the product signs with.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://tome:tome@localhost:5432/tome',
  TOME_CMS_PUBLIC_URL: 'http://localhost:4321',
  TOME_CMS_INSTALL_TOKEN: 'install-test-secret-at-least-32-bytes',
  BETTER_AUTH_SECRET: 'better-auth-test-secret-at-least-32-bytes',
  TOME_CMS_CONTEXT_SECRET: 'plugin-secrets-test-context-at-least-32-bytes',
  TOME_CMS_RECOVERY_PEPPER: 'recovery-test-secret-at-least-32-bytes',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
  S3_BUCKET: 'tome-media',
  MEDIA_PUBLIC_URL: 'http://localhost:9000/tome-media',
});

const { isSealed, openSecret, sealSecret } = await import('../../src/server/plugins/secrets');

test('a sealed secret opens, and says nothing about itself while sealed', () => {
  const secret = '0x4AAAAAAA-a-turnstile-secret';
  const sealed = sealSecret(secret);
  assert.equal(openSecret(sealed), secret);
  assert.ok(isSealed(sealed));
  assert.ok(!sealed.includes(secret), 'the ciphertext carries the plaintext');
  // A fresh IV each time, so sealing one value twice does not say it is one value.
  assert.notEqual(sealSecret(secret), sealed);
});

test('anything that is not a secret this build can open is not one', () => {
  const sealed = sealSecret('a-secret');
  const [version, payload] = sealed.split('.');
  // Authenticated encryption: a payload edited by one character opens as nothing at all.
  const tampered = `${version}.${payload.slice(0, -4)}${payload.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'}`;
  assert.equal(openSecret(tampered), null);
  for (const junk of ['', 'v1.', 'v2.abcd', 'not-sealed', sealed.slice(3)]) {
    assert.equal(openSecret(junk), null, `${junk} opened`);
  }
  for (const junk of ['', 'plain text', 'v1', 42, null]) assert.equal(isSealed(junk), false);
});

test('a plugin is given what it needs and cannot go looking for more', () => {
  const dir = new URL('../../src/plugins/', import.meta.url);
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const source = readFileSync(new URL(`${entry.parentPath.split('src/plugins/')[1] ?? ''}/${entry.name}`.replace(/^\//, ''), dir), 'utf8');
    assert.doesNotMatch(source, /from '[^']*\/server\//, `${entry.name} reaches into the server`);
    assert.doesNotMatch(source, /from '[^']*\/pages\//, `${entry.name} reaches into the routes`);
    assert.doesNotMatch(source, /from '[^']*\/db\//, `${entry.name} reaches into the database`);
  }
});

test('the admin is never sent a secret', () => {
  const store = readFileSync(new URL('../../src/server/plugins/store.ts', import.meta.url), 'utf8');
  // readPluginStates answers with whether a secret is set, never with the value, and the
  // API answers every write with that same shape.
  assert.match(store, /secrets\[setting\.key\] = isSealed\(stored\[setting\.key\]\)/);
  // The reader the admin calls asks only whether a secret is sealed. Opening one is the
  // other reader's job, and that one answers the server, not a browser.
  const forTheAdmin = store.slice(store.indexOf('export async function readPluginStates'), store.indexOf('export async function readEnabledPlugin'));
  assert.doesNotMatch(forTheAdmin, /openSecret/);
  assert.match(store.slice(store.indexOf('export async function readEnabledPlugin')), /openSecret/);
  const api = readFileSync(new URL('../../src/pages/api/admin/plugins/index.ts', import.meta.url), 'utf8');
  assert.equal(api.match(/Response\.json\(\{ plugins: await readPluginStates\(/g)?.length, 2, 'both answers are the state the admin may see');
  assert.doesNotMatch(api, /readEnabledPlugin|openSecret/);
});
