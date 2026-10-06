import type {
  Page,
  Post,
  PostAlternate,
  PostCategoryBadge,
  PostLocale,
  PublicAuthorProfile,
  PublicHomeSlide,
  PublicNavigationItem,
  SiteSettings,
} from '../types/cms';
import type { ResponsiveImage } from '../lib/responsive-image';
import type { SiteBrand } from '../lib/site-brand';
import type { ThemeChoice } from '../lib/theme';

/** What a theme is told about the site's logo. It draws it with SiteBrand, not by hand. */
export type ThemeBrand = Pick<SiteBrand, 'logo' | 'logoDark' | 'showSiteName'>;

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
  /** The home page sets the newest post of an unsearched first page apart from its grid, so that
   *  page asks for one more and the grid under it ends on a full row. Absent means it does not. */
  leadsFirstPage?: boolean;
  /** The font files the page asks for before its stylesheet does, as `/fonts/<file>.woff2` paths
   *  under public/: the faces the first screen is drawn in, so they do not swap in late. A theme
   *  with none preloads nothing, and its faces load when its stylesheet asks for them. */
  preloadFonts?: readonly string[];
  /** What Customize offers for this theme. A theme with none is not customisable. */
  settings?: readonly ThemeSetting[];
}

/**
 * A theme's Shell renders `<body>`, and takes a named slot `above` before anything it draws.
 * The core puts things there that are not the theme's -- an announcement band a plugin
 * supplied the words for, and the mount points a plugin's browser code attaches to. A theme
 * renders the slot and has nothing else to do with it.
 */
export interface ThemeShellProps {
  /** What this theme has been told, with its declared fallbacks already applied. */
  themeSettings: Readonly<Record<string, string>>;
  /** Off means the header draws no theme control, and the page carries no script for one. */
  allowVisitorTheme: boolean;
  alternates: PostAlternate[];
  /** The logo, a dark one, and whether the name is beside them: put <SiteBrand> in the home link. */
  brand: ThemeBrand;
  footer: PublicNavigationItem[];
  header: PublicNavigationItem[];
  locale: PostLocale;
  showPoweredBy: boolean;
  siteName: string;
  /** What the server rendered, so a control is not briefly checked on the wrong option. */
  theme: ThemeChoice;
}

/** A post on the home page: the route hands over the published read, which carries the post's
 *  categories in the order they were given, and its cover's size and copies (draw it with
 *  responsiveAttrs). Optional, so a post without them is still a post. */
export type ThemeHomePost = Post & { categories?: PostCategoryBadge[]; coverImage?: ResponsiveImage | null };

export interface ThemeHomeProps {
  /** What this theme has been told, with its declared fallbacks already applied. */
  themeSettings: Readonly<Record<string, string>>;
  /** The category the reader filtered by, as they wrote it; on a category's own page, its name. */
  activeCategory: string | undefined;
  /** Set on a category's own page: its name, what it says of itself in this language ('' when it says
   *  nothing), and its address, which the list's later pages hang off (draw them with listHref). The
   *  theme names the list with it as it names a filtered one, the description under the name. */
  category?: { description: string; name: string; path: string };
  /** What the reader searched for, trimmed, or undefined when they did not. The posts are already
   *  only the ones that match. A theme draws them first, without a hero, and says what was
   *  searched for and how to leave it: the words are the reader's, so it prints them as text. */
  query: string | undefined;
  /** Set when a page beyond the first is being shown, which changes what is eager. */
  cursor: string | undefined;
  categories: PostCategoryBadge[];
  loadError: boolean;
  locale: PostLocale;
  nextCursor: string | null;
  posts: ThemeHomePost[];
  profile: PublicAuthorProfile | null;
  /** The live home slides of this language, in order, at most five. A theme that draws no
   *  hero, or a hero of its own making, ignores them. */
  slides: PublicHomeSlide[];
  siteName: string;
  /** Always a line: a site that has not written one is given the product's own. */
  tagline: string;
  timezone: SiteSettings['timezone'];
}

export interface ThemePostProps {
  /** What this theme has been told, with its declared fallbacks already applied. */
  themeSettings: Readonly<Record<string, string>>;
  categories: PostCategoryBadge[];
  /** The admin looking at a draft: it is dated by its last save, not by a publication. */
  preview?: boolean;
  locale: PostLocale;
  /** Never null: a post that is missing is a system state, and the route says so itself. A
   *  published post brings its cover's library entry, which is what describes the cover, and its
   *  pictures' sizes and copies: articleCover draws both from them. */
  post: Post & { coverImage?: (ResponsiveImage & { alt_text: string | null }) | null; media?: readonly ResponsiveImage[] };
  profile: PublicAuthorProfile | null;
  settings: Pick<SiteSettings, 'site_name' | 'timezone'>;
}

export interface ThemePageProps {
  locale: PostLocale;
  /** A published page brings its pictures' sizes and copies, for withResponsiveImages. */
  page: Page & { media?: readonly ResponsiveImage[] };
  preview?: boolean;
}
