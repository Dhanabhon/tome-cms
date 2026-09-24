import type { APIRoute } from 'astro';

import { getServerEnv } from '../../../../server/env';
import { receiveHit } from '../../../../server/stats/hits';

const CORS = {
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Max-Age': '86400',
};

/** 204, and in headless mode the CORS a headless site's browser needs to send at all. */
function answer(headless: boolean): Response {
  return new Response(null, { headers: { 'Cache-Control': 'no-store', ...(headless ? CORS : {}) }, status: 204 });
}

/**
 * One count from a reader's browser. The answer is 204 whatever happened, and why a hit was
 * dropped goes to the log: nothing a sender sees tells them which of their requests counted.
 */
export const POST: APIRoute = async ({ clientAddress, request }) => {
  const headless = getServerEnv().TOME_CMS_FRONTEND_MODE === 'headless';
  try {
    const dropped = await receiveHit(request, clientAddress, { headless });
    if (dropped) console.info(JSON.stringify({ event: 'stats_hit_dropped', reason: dropped }));
  } catch (error) {
    console.error('Stats hit failed:', error instanceof Error ? error.message : 'unknown error');
  }
  return answer(headless);
};

export const OPTIONS: APIRoute = () => answer(getServerEnv().TOME_CMS_FRONTEND_MODE === 'headless');
