import type { APIRoute } from 'astro';

import { checkReadiness } from '../../server/health';

/**
 * Once per process, the first time the database and storage are both there: an SVG logo or
 * icon stored before 1.16.4 gets its download header. The container's own health check asks
 * within seconds of a start, so this runs after every update without anything else to call it.
 */
// ponytail: one-time 1.16.4 backfill riding on readiness; drop it once no install predates 1.16.4.
let brandSvgBackfill: Promise<void> | undefined;
// Likewise once per process: images with no smaller copies yet get them, the whole library the first
// time and after that only what was added since the last walk finished.
let mediaVariantsBackfill: Promise<void> | undefined;

export const GET: APIRoute = async () => {
  const result = await checkReadiness(AbortSignal.timeout(2_000));
  if (result.status === 'ready') {
    brandSvgBackfill ??= import('../../server/content/brand')
      .then(({ backfillBrandSvgDownloads }) => backfillBrandSvgDownloads())
      .then(() => undefined, () => console.error('Brand SVGs could not be given their download header.'));
    mediaVariantsBackfill ??= import('../../server/media/variants')
      .then(({ backfillVariants }) => backfillVariants())
      .then(() => undefined, () => console.error('Images could not be given their smaller copies.'));
  }
  return Response.json(result, {
    status: result.status === 'ready' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
};
