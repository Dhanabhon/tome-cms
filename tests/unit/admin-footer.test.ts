import assert from 'node:assert/strict';
import test from 'node:test';

import { adminCopy } from '../../src/lib/admin-i18n';

test('the admin footer thanks the writer and names who makes TomeCMS, in the admin\'s language', () => {
  assert.equal(adminCopy('en').shell.thanks, 'Thanks for writing with {product}.');
  assert.equal(adminCopy('th').shell.thanks, 'ขอบคุณที่เขียนด้วย {product}');
  assert.equal(adminCopy('en').shell.poweredBy, 'Powered by {company}');
  assert.equal(adminCopy('th').shell.poweredBy, 'พัฒนาโดย {company}');
  assert.equal(adminCopy('en').shell.footerLabel, 'About TomeCMS');
  assert.equal(adminCopy('th').shell.footerLabel, 'เกี่ยวกับ TomeCMS');
});
