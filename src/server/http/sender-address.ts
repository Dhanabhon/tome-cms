import { BlockList, isIP } from 'node:net';

// Where the owner's reverse proxy connects from. The app is published on 127.0.0.1 only, so on
// a bare install that is loopback, and in the managed install it is Docker's bridge gateway.
const PROXY_SIDE = new BlockList();
PROXY_SIDE.addSubnet('127.0.0.0', 8, 'ipv4');
PROXY_SIDE.addSubnet('10.0.0.0', 8, 'ipv4');
PROXY_SIDE.addSubnet('172.16.0.0', 12, 'ipv4');
PROXY_SIDE.addSubnet('192.168.0.0', 16, 'ipv4');
PROXY_SIDE.addAddress('::1', 'ipv6');
PROXY_SIDE.addSubnet('fc00::', 7, 'ipv6');

function fromProxySide(address: string): boolean {
  const plain = address.startsWith('::ffff:') ? address.slice(7) : address;
  const family = isIP(plain);
  return family !== 0 && PROXY_SIDE.check(plain, family === 4 ? 'ipv4' : 'ipv6');
}

declare const sender: unique symbol;
/** An address `senderAddress` worked out. The rate limit takes nothing else, so a route cannot count the proxy by mistake. */
export type SenderAddress = string & { readonly [sender]: true };

/**
 * Who sent a request, as far as the app can know.
 *
 * Astro's `clientAddress` is the socket's peer, and behind the owner's proxy that is the proxy
 * for every visitor: a limit keyed on it is one count shared by the whole world. The proxy adds
 * the address it saw as the last entry of X-Forwarded-For, and anything earlier in the header is
 * whatever the sender wrote. From anywhere but the proxy's side the header is the sender's own
 * words and is ignored.
 *
 * "The proxy's side" is every address a proxy can connect from, which includes the other
 * containers on the compose network. The header is the proxy's word only if the proxy always
 * writes it: one that sets or appends the address it saw is right, and one that passes a
 * sender's own header through untouched lets that sender choose the address that is counted.
 *
 * This is safe because `security.allowedDomains` is unset in astro.config.mjs, so Astro hands
 * `clientAddress` here as the raw socket address. If `allowedDomains` is ever set, Astro takes
 * `clientAddress` from the first X-Forwarded-For entry instead -- which the sender controls --
 * and this function would then trust an address the sender made up. Setting it would not fix
 * the shared count anyway: it is fixed when the image is built, and one official image serves
 * every domain.
 */
export function senderAddress(request: Request, clientAddress: string): SenderAddress {
  if (!fromProxySide(clientAddress)) return clientAddress as SenderAddress;
  const forwarded = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ?? '';
  return (isIP(forwarded) ? forwarded : clientAddress) as SenderAddress;
}

/** An IPv6 address's eight hextets, `::` expanded and each one's leading zeros dropped. */
function expandIPv6(address: string): string[] {
  const [head, tail] = address.split('::');
  if (tail === undefined) return address.split(':').map((hextet) => Number.parseInt(hextet, 16).toString(16));
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const middle = Array<string>(8 - headParts.length - tailParts.length).fill('0');
  return [...headParts, ...middle, ...tailParts].map((hextet) => Number.parseInt(hextet || '0', 16).toString(16));
}

const IPV4_MAPPED = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

/**
 * The key the per-address limits count by: an IPv4 address as itself, an IPv4-mapped IPv6
 * address (`::ffff:a.b.c.d`) as that IPv4 address, and any other IPv6 address reduced to its
 * first four hextets -- its /64 -- normalised so equivalent spellings give the same key.
 *
 * ponytail: everyone behind one /64 shares one limit. IPv6 routes most residential connections
 * a /64 of their own, so counting each address in it apart would let one reader multiply the
 * limit by reconnecting with a new address from the same block.
 */
export function rateLimitKey(address: string): string {
  const family = isIP(address);
  if (family !== 6) return address;
  const mapped = IPV4_MAPPED.exec(address);
  if (mapped) return mapped[1];
  return expandIPv6(address).slice(0, 4).join(':');
}
