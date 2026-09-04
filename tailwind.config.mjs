import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: '#2449d8',
        ink: '#171717',
        line: '#d9dde5',
        muted: '#667085',
        soft: '#f7f8fa',
      },
      fontFamily: {
        display: ['Georgia', 'Cambria', 'Times New Roman', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      typography: {
        DEFAULT: {
          css: {
            '--tw-prose-body': '#292929',
            '--tw-prose-headings': '#171717',
            '--tw-prose-links': '#2449d8',
            '--tw-prose-bold': '#171717',
            '--tw-prose-counters': '#667085',
            '--tw-prose-bullets': '#98a2b3',
            '--tw-prose-quotes': '#171717',
            '--tw-prose-quote-borders': '#2449d8',
            '--tw-prose-code': '#171717',
            '--tw-prose-pre-code': '#e5e7eb',
            '--tw-prose-pre-bg': '#171717',
            fontFamily: ['Georgia', 'Cambria', 'Times New Roman', 'serif'].join(', '),
          },
        },
      },
    },
  },
  plugins: [typography],
};
