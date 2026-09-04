import type { APIRoute } from 'astro';
import sanitizeHtml from 'sanitize-html';
import slugify from 'slugify';
import { z } from 'zod';

import { authenticate } from '../../../lib/supabase';
import type { EditorDocument, PostInsert, PostStatus, PostUpdate } from '../../../types/cms';

const MAX_DOCUMENT_BYTES = 1_000_000;

function isEditorDocument(value: unknown): value is EditorDocument {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'doc';
}

const nullableText = (max: number) => z.union([z.string().trim().max(max), z.null()]).optional();
const nullableUrl = z.union([z.url(), z.literal(''), z.null()]).optional();
const editorDocumentSchema = z.json().refine(isEditorDocument, 'Content must be a Tiptap document.');

const postSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    slug: z.union([z.string().trim().max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), z.literal('')]).optional(),
    coverImage: nullableUrl,
    contentJson: editorDocumentSchema,
    contentHtml: z.string().max(MAX_DOCUMENT_BYTES),
    metaTitle: nullableText(70),
    metaDescription: nullableText(320),
    status: z.enum(['draft', 'published']),
  })
  .strict()
  .superRefine(({ contentJson }, context) => {
    if (JSON.stringify(contentJson).length > MAX_DOCUMENT_BYTES) {
      context.addIssue({ code: 'custom', message: 'Content JSON is too large.', path: ['contentJson'] });
    }
  });

const updateSchema = postSchema.safeExtend({ id: z.uuid() });

const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'h1',
    'h2',
    'h3',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'strong',
    'em',
    's',
    'a',
    'img',
    'hr',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    code: ['class'],
    img: ['src', 'alt', 'title', 'width', 'height'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
    img: sanitizeHtml.simpleTransform('img', { decoding: 'async', loading: 'lazy' }, true),
  },
};

function postValues(input: z.infer<typeof postSchema>, authorId?: string): PostInsert | PostUpdate {
  const generatedSlug = slugify(input.slug || input.title, { lower: true, strict: true, trim: true });
  const slug = generatedSlug || `post-${crypto.randomUUID().slice(0, 8)}`;

  return {
    ...(authorId ? { author_id: authorId } : {}),
    title: input.title,
    slug,
    cover_image: input.coverImage || null,
    content_json: input.contentJson,
    content_html: sanitizeHtml(input.contentHtml, sanitizeOptions),
    meta_title: input.metaTitle || null,
    meta_description: input.metaDescription || null,
    status: input.status as PostStatus,
  };
}

function parseError(error: z.ZodError) {
  return Response.json({ error: 'Invalid post payload.', issues: z.treeifyError(error) }, { status: 400 });
}

async function readJson(request: Request): Promise<{ body: unknown } | { response: Response }> {
  try {
    return { body: await request.json() };
  } catch {
    return { response: Response.json({ error: 'The request body must be valid JSON.' }, { status: 400 }) };
  }
}

function databaseError(error: { code?: string; message: string }) {
  if (error.code === '23505') {
    return Response.json({ error: 'A post with this slug already exists.' }, { status: 409 });
  }

  console.error('Post database error:', error.message);
  return Response.json({ error: 'The post could not be saved.' }, { status: 500 });
}

export const GET: APIRoute = async ({ cookies, request }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });

    const { data, error } = await auth.supabase
      .from('posts')
      .select('*')
      .eq('author_id', auth.user.id)
      .order('updated_at', { ascending: false });

    if (error) return databaseError(error);
    return Response.json({ posts: data });
  } catch (error) {
    console.error('Post list error:', error);
    return Response.json({ error: 'The post list could not be loaded.' }, { status: 500 });
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });

    const json = await readJson(request);
    if ('response' in json) return json.response;
    const parsed = postSchema.safeParse(json.body);
    if (!parsed.success) return parseError(parsed.error);

    const { data, error } = await auth.supabase
      .from('posts')
      .insert(postValues(parsed.data, auth.user.id) as PostInsert)
      .select()
      .single();

    if (error) return databaseError(error);
    return Response.json({ post: data }, { status: 201 });
  } catch (error) {
    console.error('Post creation error:', error);
    return Response.json({ error: 'The post could not be created.' }, { status: 500 });
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
    const { data, error } = await auth.supabase
      .from('posts')
      .update(postValues(input) as PostUpdate)
      .eq('id', id)
      .eq('author_id', auth.user.id)
      .select()
      .maybeSingle();

    if (error) return databaseError(error);
    if (!data) return Response.json({ error: 'Post not found.' }, { status: 404 });
    return Response.json({ post: data });
  } catch (error) {
    console.error('Post update error:', error);
    return Response.json({ error: 'The post could not be updated.' }, { status: 500 });
  }
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });

    const id = z.uuid().safeParse(url.searchParams.get('id'));
    if (!id.success) return Response.json({ error: 'A valid post id is required.' }, { status: 400 });

    const { data, error } = await auth.supabase
      .from('posts')
      .delete()
      .eq('id', id.data)
      .eq('author_id', auth.user.id)
      .select('id')
      .maybeSingle();

    if (error) return databaseError(error);
    if (!data) return Response.json({ error: 'Post not found.' }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Post deletion error:', error);
    return Response.json({ error: 'The post could not be deleted.' }, { status: 500 });
  }
};
