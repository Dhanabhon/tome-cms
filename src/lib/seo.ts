import type { SiteBrand } from './site-brand';

/**
 * Who wrote an article, for a search engine. The profiles the owner lists in Settings, which only
 * ever hold web addresses, say this is the same person found there.
 */
export function personSchema(name: string, sameAs: readonly string[]) {
  return { '@type': 'Person', name, ...(sameAs.length ? { sameAs } : {}) };
}

/**
 * The site as the publisher of what it shows. Its logo is the square site icon, which is the size
 * a search engine asks for, or the header logo when there is no icon; a site with neither has none.
 */
export function organizationSchema(name: string, siteUrl: URL, brand: Pick<SiteBrand, 'icon' | 'logo'>) {
  const logo = brand.icon?.png180 ?? brand.logo?.url;
  return {
    '@type': 'Organization',
    ...(logo ? { logo: new URL(logo, siteUrl).toString() } : {}),
    name,
    url: siteUrl.toString(),
  };
}

export function getPublicSiteUrl(request: Request, configuredSite?: URL) {
  if (configuredSite) return new URL('/', configuredSite);

  const configuredUrl = process.env.TOME_CMS_PUBLIC_URL?.trim();
  if (configuredUrl) return new URL('/', configuredUrl);

  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProtocol === 'http' || forwardedProtocol === 'https'
    ? `${forwardedProtocol}:`
    : requestUrl.protocol;
  return new URL(`${protocol}//${forwardedHost || requestUrl.host}`);
}

/**
 * What the browser tab and a search result call a page. A meta title is the owner's own line for
 * search, written to fit the space a result has, so it is used as written; any other title is
 * followed by the site's name.
 */
export function documentTitle({ metaTitle, siteName, title }: { metaTitle?: string | null; siteName: string; title: string }) {
  if (metaTitle?.trim()) return metaTitle.trim();
  return title === siteName ? title : `${title} | ${siteName}`;
}
