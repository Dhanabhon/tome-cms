import assert from 'node:assert/strict';
import { test } from 'node:test';

import { adminCopy } from '../../src/lib/admin-i18n';
import { passkeyProvider, type PasskeyProvider } from '../../src/lib/passkey-providers';

const KNOWN: Array<[string, PasskeyProvider]> = [
  ['ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4', 'google'],
  ['fbfc3007-154e-4ecc-8c0b-6e020557d7bd', 'icloud'],
  ['dd4ec289-e01d-41c9-bb89-70fa845d4bf2', 'icloud'],
  ['adce0002-35bc-c60a-648b-0b25f1f05503', 'chrome-mac'],
  ['08987058-cadc-4b81-b6e1-30de50dcbe96', 'windows-hello'],
  ['9ddd1817-af5a-4672-a2b9-3e3dd95000a9', 'windows-hello'],
  ['6028b017-b1d4-4c02-b4b3-afcdafc96bb2', 'windows-hello'],
  ['bada5566-a7aa-401f-bd96-45619a55120d', '1password'],
  ['d548826e-79b4-db40-a3d8-11116f7e8349', 'bitwarden'],
  ['531126d6-e717-415c-9320-3d9aa6981239', 'dashlane'],
  ['53414d53-554e-4700-0000-000000000000', 'samsung-pass'],
  ['50726f74-6f6e-5061-7373-50726f746f6e', 'proton-pass'],
  ['fdb141b2-5d84-443e-8a35-4698c205a502', 'keepassxc'],
];
const ZEROS = '00000000-0000-0000-0000-000000000000';

test('names the provider of every known AAGUID', () => {
  for (const [aaguid, provider] of KNOWN) assert.equal(passkeyProvider(aaguid, 'hybrid,internal'), provider, aaguid);
});

test('matches an AAGUID in any letter case', () => {
  assert.equal(passkeyProvider('EA9B8D66-4D01-1D21-3CE4-B6B48CB575D4', null), 'google');
});

test('an unknown AAGUID with usb or nfc is a security key', () => {
  assert.equal(passkeyProvider(ZEROS, 'usb'), 'security-key');
  assert.equal(passkeyProvider(ZEROS, 'nfc,usb'), 'security-key');
  assert.equal(passkeyProvider('11111111-2222-3333-4444-555555555555', 'nfc'), 'security-key');
});

test('an unknown AAGUID without usb or nfc shows nothing', () => {
  assert.equal(passkeyProvider(ZEROS, 'internal'), null);
  assert.equal(passkeyProvider('11111111-2222-3333-4444-555555555555', 'hybrid,internal'), null);
});

test('a known AAGUID wins over security-key transports', () => {
  assert.equal(passkeyProvider('bada5566-a7aa-401f-bd96-45619a55120d', 'usb'), '1password');
});

test('a null or empty AAGUID is unknown, so usb or nfc still means a security key', () => {
  assert.equal(passkeyProvider(null, 'usb'), 'security-key');
  assert.equal(passkeyProvider(null, 'nfc'), 'security-key');
  assert.equal(passkeyProvider('', 'nfc'), 'security-key');
});

test('transports are trimmed and case-insensitive', () => {
  assert.equal(passkeyProvider(ZEROS, 'nfc, USB'), 'security-key');
  assert.equal(passkeyProvider(ZEROS, ' Usb '), 'security-key');
});

test('missing inputs show nothing', () => {
  assert.equal(passkeyProvider(null, null), null);
  assert.equal(passkeyProvider(null, 'internal'), null);
  assert.equal(passkeyProvider(ZEROS, null), null);
});

test('every provider has a name and a hint in English and Thai', () => {
  const keys = new Set<PasskeyProvider>([...KNOWN.map(([, provider]) => provider), 'security-key']);
  for (const locale of ['en', 'th'] as const) {
    const { providers } = adminCopy(locale).security;
    for (const key of keys) {
      assert.ok(providers[key].name.length > 0, `${locale} ${key} name`);
      assert.ok(providers[key].hint.length > 0, `${locale} ${key} hint`);
      assert.ok(!providers[key].hint.includes('!'), `${locale} ${key} hint`);
    }
  }
});
