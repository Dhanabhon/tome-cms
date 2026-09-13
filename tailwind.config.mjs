import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  theme: {
    screens: {
      sm: '600px',
      md: '840px',
      lg: '1032px',
      xl: '1280px',
      '2xl': '1440px',
    },
    extend: {
      colors: {
        accent: 'var(--color-accent)',
        error: 'var(--color-error)',
        hero: 'var(--color-hero)',
        ink: 'var(--color-ink)',
        line: 'var(--color-rule)',
        link: 'var(--color-link)',
        muted: 'var(--color-muted)',
        placeholder: 'var(--color-placeholder)',
        soft: 'var(--color-paper-2)',
        surface: 'var(--color-surface)',
      },
      fontFamily: {
        display: ['IBM Plex Sans Thai', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['IBM Plex Sans Thai', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        md: '6px',
        lg: '8px',
        xl: '16px',
        '2xl': '20px',
      },
      typography: {
        DEFAULT: {
          css: {
            '--tw-prose-body': 'var(--color-ink)',
            '--tw-prose-headings': 'var(--color-ink)',
            '--tw-prose-links': 'var(--color-link)',
            '--tw-prose-bold': 'var(--color-ink)',
            '--tw-prose-counters': 'var(--color-muted)',
            '--tw-prose-bullets': 'var(--color-placeholder)',
            '--tw-prose-quotes': 'var(--color-ink)',
            '--tw-prose-quote-borders': 'var(--color-accent)',
            '--tw-prose-code': 'var(--color-ink)',
            '--tw-prose-pre-code': 'var(--color-paper-2)',
            '--tw-prose-pre-bg': 'var(--color-hero)',
            fontFamily: ['IBM Plex Sans Thai', 'ui-sans-serif', 'system-ui', 'sans-serif'].join(', '),
            h2: {
              fontSize: '22px',
              fontWeight: '700',
              letterSpacing: '-0.25px',
              lineHeight: '28px',
            },
            h3: {
              fontSize: '20px',
              fontWeight: '600',
              letterSpacing: '-0.125px',
              lineHeight: '28px',
            },
          },
        },
      },
    },
  },
  plugins: [typography],
};
