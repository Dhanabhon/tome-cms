import assert from 'node:assert/strict';
import test from 'node:test';

// The schema lives beside the queries, so importing it reads the server environment.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://tome:tome@localhost:5432/tome',
  TOME_CMS_PUBLIC_URL: 'http://localhost:4321',
  TOME_CMS_INSTALL_TOKEN: 'install-test-secret-at-least-32-bytes',
  BETTER_AUTH_SECRET: 'better-auth-test-secret-at-least-32-bytes',
  TOME_CMS_CONTEXT_SECRET: 'cursor-test-context-secret-at-least-32-bytes',
  TOME_CMS_RECOVERY_PEPPER: 'recovery-test-secret-at-least-32-bytes',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
  S3_BUCKET: 'tome-media',
  MEDIA_PUBLIC_URL: 'http://localhost:9000/tome-media',
});
const { navigationMenuSchema } = await import('../../src/server/content/navigation');

const PAGE = '6f1c2a4e-8b0d-4c3e-9a51-2d7e0f4b6c18';
const home = { kind: 'home', label: 'Home', pageId: null, url: null };
const page = { kind: 'page', label: 'About', pageId: PAGE, url: null };
const link = (n: number) => ({ kind: 'custom', label: `Link ${n}`, pageId: null, url: `/link-${n}` });
const group = (children: unknown[]) => ({ kind: 'group', label: 'Services', pageId: null, url: null, children });
const menu = (items: unknown[], location = 'header') => ({ locale: 'en', location, items });

function refused(body: unknown, message: string | null, path: PropertyKey[]) {
  const result = navigationMenuSchema.safeParse(body);
  assert.equal(result.success, false);
  const issue = result.error?.issues.find((candidate) => message === null || candidate.message === message);
  assert.ok(issue, `expected ${message ?? 'an issue'}, got ${JSON.stringify(result.error?.issues)}`);
  assert.deepEqual(issue.path, path);
}

test('a header item may hold one level of sub-items, and a group opens them', () => {
  const parsed = navigationMenuSchema.parse(menu([
    { ...home, children: [page] },
    group([link(1), link(2)]),
  ]));
  assert.equal(parsed.items[0]?.children?.[0]?.kind, 'page');
  assert.deepEqual(parsed.items[1], {
    kind: 'group', label: 'Services', pageId: null, url: null, newTab: false,
    children: [
      { kind: 'custom', label: 'Link 1', pageId: null, url: '/link-1', newTab: false },
      { kind: 'custom', label: 'Link 2', pageId: null, url: '/link-2', newTab: false },
    ],
  });
});

test('the old flat body is still accepted', () => {
  const parsed = navigationMenuSchema.parse(menu([home, page, link(1)], 'footer'));
  assert.equal(parsed.items.length, 3);
  assert.equal(parsed.items[0]?.children, undefined);
});

test('a sub-item cannot hold sub-items', () => {
  refused(menu([{ ...home, children: [{ ...page, children: [link(1)] }] }]), null, ['items', 0, 'children', 0]);
});

test('a group cannot be a sub-item', () => {
  refused(menu([{ ...home, children: [group([link(1)])] }]), null, ['items', 0, 'children', 0, 'kind']);
});

test('the footer has no sub-items and no groups', () => {
  refused(menu([{ ...home, children: [page] }], 'footer'), 'Only the header menu has sub-items.', ['items', 0, 'children']);
  refused(menu([group([link(1)])], 'footer'), 'A group belongs in the header menu.', ['items', 0]);
});

test('a group needs at least one sub-item', () => {
  refused(menu([group([])]), 'A group needs at least one sub-item.', ['items', 0, 'children']);
  refused(menu([{ kind: 'group', label: 'Empty', pageId: null, url: null }]), 'A group needs at least one sub-item.', ['items', 0, 'children']);
});

test('a group has no link and never opens a new tab', () => {
  assert.equal(navigationMenuSchema.safeParse(menu([{ ...group([link(1)]), url: '/x' }])).success, false);
  assert.equal(navigationMenuSchema.safeParse(menu([{ ...group([link(1)]), newTab: true }])).success, false);
});

test('a target appears once across both levels', () => {
  refused(menu([page, { ...home, children: [page] }]), 'Duplicate navigation target.', ['items', 1, 'children', 0]);
  assert.equal(navigationMenuSchema.safeParse(menu([group([link(1)]), group([link(2)])])).success, true, 'two groups are not a duplicate');
});

test('the 50-item limit counts sub-items', () => {
  const parents = Array.from({ length: 10 }, (_, p) => ({
    ...link(p * 10), children: Array.from({ length: 4 }, (_, c) => link(p * 10 + c + 1)),
  }));
  assert.equal(navigationMenuSchema.safeParse(menu(parents)).success, true, '50 items in all');
  refused(menu([...parents, link(999)]), 'A menu holds at most 50 items, sub-items included.', ['items']);
});
