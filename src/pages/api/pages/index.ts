import type { APIRoute } from 'astro';
import { z } from 'zod';

import { editorDocumentSchema, hasMeaningfulContent, hasMeaningfulHtml, MAX_DOCUMENT_BYTES, sanitizedContentHtmlSchema } from '../../../lib/editor-content';
import { getSiteSettings } from '../../../lib/installation';
import { RESERVED_PAGE_SLUGS, resolvePageSlug } from '../../../lib/pages';
import { authenticate } from '../../../lib/supabase';
import { POST_LOCALES, POST_STATUSES, type PageInsert, type PageLocale, type PageStatus, type PageUpdate } from '../../../types/cms';

const pageSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    slug: z.union([
      z.string().trim().max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      z.literal(''),
    ]).optional(),
    contentJson: editorDocumentSchema,
    contentHtml: sanitizedContentHtmlSchema,
    metaTitle: z.union([z.string().trim().max(70), z.null()]).optional(),
    metaDescription: z.union([z.string().trim().max(320), z.null()]).optional(),
    status: z.enum(POST_STATUSES),
  })
  .strict()
  .superRefine(({ contentJson }, context) => {
    if (JSON.stringify(contentJson).length > MAX_DOCUMENT_BYTES) {
      context.addIssue({ code: 'custom', message: 'Content JSON is too large.', path: ['contentJson'] });
    }
  });

const publishablePageSchema = pageSchema.superRefine(({ contentJson, contentHtml, status }, context) => {
  if (status === 'published' && (!hasMeaningfulContent(contentJson) || !hasMeaningfulHtml(contentHtml))) {
    context.addIssue({ code: 'custom', message: 'Add content before publishing.', path: ['contentJson'] });
  }
});

const createSchema = publishablePageSchema
  .safeExtend({
    locale: z.enum(POST_LOCALES).optional(),
    sourcePageId: z.uuid().optional(),
  })
  .superRefine(({ locale, sourcePageId }, context) => {
    if (Boolean(locale) !== Boolean(sourcePageId)) {
      context.addIssue({ code: 'custom', message: 'A translated edition requires both locale and sourcePageId.' });
    }
  });

const updateSchema = publishablePageSchema.safeExtend({ id: z.uuid() });
const statusSchema = z.object({ id: z.uuid(), status: z.enum(POST_STATUSES) }).strict();

function pageValues(
  input: z.infer<typeof pageSchema>,
  slug: string,
  serverValues: { authorId?: string; locale?: PageLocale; translationGroupId?: string } = {},
): PageInsert | PageUpdate {
  return {
    ...(serverValues.authorId ? { author_id: serverValues.authorId } : {}),
    ...(serverValues.locale ? { locale: serverValues.locale } : {}),
    ...(serverValues.translationGroupId ? { translation_group_id: serverValues.translationGroupId } : {}),
    title: input.title,
    slug,
    content_json: input.contentJson,
    content_html: input.contentHtml,
    meta_title: input.metaTitle || null,
    meta_description: input.metaDescription || null,
    status: input.status as PageStatus,
  };
}

function parseError(error: z.ZodError) {
  return Response.json({ error: 'Invalid page payload.', issues: z.treeifyError(error) }, { status: 400 });
}

async function readJson(request: Request): Promise<{ body: unknown } | { response: Response }> {
  try {
    const body: unknown = await request.json();
    const pending = [{ value: body, depth: 0 }];
    while (pending.length) {
      const { value, depth } = pending.pop()!;
      // ponytail: cap request JSON at 256 levels before recursive validation/stringify; raise only for a proven editor need.
      if (depth > 256 || (typeof value === 'number' && !Number.isFinite(value))) {
        return { response: Response.json({ error: 'Invalid page payload.' }, { status: 400 }) };
      }
      if (typeof value === 'object' && value !== null) {
        for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
      }
    }
    return { body };
  } catch {
    return { response: Response.json({ error: 'The request body must be valid JSON.' }, { status: 400 }) };
  }
}

function databaseError(error: { code?: string; message: string }) {
  if (error.code === '23505' && error.message.includes('pages_translation_group_id_locale_key')) {
    return Response.json({ error: 'That language edition already exists.' }, { status: 409 });
  }
  if (error.code === '23505') {
    return Response.json({ error: 'A page with this slug already exists in this language.' }, { status: 409 });
  }
  console.error('Page database error:', error.message);
  return Response.json({ error: 'The page could not be saved.' }, { status: 500 });
}

function reservedSlugError(slug: string) {
  return RESERVED_PAGE_SLUGS.has(slug)
    ? Response.json({ error: 'That page slug is reserved.' }, { status: 400 })
    : null;
}

