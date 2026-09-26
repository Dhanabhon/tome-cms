import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';
import starlightOpenAPI, { createOpenAPISidebarGroup } from 'starlight-openapi';

const apiReference = createOpenAPISidebarGroup();

// starlight-openapi generates the reference in English only, but Starlight's own language
// picker and hreflang links still point at a /th/ copy of every reference page, because it
// does not know the reference has no Thai edition. These send that address to the English
// page instead of a 404. The list is the reference's routes as of this openapi.json; add a
// line here if `npm run docs:openapi && npm --prefix website run build` ever adds one.
// ponytail: hand-maintained list, regenerate from `find website/dist/api/reference -name
// index.html` after an API change instead of teaching this file starlight-openapi's slugger.
const referenceOperations = [
  'getcontentapicontract',
  'getpublicnavigation',
  'getpublicpage',
  'getpublicpost',
  'getpublicsite',
  'getpublicslides',
  'listpubliccategories',
  'listpublicpages',
  'listpublicposts',
  'optionscontentapicontract',
  'optionspubliccategories',
  'optionspublicnavigation',
  'optionspublicpage',
  'optionspublicpages',
  'optionspublicpost',
  'optionspublicposts',
  'optionspublicsite',
  'optionspublicslides',
  'optionsstatshit',
  'poststatshit',
];
const referenceTags = ['content', 'contract', 'stats'];
const base = '/tome-cms';
// The redirects map's destination is written into the redirect page as-is, without the base
// Astro adds to a normal page's own links, so it needs `base` spelled out here.
const referenceRedirects = Object.fromEntries(
  [
    '',
    ...referenceOperations.map((operation) => `operations/${operation}/`),
    ...referenceTags.map((tag) => `operations/tags/${tag}/`),
  ].map((path) => [`/th/api/reference/${path}`, `${base}/api/reference/${path}`]),
);

export default defineConfig({
  site: 'https://dhanabhon.github.io',
  base,
  redirects: referenceRedirects,
  integrations: [
    starlight({
      title: 'TomeCMS',
      description: 'A CMS for sites in Thai and English, built with Astro.',
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        th: { label: 'ไทย', lang: 'th' },
      },
      logo: {
        alt: 'TomeCMS',
        dark: './src/assets/brand/tomecms-logo-reverse.png',
        light: './src/assets/brand/tomecms-logo-color.png',
        replacesTitle: true,
      },
      // The site's own menus in place of the system's dropdowns for language and theme.
      components: {
        LanguageSelect: './src/components/LanguageSelect.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
      social: [{ href: 'https://github.com/Dhanabhon/tome-cms', icon: 'github', label: 'GitHub' }],
      editLink: { baseUrl: 'https://github.com/Dhanabhon/tome-cms/edit/main/website/' },
      customCss: [
        '@fontsource/ibm-plex-sans-thai/400.css',
        '@fontsource/ibm-plex-sans-thai/600.css',
        './src/styles/tome.css',
      ],
      plugins: [
        starlightOpenAPI([
          { base: 'api/reference', schema: './src/generated/openapi.json', sidebar: { group: apiReference, label: 'Reference' } },
        ]),
        // The reference's routes are injected by starlight-openapi, which the validator cannot see.
        starlightLinksValidator({ exclude: ['/tome-cms/api/reference/**'] }),
      ],
      sidebar: [
        // Starlight 0.39 dropped `autogenerate` on the group itself; it now sits in `items`.
        { label: 'Start here', translations: { th: 'เริ่มต้นที่นี่' }, items: [{ autogenerate: { directory: 'start' } }] },
        { label: 'Running a site', translations: { th: 'ดูแลเว็บไซต์' }, items: [{ autogenerate: { directory: 'running' } }] },
        { label: 'Using the admin', translations: { th: 'ใช้งานหน้าผู้ดูแล' }, items: [{ autogenerate: { directory: 'admin' } }] },
        { label: 'Plugins', translations: { th: 'ปลั๊กอิน' }, items: [{ autogenerate: { directory: 'plugins' } }] },
        {
          label: 'Headless API',
          translations: { th: 'Headless API' },
          items: ['api/overview', 'api/counting-readers', apiReference],
        },
        { label: 'Extending', translations: { th: 'ต่อยอด' }, items: [{ autogenerate: { directory: 'extending' } }] },
        { label: 'Contributing', translations: { th: 'ร่วมพัฒนา' }, items: [{ autogenerate: { directory: 'contributing' } }] },
      ],
    }),
  ],
});
