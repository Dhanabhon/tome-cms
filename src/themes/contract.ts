import type {
  Page,
  Post,
  PostAlternate,
  PostCategoryBadge,
  PostLocale,
  PublicAuthorProfile,
  PublicNavigationItem,
  SiteSettings,
} from '../types/cms';
import type { ThemeChoice } from '../lib/theme';

/**
 * Everything a theme is allowed to know.
 *
 * A theme draws the site and nothing else: what a route fetches, what the head promises a
 * search engine, and which words belong to which language are the product's business and
 * stay in core. So each of these carries what the route already had in hand, never a
 * handle to fetch more with -- a theme cannot make the site slow, or wrong, only plain.
 *
 * Every template declares `interface Props extends Theme…Props`, which is what holds a
 * second theme to the same shape: a template that drifts stops satisfying the union the
 * registry returns, and the build says so at the call site rather than at a reader's.
 */

export interface ThemeManifest {
  /** One sentence, shown beside the name where the owner chooses. */
  description: string;
  /** The value stored in the settings; also the directory name. */
  id: string;
  name: string;
}

export interface ThemeShellProps {
  /** Off means the header draws no theme control, and the page carries no script for one. */
  allowVisitorTheme: boolean;
  alternates: PostAlternate[];
  footer: PublicNavigationItem[];
  header: PublicNavigationItem[];
  locale: PostLocale;
  showPoweredBy: boolean;
  siteName: string;
  /** What the server rendered, so a control is not briefly checked on the wrong option. */
  theme: ThemeChoice;
}

export interface ThemeHomeProps {
  /** The category the reader filtered by, as they wrote it. */
  activeCategory: string | undefined;
  /** Set when a page beyond the first is being shown, which changes what is eager. */
  cursor: string | undefined;
  categories: PostCategoryBadge[];
  loadError: boolean;
  locale: PostLocale;
  nextCursor: string | null;
  posts: Post[];
  profile: PublicAuthorProfile | null;
  siteName: string;
  tagline: string | undefined;
  timezone: SiteSettings['timezone'];
}

export interface ThemePostProps {
  categories: PostCategoryBadge[];
  /** The admin looking at a draft: it is dated by its last save, not by a publication. */
  preview?: boolean;
  locale: PostLocale;
  /** Never null: a post that is missing is a system state, and the route says so itself. */
  post: Post;
  profile: PublicAuthorProfile | null;
  settings: Pick<SiteSettings, 'site_name' | 'timezone'>;
}

export interface ThemePageProps {
  locale: PostLocale;
  page: Page;
  preview?: boolean;
}
