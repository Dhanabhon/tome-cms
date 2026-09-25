import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';
import starlightOpenAPI, { createOpenAPISidebarGroup } from 'starlight-openapi';

const apiReference = createOpenAPISidebarGroup();

export default defineConfig({
  site: 'https://dhanabhon.github.io',
  base: '/tome-cms',
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
      // Each section's task adds its group here, so the site builds at every step.
      sidebar: [
        // Starlight 0.39 dropped `autogenerate` on the group itself; it now sits in `items`.
        { label: 'Start here', translations: { th: 'เริ่มต้นที่นี่' }, items: [{ autogenerate: { directory: 'start' } }] },
        {
          label: 'Headless API',
          translations: { th: 'Headless API' },
          items: ['api/overview', 'api/counting-readers', apiReference],
        },
      ],
    }),
  ],
});
