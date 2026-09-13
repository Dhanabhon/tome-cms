import { open } from 'node:fs/promises';

import { parseUpdaterStatus, UPDATER_RESPONSE_LIMIT, type UpdaterStatus } from './updater-client.js';
import type { UpdateMode } from './current.js';

export async function readMaintenanceStatus(statusPath = '/run/tome-cms/status.json'): Promise<UpdaterStatus> {
  try {
    const file = await open(statusPath, 'r');
    try {
      if (!(await file.stat()).isFile()) return { managed: false };
      const bytes = Buffer.alloc(UPDATER_RESPONSE_LIMIT + 1);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead > UPDATER_RESPONSE_LIMIT) return { managed: false };
      return parseUpdaterStatus(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')));
    } finally { await file.close(); }
  } catch { return { managed: false }; }
}

export async function isUpdateWriteBlocked(statusPath?: string): Promise<boolean> {
  const status = await readMaintenanceStatus(statusPath);
  return status.managed && status.job !== null
    && ['quiescing', 'backing_up', 'migrating', 'restarting', 'health_check'].includes(status.job.phase);
}

export async function updateMaintenanceResponse(request: Request, mode: UpdateMode, statusPath?: string): Promise<Response | null> {
  const pathname = new URL(request.url).pathname.replace(/\/$/, '');
  if (mode !== 'managed' || ['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    || !(pathname === '/api/admin' || pathname.startsWith('/api/admin/'))
    || pathname === '/api/admin/system/updates' || !await isUpdateWriteBlocked(statusPath)) return null;
  return Response.json({ error: 'TomeCMS is installing an update. Try again shortly.' }, {
    status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '10' },
  });
}
