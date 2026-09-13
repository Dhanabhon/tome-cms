import { z } from 'zod';

import { editorDocumentSchema } from '../../lib/editor-content';
import {
  problemDetailsSchema,
  publicAuthorSchema,
  publicCategorySchema,
  publicListLinksSchema,
  publicListMetaSchema,
  publicMediaSchema,
  publicNavigationSchema,
  publicPageSchema,
  publicPostSchema,
  publicSeoSchema,
  publicSiteSchema,
  publicTranslationSchema,
} from './public-schemas';

const schemaRef = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const parameterRef = (name: string) => ({ $ref: `#/components/parameters/${name}` });
const responseRef = (name: string) => ({ $ref: `#/components/responses/${name}` });

function componentSchema(schema: z.ZodType) {
  const generated = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    unrepresentable: ({ path }) => path.includes('contentJson') ? 'any' : 'throw',
    override: ({ jsonSchema, zodSchema }) => {
      if (!Object.is(zodSchema, editorDocumentSchema)) return;
      for (const key of Object.keys(jsonSchema)) Reflect.deleteProperty(jsonSchema, key);
      Object.assign(jsonSchema, schemaRef('EditorDocument'));
    },
  });
  Reflect.deleteProperty(generated, '$schema');
  return generated;
}

const jsonResponse = (description: string, schema: string) => ({
  description,
  content: { 'application/json': { schema: schemaRef(schema) } },
});

const optionsOperation = (operationId: string) => ({
  operationId,
  summary: 'Describe the cross-origin request policy',
  responses: { '204': responseRef('NoContent') },
});

const standardResponses = {
  '304': responseRef('NotModified'),
  '400': responseRef('BadRequest'),
  '500': responseRef('ServerError'),
  '503': responseRef('ServiceUnavailable'),
};

const problemContent = {
  'application/problem+json': { schema: schemaRef('ProblemDetails') },
};

