import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

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

// Everything that is not a public unicast address, in every spelling: the list compares the bytes,
// not the text, so a compressed, mapped or translated form of a private address is caught too.
// Node checks an IPv4 address against IPv6 subnets as if it were mapped, so ::ffff:0:0/96 would block
// every IPv4 address; hence one list per family.
const NON_PUBLIC_V4 = new BlockList();
const NON_PUBLIC_V6 = new BlockList();
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const) {
  NON_PUBLIC_V4.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['::', 96], ['::ffff:0:0:0', 96], ['64:ff9b::', 96], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]] as const) {
  NON_PUBLIC_V6.addSubnet(net, prefix, 'ipv6');
}

export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !NON_PUBLIC_V4.check(address, 'ipv4');
  return version === 6 && !NON_PUBLIC_V6.check(address, 'ipv6');
}

/** The body, read chunk by chunk so a host that streams without end is cut off at the cap. */
async function readCapped(response: Response): Promise<string> {
  const tooLarge = () => new Error('A client id document is too large.');
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw tooLarge();
  const reader = response.body?.getReader();
  if (!reader) return '';
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    parts.push(value);
  }
  return Buffer.concat(parts).toString('utf8');
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
  const text = await readCapped(response);
  const document = JSON.parse(text) as { client_id?: unknown; client_name?: unknown; redirect_uris?: unknown };
  if (document.client_id !== url) throw new Error('A client id document must name itself as its client_id.');
  const redirectUris = Array.isArray(document.redirect_uris) ? document.redirect_uris.filter((uri): uri is string => typeof uri === 'string') : [];
  const name = typeof document.client_name === 'string' && document.client_name.trim() ? document.client_name.trim().slice(0, 200) : target.hostname;
  return { name, redirectUris };
}
