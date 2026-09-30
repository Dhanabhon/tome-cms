import { contentSlug } from './slug';

export interface RailHeading {
  id: string;
  level: 2 | 3;
  text: string;
}

const HEADING = /<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/g;
const ID = /\sid=(?:"([^"]*)"|'([^']*)')/;
const ENTITIES: Record<string, string> = { amp: '&', gt: '>', lt: '<', quot: '"' };

/** What a reader sees of a heading's markup: the marks dropped, the entities the sanitizer wrote decoded. */
function plainText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|gt|lt|quot));/gi, (_match, decimal, hex, name) =>
      name ? ENTITIES[name.toLowerCase()] : String.fromCodePoint(Number.parseInt(decimal ?? hex, decimal ? 10 : 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The headings a long article can be navigated by, and the body with each given an anchor.
 *
 * The sanitizer lets a heading carry a style and nothing else, so the ids are added here, where
 * the theme draws the article, in one pass: the rail's links and the headings they point at are
 * made from the same list and cannot disagree. A heading that already has an id keeps it, and
 * nothing else takes that id. The address is the title's slug -- Thai letters kept -- numbered
 * -2, -3 when a title repeats.
 *
 * Fewer than two headings is not something to navigate: the body comes back untouched with no
 * headings, so a short article is neither given ids nobody asked for nor a rail of one tick.
 * Only h2 and h3: the page's own title is the h1, and a section break is not a heading.
 */
export function readingRail(html: string): { headings: RailHeading[]; html: string } {
  const found = [...html.matchAll(HEADING)];
  if (found.length < 2) return { headings: [], html };

  const taken = new Set<string>();
  for (const [, , attributes] of found) {
    const existing = ID.exec(attributes);
    if (existing) taken.add(existing[1] ?? existing[2]);
  }

  const headings: RailHeading[] = [];
  const body = html.replace(HEADING, (whole: string, level: string, attributes: string, inner: string) => {
    const text = plainText(inner);
    const existing = ID.exec(attributes);
    let id = existing ? existing[1] ?? existing[2] : '';
    if (!existing) {
      const base = contentSlug(text) || 'section';
      id = base;
      for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
      taken.add(id);
    }
    headings.push({ id, level: level === '2' ? 2 : 3, text });
    return existing ? whole : `<h${level} id="${id}"${attributes}>${inner}</h${level}>`;
  });
  return { headings, html: body };
}
