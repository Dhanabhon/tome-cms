import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * A Client ID Metadata Document: the client's id is an https URL, and the document there names it
 * and its redirect URIs. This is the only request the MCP feature sends out, so it is held to a
 * public https address, no redirects, five seconds and 64 KB.
 *
 * ponytail: the address is checked when resolved and fetch resolves again, so a DNS answer that
 * changes in between (rebinding) is not caught; pin the connection to the checked address if the
 * CIMD fetch ever reaches anything that matters.
 */
const TIMEOUT_MS = 5_000;
const MAX_BYTES = 64 * 1024;

type Lookup = (host: string) => Promise<{ address: string; family: number }[]>;

function v4Private(address: string): boolean {
  const [a = 0, b = 0] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !v4Private(address);
  if (version !== 6) return false;
  const lower = address.toLowerCase();
  // An IPv4-mapped address is the IPv4 address it wraps, written dotted or as two hex groups.
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return !v4Private(dotted[1]!);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const high = parseInt(hex[1]!, 16);
    const low = parseInt(hex[2]!, 16);
    return !v4Private(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return !(lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || /^ff/.test(lower));
}

export async function fetchClientMetadata(
  url: string,
  deps: { lookup?: Lookup; fetch?: typeof fetch } = {},
): Promise<{ name: string; redirectUris: string[] }> {
  const target = new URL(url);
  if (target.protocol !== 'https:') throw new Error('A client id document must be https.');
  const lookup: Lookup = deps.lookup ?? ((host) => dnsLookup(host, { all: true }));
  const addresses = await lookup(target.hostname);
  if (!addresses.length || !addresses.every(({ address }) => isPublicAddress(address))) {
    throw new Error('A client id document must be on a public address.');
  }
  const response = await (deps.fetch ?? fetch)(target, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (response.status !== 200) throw new Error(`A client id document answered with status ${response.status}, or a redirect.`);
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('A client id document is too large.');
  const document = JSON.parse(text) as { client_id?: unknown; client_name?: unknown; redirect_uris?: unknown };
  if (document.client_id !== url) throw new Error('A client id document must name itself as its client_id.');
  const redirectUris = Array.isArray(document.redirect_uris) ? document.redirect_uris.filter((uri): uri is string => typeof uri === 'string') : [];
  const name = typeof document.client_name === 'string' && document.client_name.trim() ? document.client_name.trim().slice(0, 200) : target.hostname;
  return { name, redirectUris };
}