export const GET: APIRoute = async ({ cookies, request }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });

    const { data, error } = await auth.supabase
      .from('pages')
      .select('*')
      .eq('author_id', auth.user.id)
      .order('updated_at', { ascending: false });

    if (error) return databaseError(error);
    return Response.json({ pages: data });
  } catch (error) {
    console.error('Page list error:', error);
    return Response.json({ error: 'The page list could not be loaded.' }, { status: 500 });
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });

    const json = await readJson(request);
    if ('response' in json) return json.response;
    const parsed = createSchema.safeParse(json.body);
    if (!parsed.success) return parseError(parsed.error);
    const slug = resolvePageSlug(parsed.data.slug, parsed.data.title);
    const reserved = reservedSlugError(slug);
    if (reserved) return reserved;

    let values: PageInsert;
    if (parsed.data.sourcePageId) {
      const { data: source, error } = await auth.supabase
        .from('pages')
        .select('locale, translation_group_id')
        .eq('id', parsed.data.sourcePageId)
        .eq('author_id', auth.user.id)
        .maybeSingle();
      if (error) return databaseError(error);
      if (!source) return Response.json({ error: 'Page not found.' }, { status: 404 });
      if (source.locale === parsed.data.locale) {
        return Response.json({ error: 'That language edition already exists.' }, { status: 409 });
      }
      values = pageValues(parsed.data, slug, {
        authorId: auth.user.id,
        locale: parsed.data.locale,
        translationGroupId: source.translation_group_id,
      }) as PageInsert;
    } else {
      const settings = await getSiteSettings();
      if (!settings) {
        return Response.json({ error: 'The site settings could not be loaded.' }, { status: 500 });
      }
      values = pageValues(parsed.data, slug, {
        authorId: auth.user.id,
        locale: settings.default_locale,
      }) as PageInsert;
    }

    const { data, error } = await auth.supabase.from('pages').insert(values).select().single();
    if (error) return databaseError(error);
    return Response.json({ page: data }, { status: 201 });
  } catch (error) {
    console.error('Page creation error:', error);
    return Response.json({ error: 'The page could not be created.' }, { status: 500 });
  }
};

export const PUT: APIRoute = async ({ cookies, request }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });

    const json = await readJson(request);
    if ('response' in json) return json.response;
    const parsed = updateSchema.safeParse(json.body);
    if (!parsed.success) return parseError(parsed.error);
    const { id, ...input } = parsed.data;
    const slug = resolvePageSlug(input.slug, input.title);
    const reserved = reservedSlugError(slug);
    if (reserved) return reserved;

    const { data, error } = await auth.supabase
      .from('pages')
      .update(pageValues(input, slug) as PageUpdate)
      .eq('id', id)
      .eq('author_id', auth.user.id)
      .select()
      .maybeSingle();

    if (error) return databaseError(error);
    if (!data) return Response.json({ error: 'Page not found.' }, { status: 404 });
    return Response.json({ page: data });
  } catch (error) {
    console.error('Page update error:', error);
    return Response.json({ error: 'The page could not be updated.' }, { status: 500 });
  }
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });

    const json = await readJson(request);
    if ('response' in json) return json.response;
    const parsed = statusSchema.safeParse(json.body);
    if (!parsed.success) return parseError(parsed.error);

    const { id, status } = parsed.data;
    const { data: page, error: readError } = await auth.supabase
      .from('pages').select('*').eq('id', id).eq('author_id', auth.user.id).maybeSingle();
    if (readError) return databaseError(readError);
    if (!page) return Response.json({ error: 'Page not found.' }, { status: 404 });
    if (status === 'published' && (!hasMeaningfulContent(page.content_json) || !hasMeaningfulHtml(page.content_html))) {
      return Response.json({ error: 'Add content before publishing.' }, { status: 400 });
    }

    const { data, error } = await auth.supabase
      .from('pages').update({ status }).eq('id', id).eq('author_id', auth.user.id)
      .eq('updated_at', page.updated_at).select().maybeSingle();
    if (error) return databaseError(error);
    if (!data) return Response.json({ error: 'The page changed. Reload before trying again.' }, { status: 409 });
    return Response.json({ page: data });
  } catch (error) {
    console.error('Page status update error:', error);
    return Response.json({ error: 'The page could not be updated.' }, { status: 500 });
  }
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });

    const id = z.uuid().safeParse(url.searchParams.get('id'));
    if (!id.success) return Response.json({ error: 'A valid page id is required.' }, { status: 400 });

    const { data, error } = await auth.supabase
      .from('pages')
      .delete()
      .eq('id', id.data)
      .eq('author_id', auth.user.id)
      .select('id')
      .maybeSingle();

    if (error) return databaseError(error);
    if (!data) return Response.json({ error: 'Page not found.' }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Page deletion error:', error);
    return Response.json({ error: 'The page could not be deleted.' }, { status: 500 });
  }
};
