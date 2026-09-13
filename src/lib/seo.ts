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
