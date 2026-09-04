import type { APIRoute } from 'astro';

import { getInstallationReadiness } from '../../../lib/installation';

export const GET: APIRoute = async ({ request }) => {
  try {
    return Response.json(await getInstallationReadiness(request), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Installer status endpoint failed:', error);
    return Response.json(
      { error: 'ตรวจสอบความพร้อมของระบบไม่ได้ กรุณาลองอีกครั้ง' },
      { headers: { 'Cache-Control': 'no-store' }, status: 500 },
    );
  }
};
