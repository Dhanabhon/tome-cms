import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('an owner with a shell can always get back in', () => {
  // The recovery page offers a single-use link "generated on the TomeCMS server itself" as
  // the alternative to a saved code. Nothing generated one, so an owner who lost their
  // Passkey and had not kept the codes was locked out of their own installation for good.
  const script = read('scripts/recovery-issue.ts');
  assert.match(script, /issueRecoveryEnrollment/);
  assert.match(script, /new URL\('\/recovery', getServerEnv\(\)\.TOME_CMS_PUBLIC_URL\)/);
  assert.match(script, /url\.searchParams\.set\('context', enrollment\.context\)/);
  // The link is the alternative to the codes, not a replacement: a set already saved stays valid.
  assert.doesNotMatch(script, /regenerateRecoveryCodes|storeRecoveryCodes/);
  assert.match(script, /closeDatabase/, 'the script has to let the process exit');
  const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
  assert.equal(scripts['recovery:issue'], 'node --env-file-if-exists=.env.local --import tsx scripts/recovery-issue.ts');
});