export const openApiDocument = {
  openapi: '3.1.0',
  jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
  info: {
    title: 'TomeCMS Content API',
    version: '1.0.0',
    description: 'Read-only published content for websites, applications, and other headless clients.',
  },
  servers: [{ url: '/', description: 'Current TomeCMS installation' }],
  tags: [
    { name: 'Content', description: 'Published site content' },
    { name: 'Contract', description: 'Machine-readable API contract' },
  ],
  paths: {
    '/api/v1/content/site': {
      get: {
        operationId: 'getPublicSite',
        summary: 'Get public site settings',
        tags: ['Content'],
        responses: {
          '200': jsonResponse('Public site settings.', 'PublicSiteResponse'),
          ...standardResponses,
        },
      },
      options: optionsOperation('optionsPublicSite'),
    },
    '/api/v1/content/posts': {
      get: {
        operationId: 'listPublicPosts',
        summary: 'List published posts',
        tags: ['Content'],
        parameters: [parameterRef('Locale'), parameterRef('Limit'), parameterRef('Cursor'), parameterRef('Category')],
        responses: {
          '200': jsonResponse('A cursor-paginated page of published posts.', 'PostListResponse'),
          ...standardResponses,
        },
      },
      options: optionsOperation('optionsPublicPosts'),
    },
    '/api/v1/content/posts/{slug}': {
      get: {
        operationId: 'getPublicPost',
        summary: 'Get one published post',
        tags: ['Content'],
        parameters: [parameterRef('Slug'), parameterRef('Locale')],
        responses: {
          '200': jsonResponse('A published post.', 'PublicPostResponse'),
          ...standardResponses,
          '404': responseRef('NotFound'),
        },
      },
      options: optionsOperation('optionsPublicPost'),
    },
    '/api/v1/content/pages': {
      get: {
        operationId: 'listPublicPages',
        summary: 'List published pages',
        tags: ['Content'],
        parameters: [parameterRef('Locale'), parameterRef('Limit'), parameterRef('Cursor')],
        responses: {
          '200': jsonResponse('A cursor-paginated page of published pages.', 'PageListResponse'),
          ...standardResponses,
        },
      },
      options: optionsOperation('optionsPublicPages'),
    },
    '/api/v1/content/pages/{slug}': {
      get: {
        operationId: 'getPublicPage',
        summary: 'Get one published page',
        tags: ['Content'],
        parameters: [parameterRef('Slug'), parameterRef('Locale')],
        responses: {
          '200': jsonResponse('A published page.', 'PublicPageResponse'),
          ...standardResponses,
          '404': responseRef('NotFound'),
        },
      },
      options: optionsOperation('optionsPublicPage'),
    },
    '/api/v1/content/categories': {
      get: {
        operationId: 'listPublicCategories',
        summary: 'List categories used by published posts',
        tags: ['Content'],
        parameters: [parameterRef('Locale')],
        responses: {
          '200': jsonResponse('Published post categories.', 'PublicCategoryListResponse'),
          ...standardResponses,
        },
      },
      options: optionsOperation('optionsPublicCategories'),
    },
    '/api/v1/content/navigation': {
      get: {
        operationId: 'getPublicNavigation',
        summary: 'Get header and footer navigation',
        tags: ['Content'],
        parameters: [parameterRef('Locale')],
        responses: {
          '200': jsonResponse('Public navigation for one locale.', 'PublicNavigationResponse'),
          ...standardResponses,
        },
      },
      options: optionsOperation('optionsPublicNavigation'),
    },
    '/api/v1/content/openapi.json': {
      get: {
        operationId: 'getContentApiContract',
        summary: 'Get this OpenAPI contract',
        tags: ['Contract'],
        responses: {
          '200': jsonResponse('The OpenAPI 3.1 contract.', 'OpenApiDocument'),
          '304': responseRef('NotModified'),
          '400': responseRef('BadRequest'),
          '500': responseRef('ServerError'),
        },
      },
      options: optionsOperation('optionsContentApiContract'),
    },
  },
  components: {
    parameters: {
      Locale: {
        name: 'locale',
        in: 'query',
        required: true,
        description: 'Content locale.',
        schema: { type: 'string', enum: ['th', 'en'] },
      },
      Limit: {
        name: 'limit',
        in: 'query',
        required: false,
        description: 'Maximum items returned.',
        schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
      Cursor: {
        name: 'cursor',
        in: 'query',
        required: false,
        description: 'Opaque cursor returned in the previous response.',
        schema: { type: 'string', minLength: 1, maxLength: 2_048 },
      },
      Category: {
        name: 'category',
        in: 'query',
        required: false,
        description: 'Filter posts by category name.',
        schema: { type: 'string', minLength: 1, maxLength: 80 },
      },
      Slug: {
        name: 'slug',
        in: 'path',
        required: true,
        description: 'Published content slug.',
        schema: { type: 'string', minLength: 1, maxLength: 120, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
      },
    },
    responses: {
      NoContent: { description: 'CORS policy returned with no body.' },
      NotModified: { description: 'The cached representation is still current.' },
      BadRequest: { description: 'The request parameters are invalid.', content: problemContent },
      NotFound: { description: 'The published resource does not exist.', content: problemContent },
      ServerError: { description: 'The request could not be completed.', content: problemContent },
      ServiceUnavailable: { description: 'The content service is not ready.', content: problemContent },
    },
    schemas: {
      EditorMark: {
        type: 'object',
        description: 'A Tiptap text mark.',
        properties: {
          type: { type: 'string', minLength: 1 },
          attrs: { type: 'object', additionalProperties: true },
        },
        required: ['type'],
        additionalProperties: false,
      },
      EditorNode: {
        type: 'object',
        description: 'A Tiptap node. Runtime input is limited to 100 nested levels.',
        properties: {
          type: { type: 'string', minLength: 1 },
          attrs: { type: 'object', additionalProperties: true },
          content: { type: 'array', items: schemaRef('EditorNode') },
          marks: { type: 'array', items: schemaRef('EditorMark') },
          text: { type: 'string' },
        },
        required: ['type'],
        additionalProperties: false,
      },
      EditorDocument: {
        type: 'object',
        description: 'Native Tiptap document retained for re-editing.',
        properties: {
          type: { type: 'string', const: 'doc' },
          content: { type: 'array', items: schemaRef('EditorNode') },
        },
        required: ['type'],
        additionalProperties: false,
      },
      PublicMedia: componentSchema(publicMediaSchema),
      PublicTranslation: componentSchema(publicTranslationSchema),
      PublicCategory: componentSchema(publicCategorySchema),
      PublicSeo: componentSchema(publicSeoSchema),
      PublicPost: componentSchema(publicPostSchema),
      PublicPage: componentSchema(publicPageSchema),
      PublicAuthor: componentSchema(publicAuthorSchema),
      PublicSite: componentSchema(publicSiteSchema),
      PublicNavigation: componentSchema(publicNavigationSchema),
      PublicListMeta: componentSchema(publicListMetaSchema),
      PublicListLinks: componentSchema(publicListLinksSchema),
      ProblemDetails: componentSchema(problemDetailsSchema),
      PublicLocaleMeta: {
        type: 'object',
        properties: { locale: { type: 'string', enum: ['th', 'en'] } },
        required: ['locale'],
        additionalProperties: false,
      },
      PublicSiteResponse: {
        type: 'object',
        properties: { data: schemaRef('PublicSite') },
        required: ['data'],
        additionalProperties: false,
      },
      PublicPostResponse: {
        type: 'object',
        properties: { data: schemaRef('PublicPost') },
        required: ['data'],
        additionalProperties: false,
      },
      PublicPageResponse: {
        type: 'object',
        properties: { data: schemaRef('PublicPage') },
        required: ['data'],
        additionalProperties: false,
      },
      PostListResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: schemaRef('PublicPost') },
          meta: schemaRef('PublicListMeta'),
          links: schemaRef('PublicListLinks'),
        },
        required: ['data', 'meta', 'links'],
        additionalProperties: false,
      },
      PageListResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: schemaRef('PublicPage') },
          meta: schemaRef('PublicListMeta'),
          links: schemaRef('PublicListLinks'),
        },
        required: ['data', 'meta', 'links'],
        additionalProperties: false,
      },
      PublicCategoryListResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: schemaRef('PublicCategory') },
          meta: schemaRef('PublicLocaleMeta'),
        },
        required: ['data', 'meta'],
        additionalProperties: false,
      },
      PublicNavigationResponse: {
        type: 'object',
        properties: {
          data: schemaRef('PublicNavigation'),
          meta: schemaRef('PublicLocaleMeta'),
        },
        required: ['data', 'meta'],
        additionalProperties: false,
      },
      OpenApiDocument: {
        type: 'object',
        properties: {
          openapi: { type: 'string', const: '3.1.0' },
          info: { type: 'object' },
          paths: { type: 'object' },
        },
        required: ['openapi', 'info', 'paths'],
        additionalProperties: true,
      },
    },
  },
} as const;
