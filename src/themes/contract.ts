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

/**
 * A setting a theme asks the admin to offer for it.
 *
 * The same arrangement the plugins have, for the same reason: the screen that offers the
 * choice must not load the theme to find out what the choices are. A theme declares them
 * here, the core renders the form and stores the answers, and the theme is handed them
 * back. Values are strings, which is what a form produces and what jsonb keeps without
 * argument; a switch is 'on' or 'off'.
 *
 * What a theme cannot do is decide what happens when a setting is missing at read time --
 * `fallback` is the answer a site that has never been asked gets, and it is declared here
 * so the core never has to guess one.
 */
export interface ThemeSettingOption {
  label: { en: string; th: string };
  value: string;
}

export interface ThemeSetting {
  /** The value used until the owner chooses one. A 'text' setting may fall back to '', and
   *  what it then shows is the template's business rather than the store's. */
  fallback: string;
  hint?: { en: string; th: string };
  key: string;
  kind: 'choice' | 'switch' | 'text';
  label: { en: string; th: string };
  /** Required by 'text': how much of it a write may store. */
  max?: number;
  /** Required by 'choice', and the only values a write may store for it. */
  options?: readonly ThemeSettingOption[];
}

export interface ThemeManifest {
  /** One sentence, shown beside the name where the owner chooses. */
  description: string;
  /** The value stored in the settings; also the directory name. */
  id: string;
  name: string;
  /** What Customize offers for this theme. A theme with none is not customisable. */
  settings?: readonly ThemeSetting[];
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
  /** What this theme has been told, with its declared fallbacks already applied. */
  themeSettings: Readonly<Record<string, string>>;
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
  /** Always a line: a site that has not written one is given the product's own. */
  tagline: string;
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
