import assert from 'node:assert/strict';
import test from 'node:test';

import { redactDiagnosticText } from '../../src/updater/process.js';

test('redacts common secret representations and bounds private diagnostics', () => {
  const secret = 'private:"value+/ with spaces?&=☃';
  const forms = [
    secret,
    encodeURIComponent(secret),
    encodeURI(secret),
    new URLSearchParams({ value: secret }).toString().slice('value='.length),
    JSON.stringify(secret).slice(1, -1),
    Buffer.from(secret).toString('base64'),
    Buffer.from(secret).toString('base64url'),
  ];
  const diagnostic = redactDiagnosticText(`${forms.join('\n')}\n${'x'.repeat(16 * 1024)}`, [secret]);

  assert.ok(forms.every((form) => !diagnostic.includes(form)));
  assert.match(diagnostic, /\[redacted\]/);
  assert.ok(Buffer.byteLength(diagnostic) <= 4 * 1024);
  const escaped = redactDiagnosticText('\0'.repeat(16 * 1024), []);
  assert.ok(Buffer.byteLength(JSON.stringify(escaped)) - 2 <= 4 * 1024);
});
