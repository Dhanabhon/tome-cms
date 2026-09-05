import type { APIRoute } from 'astro';
import { z } from 'zod';

import { getSiteSettingsForOwner, invalidateSiteSettingsCache } from '../../lib/installation';
import { authenticate, createServiceRoleSupabaseClient } from '../../lib/supabase';
import { POST_LOCALES } from '../../types/cms';

const settingsSchema = z.object({
  defaultLocale: z.enum(POST_LOCALES),
  siteDescription: z.string().trim().max(160),
  siteName: z.string().trim().min(1).max(120),
  timezone: z.enum(['Asia/Bangkok', 'UTC']),
}).strict();

export const PUT: APIRoute = async ({ cookies, request }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });

    const current = await getSiteSettingsForOwner(auth.user.id);
    if (!current) return Response.json({ error: 'Site settings not found.' }, { status: 404 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'The request body must be valid JSON.' }, { status: 400 });
    }
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: 'Invalid settings payload.', issues: z.treeifyError(parsed.error) }, { status: 400 });
    }
    const input = parsed.data;

    const { data: settings, error } = await createServiceRoleSupabaseClient()
      .from('site_settings')
      .update({
        default_locale: input.defaultLocale,
        site_description: input.siteDescription,
        site_name: input.siteName,
        timezone: input.timezone,
        updated_at: new Date().toISOString(),
      })
      .eq('id', true)
      .eq('owner_id', auth.user.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!settings) return Response.json({ error: 'Site settings not found.' }, { status: 404 });

    invalidateSiteSettingsCache();
    return Response.json({ settings });
  } catch (error) {
    console.error('Settings update error:', error);
    return Response.json({ error: 'The settings could not be saved.' }, { status: 500 });
  }
};
