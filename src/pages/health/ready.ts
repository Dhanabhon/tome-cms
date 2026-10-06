import type { APIRoute } from 'astro';

import { checkReadiness } from '../../server/health';

/**
 * Once per process, the first time the database and storage are both there: an SVG logo or
 * icon stored before 1.16.4 gets its download header. The container's own health check asks
 * within seconds of a start, so this runs after every update without anything else to call it.
 */
// ponytail: one-time 1.16.4 backfill riding on readiness; drop it once no install predates 1.16.4.
let brandSvgBackfill: Promise<void> | undefined;
// ponytail: likewise for images kept before 1.20.0 and their smaller copies; once an install has walked
// its library, app_metadata says so and this reads nothing. Drop it once no install predates 1.20.0.
let mediaVariantsBackfill: Promise<void> | undefined;

export const GET: APIRoute = async () => {
  const result = await checkReadiness(AbortSignal.timeout(2_000));
  if (result.status === 'ready') {
    brandSvgBackfill ??= import('../../server/content/brand')
      .then(({ backfillBrandSvgDownloads }) => backfillBrandSvgDownloads())
      .then(() => undefined, () => console.error('Brand SVGs could not be given their download header.'));
    mediaVariantsBackfill ??= import('../../server/media/variants')
      .then(({ backfillVariants }) => backfillVariants())
      .then(() => undefined, () => console.error('Older images could not be given their smaller copies.'));
  }
  return Response.json(result, {
    status: result.status === 'ready' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
};
