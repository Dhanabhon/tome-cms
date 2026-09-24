import assert from 'node:assert/strict';
import test from 'node:test';

import { publicClient, sitePopup } from '../../src/plugins/popup';

const home = { kind: 'home', locale: 'th' } as const;
const thai = {
  actionHref: '/th/deals', actionTh: 'รับส่วนลด', headingTh: 'ดีลร้อนแรง', textTh: 'ลด 15%',
};
const english = {
  actionEn: 'Claim my savings', actionHref: '/th/deals', declineEn: 'Maybe later', finePrintEn: 'Exclusions apply.',
  headingEn: 'Hottest deals',
};

test('the page’s own language is used whole when it has a heading', () => {
  const popup = sitePopup({ ...thai, ...english }, home)!;
  assert.equal(popup.heading, 'ดีลร้อนแรง');
  assert.equal(popup.text, 'ลด 15%');
  assert.equal(popup.action.label, 'รับส่วนลด');
  assert.equal(popup.decline, undefined, 'the English decline is not borrowed');
  assert.equal(popup.finePrint, undefined, 'nor its small print');
});

test('a language with no heading shows the other language’s popup, whole', () => {
  const popup = sitePopup({ ...english, textTh: 'ข้อความไทยที่ไม่มีหัวข้อ' }, home)!;
  assert.equal(popup.heading, 'Hottest deals');
  assert.equal(popup.text, undefined, 'the Thai message does not ride along');
  assert.equal(popup.decline, 'Maybe later');
  assert.equal(popup.finePrint, 'Exclusions apply.');
});

test('a popup needs a heading, a button and a link', () => {
  assert.equal(sitePopup({}, home), null);
  assert.equal(sitePopup({ ...thai, actionTh: '' }, home), null, 'no button text');
  assert.equal(sitePopup({ ...thai, actionHref: '' }, home), null, 'no link');
  assert.equal(sitePopup({ ...thai, headingTh: '   ' }, home), null, 'a heading of spaces is none');
});

test('it opens when and where it was told', () => {
  assert.deepEqual(
    [sitePopup(thai, home)!.trigger, sitePopup(thai, home)!.delaySeconds],
    ['delay', 10],
    'a delay of ten seconds until told otherwise',
  );
  assert.equal(sitePopup({ ...thai, delay: '5' }, home)!.delaySeconds, 5);
  assert.equal(sitePopup({ ...thai, delay: '7' }, home)!.delaySeconds, 10, 'a delay not on offer is the fallback');
  assert.equal(sitePopup({ ...thai, trigger: 'exit' }, home)!.trigger, 'exit');
  assert.equal(sitePopup({ ...thai, pages: 'home' }, { kind: 'post', locale: 'th' }), null, 'home only means not on an article');
  assert.ok(sitePopup({ ...thai, pages: 'home' }, home));
  assert.ok(sitePopup({ ...thai, pages: 'all' }, { kind: 'page', locale: 'th' }));
});

test('the dismiss key changes with the popup and only with it', () => {
  const key = sitePopup(thai, home)!.dismissKey;
  assert.match(key, /^popup-[a-z0-9]+$/);
  assert.equal(sitePopup({ ...thai }, home)!.dismissKey, key, 'the same popup, the same key');
  assert.equal(sitePopup({ ...thai, delay: '20' }, home)!.dismissKey, key, 'timing is not content');
  assert.notEqual(sitePopup({ ...thai, headingTh: 'ดีลใหม่' }, home)!.dismissKey, key);
  assert.notEqual(sitePopup({ ...thai, actionHref: '/th/other' }, home)!.dismissKey, key);
  assert.notEqual(sitePopup({ ...thai, image: '0f8fad5b-d9cb-469f-a165-70867728950e' }, home)!.dismissKey, key);
});

test('the picture is passed on by id, and the browser code runs only with a popup', () => {
  assert.equal(sitePopup({ ...thai, image: '0f8fad5b-d9cb-469f-a165-70867728950e' }, home)!.imageId, '0f8fad5b-d9cb-469f-a165-70867728950e');
  assert.equal(sitePopup(thai, home)!.imageId, undefined);
  assert.deepEqual(publicClient(thai, home), {});
  assert.equal(publicClient({}, home), null);
});
