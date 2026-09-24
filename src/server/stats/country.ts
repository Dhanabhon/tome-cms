import { readFileSync } from 'node:fs';

import { Reader, type CountryResponse } from 'mmdb-lib';

const CODE = /^[A-Z]{2}$/;
// Cloudflare's words for "no country": unknown, and Tor.
const NOT_A_COUNTRY = new Set(['T1', 'XX']);

let reader: Reader<CountryResponse> | null | undefined;

function openReader(): Reader<CountryResponse> | null {
  try {
    return new Reader<CountryResponse>(readFileSync(process.env.TOME_CMS_GEOIP_PATH || 'data/geoip/dbip-country-lite.mmdb'));
  } catch {
    // No file is a site without GeoIP, which is allowed: its readers' countries are unknown.
    return null;
  }
}

/** The country DB-IP Lite places an address in, or '' when it cannot say. */
export function lookupCountry(address: string): string {
  reader ??= openReader();
  try {
    const code = reader?.get(address)?.country?.iso_code ?? '';
    return CODE.test(code) ? code : '';
  } catch {
    // mmdb-lib throws on an address it cannot parse.
    return '';
  }
}

/**
 * The reader's country: the CDN's header when it names one, else the GeoIP file, else ''.
 * The address is looked up and let go; nothing here keeps it.
 */
export function readerCountry(headers: Headers, address: string, lookup: (address: string) => string = lookupCountry): string {
  const header = headers.get(process.env.TOME_CMS_COUNTRY_HEADER || 'cf-ipcountry')?.trim().toUpperCase() ?? '';
  return CODE.test(header) && !NOT_A_COUNTRY.has(header) ? header : lookup(address);
}
