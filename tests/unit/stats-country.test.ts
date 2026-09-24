import assert from 'node:assert/strict';
import test from 'node:test';

// A file that is not there: a site without the GeoIP database is allowed, and knows no countries.
process.env.TOME_CMS_GEOIP_PATH = '/nonexistent/dbip-country-lite.mmdb';

const { lookupCountry, readerCountry } = await import('../../src/server/stats/country');

test('the CDN’s country wins, the GeoIP file answers without it, and neither is unknown', () => {
  const somewhere = () => 'AU';
  const nowhere = () => '';
  assert.equal(readerCountry(new Headers({ 'CF-IPCountry': 'TH' }), '1.1.1.1', somewhere), 'TH');
  assert.equal(readerCountry(new Headers({ 'cf-ipcountry': ' th ' }), '1.1.1.1', somewhere), 'TH');
  assert.equal(readerCountry(new Headers(), '1.1.1.1', somewhere), 'AU');
  assert.equal(readerCountry(new Headers({ 'CF-IPCountry': 'XX' }), '1.1.1.1', somewhere), 'AU', 'Cloudflare’s unknown');
  assert.equal(readerCountry(new Headers({ 'CF-IPCountry': 'T1' }), '1.1.1.1', somewhere), 'AU', 'Tor');
  assert.equal(readerCountry(new Headers({ 'CF-IPCountry': 'Thailand' }), '1.1.1.1', somewhere), 'AU');
  assert.equal(readerCountry(new Headers(), '1.1.1.1', nowhere), '');
});

test('a configured header is read instead of Cloudflare’s', () => {
  process.env.TOME_CMS_COUNTRY_HEADER = 'X-Country-Code';
  try {
    assert.equal(readerCountry(new Headers({ 'X-Country-Code': 'JP', 'CF-IPCountry': 'TH' }), '1.1.1.1', () => ''), 'JP');
  } finally {
    delete process.env.TOME_CMS_COUNTRY_HEADER;
  }
});

test('without the database file every address is unknown, and nothing throws', () => {
  assert.equal(lookupCountry('8.8.8.8'), '');
  assert.equal(lookupCountry('not an address'), '');
});
