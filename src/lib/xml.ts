const XML_ESCAPES = {
  '"': '&quot;',
  '&': '&amp;',
  "'": '&apos;',
  '<': '&lt;',
  '>': '&gt;',
} as const;

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => XML_ESCAPES[character as keyof typeof XML_ESCAPES]);
}

export interface SitemapEntry {
  lastModified?: string;
  location: string;
}

export function sitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries
    .map(
      ({ lastModified, location }) =>
        `  <url>\n    <loc>${escapeXml(location)}</loc>${lastModified ? `\n    <lastmod>${escapeXml(lastModified)}</lastmod>` : ''}\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
