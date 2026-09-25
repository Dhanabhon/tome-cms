import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';

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
      plugins: [starlightLinksValidator()],
      // Each section's task adds its group here, so the site builds at every step.
      sidebar: [],
    }),
  ],
});
