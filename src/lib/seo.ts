export function getPublicSiteUrl(request: Request, configuredSite?: URL) {
  if (configuredSite) return new URL('/', configuredSite);

  const configuredDomain = process.env.TOME_CMS_DOMAIN?.trim();
  if (configuredDomain) return new URL(`https://${configuredDomain}`);

  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProtocol === 'http' || forwardedProtocol === 'https'
    ? `${forwardedProtocol}:`
    : requestUrl.protocol;
  return new URL(`${protocol}//${forwardedHost || requestUrl.host}`);
}
