import type { EditorDocument, EditorNode } from '../../src/types/cms';

/** What Almanac's browser suite reads: the pieces of the site its tests name. */
export interface AlmanacSeed {
  /** Category ids by name, which is where a card's tone comes from. */
  categoryIds: Record<string, string>;
  draftId: string;
}

/**
 * The site Almanac's browser suite reads, written through the functions the admin uses: nine
 * published posts (the first with a cover and a body of every shape the theme styles, one with a
 * long unbreakable title, one in a Thai category, one in the default category), a draft, two pages,
 * a header menu with a sub-menu and a footer menu of two links. The owner, the site's settings,
 * the default category and one media row are already there. The server's environment must be set
 * before it is called.
 */
export async function seedAlmanac(owner: string, thaiCategory: string, longTitle: string): Promise<AlmanacSeed> {
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  const cover = (await sql<{ id: string }>`select id from media_items limit 1`.execute(db)).rows[0].id;
  const { createCategory } = await import('../../src/server/content/categories');
  const [fieldNotes, recipes, thai] = await Promise.all(['Field Notes', 'Recipes', thaiCategory].map((name) => createCategory(owner, name)));
  const categoryIds: Record<string, string> = {
    'Field Notes': fieldNotes.id, Recipes: recipes.id, [thaiCategory]: thai.id,
    Uncategorized: (await sql<{ id: string }>`select id from categories where is_default`.execute(db)).rows[0].id,
  };

  const text = (value: string): EditorNode => ({ type: 'text', text: value });
  const paragraph = (value: string): EditorNode => ({ type: 'paragraph', content: [text(value)] });
  const heading = (level: number, value: string, textAlign?: string): EditorNode => ({ type: 'heading', attrs: { level, ...(textAlign && { textAlign }) }, content: [text(value)] });
  const code = (value: string): EditorNode => ({ type: 'codeBlock', attrs: { language: 'javascript' }, content: [text(value)] });
  const list = (...items: EditorNode[][]): EditorNode => ({ type: 'bulletList', content: items.map((blocks) => ({ type: 'listItem', content: blocks })) });
  const body = (...blocks: EditorNode[]): EditorDocument => ({ type: 'doc', content: blocks });
  const { createPost } = await import('../../src/server/content/posts');
  // Newest first: the first one is what "Start reading" opens. Nine posts, so the list pages as six then three.
  const posts = [
    { slug: 'why-we-bake-at-night', title: 'Why we bake at night', categories: [fieldNotes.id], cover,
      excerpt: 'The dough is calmer after dark, and so is the baker.',
      // An h1 in the body, aligned or not, must not become a second h1 on the page.
      content: body(heading(1, 'A heading one in the body'), paragraph('The oven is already warm by the time the street goes quiet. '.repeat(8)), heading(1, 'An aligned heading one', 'center'), heading(2, 'The first hour'), paragraph('Flour, water and patience.'),
        code('const dough = flour + water;'), list([paragraph('The first step'), paragraph('Its second paragraph, in the same item')], [paragraph('The second step')])) },
    { slug: 'sourdough-thai', title: 'ขนมปังซาวร์โดว์สำหรับมือใหม่', categories: [thai.id], cover: null,
      excerpt: 'เริ่มจากแป้งสองถ้วยและความอดทน', content: body(paragraph('เริ่มจากแป้งสองถ้วย น้ำหนึ่งถ้วย และเวลาอีกสักหน่อย')) },
    { slug: 'long-title', title: longTitle, categories: [fieldNotes.id], cover: null,
      excerpt: 'A title with a word that will not break.', content: body(paragraph('The title is the point of this post.')) },
    // No category chosen: the database gives it the default one, Uncategorized, which is where its card's letter comes from.
    { slug: 'butter-and-patience', title: 'Zymurgy, butter and patience', categories: [], cover: null,
      excerpt: 'A post filed under the default category.', content: body(paragraph('Butter keeps; patience does not. A zymurgy joke.')) },
    ...[1, 2, 3, 4, 5].map((n) => ({ slug: `filler-${n}`, title: `Notes on the ${['first', 'second', 'third', 'fourth', 'fifth'][n - 1]} recipe`, categories: [recipes.id], cover: n === 1 ? cover : null,
      excerpt: `Recipe number ${n}.`, content: body(paragraph(`A short note about recipe ${n}.`)) })),
  ];
  for (const [index, post] of posts.entries()) {
    await createPost(owner, {
      title: post.title, slug: post.slug, excerpt: post.excerpt, contentJson: post.content, categoryIds: post.categories,
      coverMediaId: post.cover, metaTitle: null, metaDescription: null, status: 'published',
      publishedAt: new Date(Date.now() - (index + 1) * 86_400_000).toISOString(),
    });
  }

  const { createPage } = await import('../../src/server/content/pages');
  const makePage = async (title: string, slug: string, blocks: EditorNode[]) => (await createPage(owner, {
    excerpt: '', title, slug, metaTitle: null, metaDescription: null, status: 'published', contentJson: body(...blocks),
  })).id;
  const about = await makePage('About the bakery', 'about', [heading(1, 'A heading one in a page'), heading(1, 'An aligned heading one in a page', 'right'), paragraph('A bakery on a quiet street.')]);
  const team = await makePage('Team', 'team', [paragraph('Three bakers.')]);
  const link = (label: string, url: string) => ({ kind: 'custom' as const, label, pageId: null, url, newTab: false });
  const { replaceNavigation } = await import('../../src/server/content/navigation');
  await replaceNavigation(owner, { locale: 'en', location: 'header', items: [
    { kind: 'home', label: 'Home', pageId: null, url: null, newTab: false },
    { kind: 'page', label: 'About', pageId: about, url: null, newTab: false, children: [
      { kind: 'page', label: 'Team', pageId: team, url: null, newTab: false },
      link('Contact', '/contact'),
    ] },
    link('Shop', '/shop'),
  ] });
  await replaceNavigation(owner, { locale: 'en', location: 'footer', items: [link('Privacy', '/privacy'), link('Feed', '/feed')] });
  // The preview hands a theme no categories at all, whatever a draft is filed under: the only way a post reaches Almanac without one.
  const draft = await createPost(owner, {
    title: 'A draft in the making', slug: 'a-draft', excerpt: '', contentJson: body(paragraph('Not yet.')), categoryIds: [],
    coverMediaId: null, metaTitle: null, metaDescription: null, status: 'draft',
  });
  return { categoryIds, draftId: draft.id };
}

