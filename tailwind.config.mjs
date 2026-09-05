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
        accent: '#2537b1',
        error: '#f64932',
        hero: '#02093a',
        ink: '#000000',
        line: 'rgb(0 0 0 / 8%)',
        link: '#097fe8',
        muted: '#615d59',
        placeholder: '#a39e98',
        soft: '#f6f5f4',
        surface: '#ffffff',
      },
      fontFamily: {
        display: ['NotionInter', 'Inter', 'IBM Plex Sans Thai', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['NotionInter', 'Inter', 'IBM Plex Sans Thai', 'ui-sans-serif', 'system-ui', 'sans-serif'],
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
            '--tw-prose-body': '#000000',
            '--tw-prose-headings': '#000000',
            '--tw-prose-links': '#097fe8',
            '--tw-prose-bold': '#000000',
            '--tw-prose-counters': '#615d59',
            '--tw-prose-bullets': '#a39e98',
            '--tw-prose-quotes': '#000000',
            '--tw-prose-quote-borders': '#2537b1',
            '--tw-prose-code': '#000000',
            '--tw-prose-pre-code': '#f6f5f4',
            '--tw-prose-pre-bg': '#02093a',
            fontFamily: ['NotionInter', 'Inter', 'IBM Plex Sans Thai', 'ui-sans-serif', 'system-ui', 'sans-serif'].join(', '),
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
