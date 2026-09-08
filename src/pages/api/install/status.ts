import type { APIRoute } from 'astro';

import { db } from '../../../server/db/client';
import { getServerEnv } from '../../../server/env';
import { checkReadiness } from '../../../server/health';

const env = getServerEnv();
const publicUrl = new URL(env.TOME_CMS_PUBLIC_URL);
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

export const GET: APIRoute = async ({ request }) => {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const readiness = await checkReadiness(request.signal);
    const relyingParty = publicUrl.protocol === 'https:' || (env.NODE_ENV !== 'production' && loopback.has(publicUrl.hostname))
      ? 'ready'
      : 'unavailable';
    const settings = readiness.checks.database === 'ready' && readiness.checks.migrations === 'ready'
      ? await db.selectFrom('site_settings').select('admin_path').executeTakeFirst()
      : undefined;

    return Response.json({
      installed: Boolean(settings),
      ready: readiness.status === 'ready' && relyingParty === 'ready',
      checks: { ...readiness.checks, relyingParty },
      rp: { id: publicUrl.hostname, name: 'TomeCMS', origin: publicUrl.origin },
      ...(settings ? { redirectTo: settings.admin_path } : {}),
    }, { headers });
  } catch {
    console.error('Installer status check failed.');
    return Response.json({ error: 'Could not check system readiness. Try again.' }, { headers, status: 500 });
  }
};
