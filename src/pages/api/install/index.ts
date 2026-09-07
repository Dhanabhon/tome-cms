import { timingSafeEqual } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { getInstallationReadiness, isInstalled, markInstalled } from '../../../lib/installation';
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from '../../../lib/supabase';
import type { SiteSettingsInsert } from '../../../types/cms';

const installSchema = z
  .object({
    defaultLocale: z.enum(['th', 'en']),
    email: z.email().max(254),
    installationToken: z.string().min(1).max(512),
    password: z.string().min(12).max(128),
    siteDescription: z.string().trim().max(160),
    siteName: z.string().trim().min(1).max(120),
    timezone: z.enum(['Asia/Bangkok', 'UTC']),
  })
  .strict();

function tokenMatches(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export const POST: APIRoute = async ({ cookies, request }) => {
  let ownerId: string | undefined;
  let settingsCreated = false;

  try {
    if (await isInstalled()) return Response.json({ error: 'TomeCMS ถูกติดตั้งแล้ว' }, { status: 409 });

    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== new URL(request.url).host) {
      return Response.json({ error: 'คำขอติดตั้งมาจากเว็บไซต์อื่น ระบบจึงปฏิเสธคำขอนี้' }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'ข้อมูลติดตั้งต้องเป็น JSON ที่ถูกต้อง' }, { status: 400 });
    }
    const parsed = installSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: 'ข้อมูลติดตั้งไม่ครบหรือมีรูปแบบไม่ถูกต้อง', issues: z.treeifyError(parsed.error) },
        { status: 400 },
      );
    }

    const expectedToken = process.env.TOME_CMS_INSTALL_TOKEN || import.meta.env.TOME_CMS_INSTALL_TOKEN;
    if (!expectedToken || !tokenMatches(parsed.data.installationToken, expectedToken)) {
      return Response.json({ error: 'Installation token ไม่ถูกต้อง กรุณาคัดลอกจาก VPS อีกครั้ง' }, { status: 401 });
    }

    const readiness = await getInstallationReadiness(request);
    if (readiness.installed) return Response.json({ error: 'TomeCMS ถูกติดตั้งแล้ว' }, { status: 409 });

    const missing = Object.entries(readiness)
      .filter(([key, ready]) => key !== 'installed' && !ready)
      .map(([key]) => key);
    if (missing.length) {
      return Response.json(
        { error: 'ระบบยังไม่พร้อมสำหรับการติดตั้ง', missing },
        { status: 503 },
      );
    }

    const admin = createServiceRoleSupabaseClient();
    const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
      email: parsed.data.email,
      email_confirm: true,
      password: parsed.data.password,
      user_metadata: { role: 'owner' },
    });
    if (createUserError) {
      const status = createUserError.status === 422 ? 409 : 500;
      return Response.json(
        { error: status === 409 ? 'อีเมลนี้มีบัญชีอยู่แล้ว กรุณาใช้อีเมลอื่น' : 'สร้างบัญชีเจ้าของไม่สำเร็จ' },
        { status },
      );
    }
    ownerId = createdUser.user.id;

    const settings: SiteSettingsInsert = {
      default_locale: parsed.data.defaultLocale,
      owner_id: ownerId,
      site_description: parsed.data.siteDescription,
      site_name: parsed.data.siteName,
      timezone: parsed.data.timezone,
    };
    const { error: settingsError } = await admin.from('site_settings').insert(settings);
    if (settingsError) throw settingsError;
    settingsCreated = true;

    const { error: signInError } = await createServerSupabaseClient(cookies, request).auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (signInError) throw signInError;

    markInstalled(true);
    return Response.json({ redirectTo: '/admin' }, { status: 201 });
  } catch (error) {
    console.error('TomeCMS installation failed:', error);

    if (ownerId) {
      try {
        const admin = createServiceRoleSupabaseClient();
        if (settingsCreated) await admin.from('site_settings').delete().eq('id', true);
        await admin.auth.admin.deleteUser(ownerId);
      } catch (rollbackError) {
        console.error('Installer rollback failed:', rollbackError);
      }
    }

    return Response.json({ error: 'ติดตั้ง TomeCMS ไม่สำเร็จ ระบบย้อนการเปลี่ยนแปลงแล้ว กรุณาลองอีกครั้ง' }, { status: 500 });
  }
};
