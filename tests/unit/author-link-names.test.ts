import assert from 'node:assert/strict';
import test from 'node:test';

import { adminCopy } from '../../src/lib/admin-i18n';
import { LINK_SITES, linkNameChoice } from '../../src/lib/author-link-names';

test('a link called after a site the theme draws is that site, and anything else is the owner\'s own name', () => {
  assert.deepEqual([...LINK_SITES], ['GitHub', 'X', 'LinkedIn', 'Facebook', 'Instagram', 'YouTube']);
  for (const site of LINK_SITES) assert.equal(linkNameChoice(site, 'Website'), site);
  assert.equal(linkNameChoice('Website', 'Website'), 'website');
  assert.equal(linkNameChoice('เว็บไซต์', 'เว็บไซต์'), 'website', 'the word for a website follows the admin\'s language');
  assert.equal(linkNameChoice('My blog', 'Website'), 'other');
  assert.equal(linkNameChoice('github', 'Website'), 'other', 'a name written differently is kept as written');
  assert.equal(linkNameChoice('', 'Website'), 'other');
});

test('the dropdown\'s own words are in both languages', () => {
  assert.equal(adminCopy('en').profile.linkWebsite, 'Website');
  assert.equal(adminCopy('th').profile.linkWebsite, 'เว็บไซต์');
  assert.equal(adminCopy('en').profile.linkOther, 'Other…');
  assert.equal(adminCopy('th').profile.linkOther, 'อื่น ๆ');
  assert.equal(adminCopy('en').profile.linkName, 'Name for link {index}');
  assert.equal(adminCopy('th').profile.linkName, 'ชื่อที่แสดงของลิงก์ที่ {index}');
});
