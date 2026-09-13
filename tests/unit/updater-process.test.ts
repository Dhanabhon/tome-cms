import assert from 'node:assert/strict';
import test from 'node:test';

import { parseManagedDiagnosticSecrets, redactDiagnosticText } from '../../src/updater/process.js';

test('redacts common secret representations and bounds private diagnostics', () => {
  const secret = 'private:"value+/ with spaces?&=☃';
  const base64Url = Buffer.from(secret).toString('base64url');
  const forms = [
    secret,
    encodeURIComponent(secret),
    encodeURI(secret),
    new URLSearchParams({ value: secret }).toString().slice('value='.length),
    JSON.stringify(secret).slice(1, -1),
    Buffer.from(secret).toString('base64'),
    Buffer.from(secret).toString('base64').replace(/=+$/, ''),
    base64Url,
    `${base64Url}${'='.repeat((4 - base64Url.length % 4) % 4)}`,
  ];
  forms.push(encodeURIComponent(secret).replace(/%[0-9A-F]{2}/g,
    (triplet, index) => index % 2 === 0 ? triplet.toLowerCase() : triplet));
  const diagnostic = redactDiagnosticText(`${forms.join('\n')}\n${'x'.repeat(16 * 1024)}`, [secret]);

  assert.notEqual(diagnostic, null);
  if (diagnostic === null) return;
  assert.ok(forms.every((form) => !diagnostic.includes(form)));
  assert.match(diagnostic, /\[redacted\]/);
  assert.ok(Buffer.byteLength(diagnostic) <= 4 * 1024);
  const escaped = redactDiagnosticText('\0'.repeat(16 * 1024), ['safe-secret-value']);
  assert.notEqual(escaped, null);
  if (escaped === null) return;
  assert.ok(Buffer.byteLength(JSON.stringify(escaped)) - 2 <= 4 * 1024);
});

test('redacts overlapping patterns once and fails closed for unsafe short secrets', () => {
  const diagnostic = redactDiagnosticText('prefix abcdefghijkl suffix abcdefgh', ['abcdefghijkl', 'abcdefgh']);
  assert.equal(diagnostic, 'prefix [redacted] suffix [redacted]');
  assert.equal(redactDiagnosticText('must not be logged', ['short']), null);
});

test('accepts only canonical literal managed secret assignments', () => {
  const runtimeSecret = 'runtime-secret-value';
  const configuredSecret = 'configured-secret-value';
  const databasePassword = 'database/private+value';
  const values = parseManagedDiagnosticSecrets(
    `TOME_CMS_INSTALL_TOKEN='${configuredSecret}'\nDATABASE_URL='postgresql://tomecms:database%2Fprivate%2Bvalue@postgres:5432/tomecms'\n`,
    { RUNTIME_API_KEY: runtimeSecret },
  );
  for (const value of [configuredSecret, runtimeSecret, databasePassword]) assert.ok(values.includes(value));
  for (const source of [
    'TOME_CMS_INSTALL_TOKEN=${RUNTIME_SECRET}\n',
    'TOME_CMS_INSTALL_TOKEN="${RUNTIME_SECRET}"\n',
    "export TOME_CMS_INSTALL_TOKEN='configured-secret-value'\n",
    "TOME_CMS_INSTALL_TOKEN='first-secret-value'\nTOME_CMS_INSTALL_TOKEN='second-secret-value'\n",
  ]) assert.throws(() => parseManagedDiagnosticSecrets(source, {}), /canonical managed environment/i);
});
