import type { APIRoute } from 'astro';
import { z } from 'zod';

import { getSiteSettingsForOwner, invalidateSiteSettingsCache } from '../../lib/installation';
import { authenticate, createServiceRoleSupabaseClient } from '../../lib/supabase';

const httpUrl = z.url({ protocol: /^https?$/, error: 'Use an HTTP or HTTPS URL.' });
const profileSchema = z.object({
  authorAvatarMediaId: z.uuid().nullable(),
  authorBioEn: z.string().trim().max(1000),
  authorBioTh: z.string().trim().max(1000),
  authorLinks: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    url: httpUrl,
  }).strict()).max(5),
  authorName: z.string().trim().max(120),
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
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: 'Invalid profile payload.', issues: z.treeifyError(parsed.error) }, { status: 400 });
    }
    const input = parsed.data;

    if (input.authorAvatarMediaId) {
      const { data: avatar, error } = await auth.supabase
        .from('media_items')
        .select('id')
        .eq('id', input.authorAvatarMediaId)
        .eq('owner_id', auth.user.id)
        .maybeSingle();
      if (error) throw error;
      if (!avatar) return Response.json({ error: 'Media not found.' }, { status: 404 });
    }

    const { data: settings, error } = await createServiceRoleSupabaseClient()
      .from('site_settings')
      .update({
        author_name: input.authorName,
        author_avatar_media_id: input.authorAvatarMediaId,
        author_bio_th: input.authorBioTh,
        author_bio_en: input.authorBioEn,
        author_links: input.authorLinks,
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
    console.error('Profile update error:', error);
    return Response.json({ error: 'The profile could not be saved.' }, { status: 500 });
  }
};
