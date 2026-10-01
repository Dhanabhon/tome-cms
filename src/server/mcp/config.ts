import { getSiteSettings } from '../content/site-settings';
import { getServerEnv } from '../env';
import { readEnabledPlugin } from '../plugins/store';
import { parseExtraRedirects } from './redirects';

export interface McpConfig {
  ownerId: string;
  adminPath: string;
  /** The MCP server's identifier: its URL. Tokens are issued for it and checked against it. */
  resource: string;
  /** This site's origin: the authorization server is the site. */
  issuer: string;
  allowWrite: boolean;
  extraRedirects: string[];
}

/** MCP as the owner has it now, or null while it is switched off -- and then every route is a 404. */
export async function mcpConfig(): Promise<McpConfig | null> {
  const site = await getSiteSettings();
  if (!site) return null;
  const settings = await readEnabledPlugin(site.owner_id, 'mcp');
  if (!settings) return null;
  const issuer = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;
  return {
    ownerId: site.owner_id,
    adminPath: site.admin_path,
    resource: `${issuer}/mcp`,
    issuer,
    allowWrite: settings.allowWrite !== 'off',
    extraRedirects: parseExtraRedirects(settings.extraRedirects ?? ''),
  };
}

export function notFound(): Response {
  return new Response('Not found.', { status: 404, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
}
