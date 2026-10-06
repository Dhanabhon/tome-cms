import type { PostLocale } from '../types/cms';
import type { BrandImage, SiteBrand } from './site-brand';

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

export interface BreadcrumbStep { name: string; url: string }

/**
 * The way from a page back to the home page of its language, for a search result to show above
 * the title. A category's page is one step from home; a post passes through its category when it
 * has one with a page; a page has none to pass through. The home page is where the trail starts,
 * so it carries none, nor does a page that is missing; and a page asking not to be listed carries
 * no structured data at all.
 */
export function breadcrumbList({ category, homeName, homeUrl, name, robots, type, url }: {
  /** The category page on the way: the page itself on a category's page, the post's on a post. */
  category?: BreadcrumbStep;
  homeName: string;
  homeUrl: string;
  name: string;
  robots: string;
  type: 'article' | 'page' | 'website';
  url: string;
}): Record<string, unknown> | undefined {
  if (robots.includes('noindex')) return undefined;
  const trail: BreadcrumbStep[] = type === 'website'
    ? category ? [category] : []
    : [...(type === 'article' && category ? [category] : []), { name, url }];
  if (!trail.length) return undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', item: homeUrl, name: homeName, position: 1 },
      ...trail.map((step, index) => ({ '@type': 'ListItem', item: step.url, name: step.name, position: index + 2 })),
    ],
  };
}

/**
 * What a category's page says of itself to a search result: the owner's description in the page's
 * language, or the other language's, or a line made from the category's and the site's names.
 */
export function categoryDescription({ category, locale, siteName }: {
  category: { description_en: string; description_th: string; name: string };
  locale: PostLocale;
  siteName: string;
}): string {
  const own = (locale === 'th' ? category.description_th : category.description_en).trim();
  const other = (locale === 'th' ? category.description_en : category.description_th).trim();
  if (own || other) return own || other;
  const line = locale === 'th' ? 'บทความในหมวด {category} จาก {site}' : 'Posts in {category} from {site}.';
  return line.replace('{category}', () => category.name).replace('{site}', () => siteName);
}

export interface OpenGraphImage { alt: string; height?: number; url: string; width?: number }

/**
 * The picture a shared link shows: the page's own cover, or the site's share image when it has
 * none, or nothing. The share image says its size, which lets LINE and Facebook draw the card on
 * the first share instead of after fetching the picture; a cover's is not known here, so it is
 * not claimed. A share image is about the site, not the page, so it is named for the site.
 */
export function openGraphImage({ cover, coverAlt, share, siteName, siteUrl }: {
  cover?: string | null;
  coverAlt: string;
  share: BrandImage | null;
  siteName: string;
  siteUrl: URL;
}): OpenGraphImage | null {
  if (cover) return { alt: coverAlt, url: new URL(cover, siteUrl).toString() };
  if (share) return { alt: siteName, height: share.height, url: new URL(share.url, siteUrl).toString(), width: share.width };
  return null;
}

/** What a site says of itself when the owner has not said anything in either language. */
export const DEFAULT_SITE_DESCRIPTION = 'A quiet place for thoughtful notes on design, software, and the work between.';

interface SiteDescriptions { site_description_en: string; site_description_th: string }

/**
 * The site's description in a language: its own, or the other language's when it has none --
 * a line in the other language says more than a stock one -- or, with neither, the caller's
 * last resort.
 */
export function siteDescriptionFor(
  settings: SiteDescriptions | null | undefined,
  locale: PostLocale,
  fallback = DEFAULT_SITE_DESCRIPTION,
): string {
  const own = (locale === 'th' ? settings?.site_description_th : settings?.site_description_en)?.trim();
  const other = (locale === 'th' ? settings?.site_description_en : settings?.site_description_th)?.trim();
  return own || other || fallback;
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
