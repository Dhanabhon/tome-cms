import assert from 'node:assert/strict';
import test from 'node:test';

import { openApiDocument } from '../../src/server/http/openapi';
import { problemDetailsSchema, publicSiteSchema } from '../../src/server/http/public-schemas';

const expectedPaths = [
  '/api/v1/content/site',
  '/api/v1/content/posts',
  '/api/v1/content/posts/{slug}',
  '/api/v1/content/pages',
  '/api/v1/content/pages/{slug}',
  '/api/v1/content/categories',
  '/api/v1/content/navigation',
  '/api/v1/content/openapi.json',
] as const;

interface Reference {
  readonly $ref: string;
}

interface ResponseShape {
  readonly content?: Readonly<Record<string, unknown>>;
  readonly description?: string;
  readonly $ref?: string;
}

interface OperationShape {
  readonly operationId: string;
  readonly parameters?: readonly Reference[];
  readonly responses: Readonly<Record<string, ResponseShape>>;
}

interface DocumentShape {
  readonly components: {
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly responses: Readonly<Record<string, ResponseShape>>;
    readonly schemas: Readonly<Record<string, unknown>>;
  };
  readonly openapi: string;
  readonly paths: Readonly<Record<string, {
    readonly get: OperationShape;
    readonly options: OperationShape;
  }>>;
}

test('OpenAPI describes only the complete public content contract', () => {
  const document: DocumentShape = openApiDocument;
  assert.equal(document.openapi, '3.1.0');
  assert.deepEqual(Object.keys(document.paths), expectedPaths);

  for (const path of expectedPaths) {
    const item = document.paths[path];
    assert.ok(item, `${path} is documented`);
    assert.deepEqual(Object.keys(item).sort(), ['get', 'options']);
    assert.ok(item.get.operationId);
    assert.ok(item.get.responses['200']);
    assert.ok(item.get.responses['304']);
    assert.deepEqual(Object.keys(item.get.responses['200'].content ?? {}), ['application/json']);
    assert.ok(item.options.responses['204']);
  }

  assert.deepEqual(
    document.paths['/api/v1/content/posts'].get.parameters?.map(({ $ref }) => $ref),
    [
      '#/components/parameters/Locale',
      '#/components/parameters/Limit',
      '#/components/parameters/Cursor',
      '#/components/parameters/Category',
    ],
  );
  assert.deepEqual(
    document.paths['/api/v1/content/pages/{slug}'].get.parameters?.map(({ $ref }) => $ref),
    ['#/components/parameters/Slug', '#/components/parameters/Locale'],
  );
  assert.ok(document.paths['/api/v1/content/posts/{slug}'].get.responses['404']);
  assert.ok(document.paths['/api/v1/content/site'].get.responses['503']);

  for (const name of [
    'EditorDocument',
    'PublicMedia',
    'PublicTranslation',
    'PublicCategory',
    'PublicSeo',
    'PublicPost',
    'PublicPage',
    'PublicAuthor',
    'PublicSite',
    'PublicNavigation',
    'PublicListMeta',
    'PublicListLinks',
    'ProblemDetails',
    'PostListResponse',
    'PageListResponse',
  ]) assert.ok(document.components.schemas[name], `${name} is reusable`);

  for (const name of ['BadRequest', 'NotFound', 'ServerError', 'ServiceUnavailable']) {
    assert.deepEqual(
      Object.keys(document.components.responses[name]?.content ?? {}),
      ['application/problem+json'],
    );
  }

  const routeNames = Object.keys(document.paths).join(' ');
  for (const privateRoute of ['/api/admin', '/preview', '/storage', '/auth']) {
    assert.equal(routeNames.includes(privateRoute), false);
  }

  assert.equal(publicSiteSchema.safeParse({
    author: null,
    // Always present: a site with no logo or icon of its own says so.
    brand: { icon: null, logo: null, logoDark: null, showSiteName: true },
    defaultLocale: 'th',
    description: 'A public site',
    name: 'TomeCMS',
    supportedLocales: ['th', 'en'],
    tagline: 'Publish clearly',
    timezone: 'Asia/Bangkok',
    updatedAt: '2026-09-13T00:00:00.000Z',
  }).success, true);
  assert.equal(problemDetailsSchema.safeParse({
    detail: 'The resource was not found.',
    instance: '/api/v1/content/posts/missing',
    requestId: 'c92f585d-6c6a-49e8-bd72-076fe3b32a11',
    status: 404,
    title: 'Not Found',
    type: 'about:blank',
  }).success, true);
});
