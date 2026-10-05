import assert from 'node:assert/strict';
import test from 'node:test';

import { adminCopy } from '../../src/lib/admin-i18n';
import { guessDeviceName } from '../../src/lib/device-name';
import { isExpiredLinkFailure } from '../../src/lib/passkey-failure';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';

test('a device is named from its user agent, in the owner’s language', () => {
  for (const locale of ['en', 'th'] as const) {
    const names = adminCopy(locale).addDevice.deviceNames;
    assert.equal(guessDeviceName({ userAgent: IPHONE }, names), names.iphone);
    assert.equal(guessDeviceName({ userAgent: IPAD }, names), names.ipad);
    assert.equal(guessDeviceName({ userAgent: MAC, maxTouchPoints: 0 }, names), names.mac);
    assert.equal(guessDeviceName({ userAgent: WINDOWS }, names), names.windows);
    assert.equal(guessDeviceName({ userAgent: ANDROID }, names), names.android);
    assert.equal(guessDeviceName({ userAgent: LINUX }, names), names.other);
    assert.equal(guessDeviceName({ userAgent: '' }, names), names.other);
  }
  assert.deepEqual(
    Object.values(adminCopy('en').addDevice.deviceNames),
    ['Windows device', 'Mac', 'iPhone', 'iPad', 'Android device', 'New device'],
  );
});

test('iPadOS, which reports a Mac, is told apart by its touch screen', () => {
  const names = adminCopy('en').addDevice.deviceNames;
  assert.equal(guessDeviceName({ userAgent: MAC, maxTouchPoints: 5 }, names), 'iPad');
  assert.equal(guessDeviceName({ userAgent: MAC, maxTouchPoints: 1 }, names), 'Mac');
});

test('an invalid link is a bare 400; a dismissed prompt and a duplicate carry their own code', () => {
  assert.equal(isExpiredLinkFailure({ data: null, error: { error: 'Enrollment context is invalid or expired.', status: 400 } }), true);
  assert.equal(isExpiredLinkFailure({ data: null, error: { code: 'ERROR_CEREMONY_ABORTED', status: 400 } }), false);
  assert.equal(isExpiredLinkFailure({ data: null, error: { code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED', status: 400 } }), false);
  assert.equal(isExpiredLinkFailure({ data: null, error: { status: 500 } }), false);
  assert.equal(isExpiredLinkFailure(null), false);
});
