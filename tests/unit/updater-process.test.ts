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

test('redacts mixed-case Go HTML-safe JSON secret representations', () => {
  assert.equal(
    redactDiagnosticText('abcdefgh\\u003cijklmnop', ['abcdefgh<ijklmnop']),
    '[redacted]',
  );
  const secret = 'abcdefgh<ijklmnop>qrstuvwx&yzABCDEF\u2028ghijklmn\u2029opqrstuv';
  const encoded = 'abcdefgh\\u003Cijklmnop\\u003eqrstuvwx\\u0026yzABCDEF\\u2028ghijklmn\\u2029opqrstuv';
  assert.equal(redactDiagnosticText(encoded, [secret]), '[redacted]');
});

test('redacts every representation before applying the diagnostic boundary', () => {
  const urlSecret = 'boundary secret+/with?&=value';
  const jsonSecret = 'boundary-"secret\\value-long';
  const goSecret = 'boundary-<secret>&\u2028\u2029-long';
  const base64Secret = 'secret-\u0fc0-secret-boundary';
  const standardBase64 = Buffer.from(base64Secret).toString('base64');
  const urlSafeBase64 = standardBase64.replace(/\+/g, '-').replace(/\//g, '_');
  const cases = [
    ['raw', urlSecret, urlSecret],
    ['URL component', urlSecret, encodeURIComponent(urlSecret)],
    ['URL', urlSecret, encodeURI(urlSecret)],
    ['form', urlSecret, new URLSearchParams({ value: urlSecret }).toString().slice('value='.length)],
    ['JSON', jsonSecret, JSON.stringify(jsonSecret).slice(1, -1)],
    ['Go JSON', goSecret, 'boundary-\\u003Csecret\\u003e\\u0026\\u2028\\u2029-long'],
    ['standard base64 padded', base64Secret, standardBase64],
    ['standard base64 unpadded', base64Secret, standardBase64.replace(/=+$/, '')],
    ['URL-safe base64 padded', base64Secret, urlSafeBase64],
    ['URL-safe base64 unpadded', base64Secret, urlSafeBase64.replace(/=+$/, '')],
  ] as const;
  const prefix = 'x'.repeat(4 * 1024 - 16);

  assert.notEqual(standardBase64, urlSafeBase64);
  assert.match(standardBase64, /=+$/);
  for (const [label, secret, representation] of cases) {
    assert.ok(Buffer.byteLength(representation) > 16, `${label} must cross the boundary`);
    const diagnostic = redactDiagnosticText(`${prefix}${representation}`, [secret]);
    assert.equal(diagnostic, `${prefix}[redacted]`, label);
    assert.ok(Buffer.byteLength(diagnostic!) <= 4 * 1024, label);
    assert.ok(Buffer.byteLength(JSON.stringify(diagnostic)) - 2 <= 4 * 1024, label);
  }
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
