import { readFileSync } from 'node:fs';

import { Reader, type CountryResponse } from 'mmdb-lib';

const CODE = /^[A-Z]{2}$/;
// Cloudflare's words for "no country": unknown, and Tor.
const NOT_A_COUNTRY = new Set(['T1', 'XX']);

let reader: Reader<CountryResponse> | null | undefined;
let openAttempts = 0;

function openReader(): Reader<CountryResponse> | null {
  openAttempts += 1;
  try {
    return new Reader<CountryResponse>(readFileSync(process.env.TOME_CMS_GEOIP_PATH || 'data/geoip/dbip-country-lite.mmdb'));
  } catch {
    // No file is a site without GeoIP, which is allowed: its readers' countries are unknown.
    return null;
  }
}

/** Test-only seam: forgets the cached reader, so a test can see it opened again once. */
export function resetGeoipReaderForTests(): void {
  reader = undefined;
}

/** Test-only seam: how many times the GeoIP file has actually been opened. */
export function geoipOpenAttemptsForTests(): number {
  return openAttempts;
}

/** The country DB-IP Lite places an address in, or '' when it cannot say. */
export function lookupCountry(address: string): string {
  // Opened once, not `??=`: that retries a missing or corrupt file's filesystem read on every
  // hit, since it stays nullish. Once tried, `reader` is `null` and stays that way.
  if (reader === undefined) reader = openReader();
  try {
    const code = reader?.get(address)?.country?.iso_code ?? '';
    return CODE.test(code) ? code : '';
  } catch {
    // mmdb-lib throws on an address it cannot parse.
    return '';
  }
}

const HEADER_NAME = /^[A-Za-z0-9-]+$/;

/**
 * The reader's country: the CDN's header when it names one, else the GeoIP file, else ''.
 * The address is looked up and let go; nothing here keeps it.
 */
export function readerCountry(headers: Headers, address: string, lookup: (address: string) => string = lookupCountry): string {
  const configured = process.env.TOME_CMS_COUNTRY_HEADER;
  // Headers.get throws on a name that is not a valid header token; an owner's typo must not
  // fail every hit.
  const name = configured && HEADER_NAME.test(configured) ? configured : 'cf-ipcountry';
  const header = headers.get(name)?.trim().toUpperCase() ?? '';
  return CODE.test(header) && !NOT_A_COUNTRY.has(header) ? header : lookup(address);
}
