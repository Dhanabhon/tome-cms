/**
 * What a site kept out of search results says, in a page's robots meta and in X-Robots-Tag.
 * nofollow too: a hidden site should not lend its links to what they point at either.
 */
export const HIDDEN_FROM_SEARCH = 'noindex, nofollow';

/**
 * robots.txt. A hidden site still allows everything: a crawler refused a page never reads the
 * noindex on it, and a page it has already indexed then stays listed as a bare address. It only
 * stops offering the sitemap. A headless site has no pages of its own to crawl at all.
 */
export function robotsTxt({ headless, hidden, sitemap }: { headless: boolean; hidden: boolean; sitemap: string }): string {
  if (headless) return 'User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nDisallow: /\n';
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    'User-agent: OAI-SearchBot',
    'Allow: /',
    'Disallow: /api/',
    '',
    ...(hidden ? [] : [`Sitemap: ${sitemap}`, '']),
  ].join('\n');
}
