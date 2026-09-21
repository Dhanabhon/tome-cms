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
    // The last scale that still disagreed with the tokens. text-xs, text-sm and
    // text-base happened to match, so only three names were ever safe to use; every
    // other one meant a different size here than the --text-* token of the same name
    // (text-xl was 20px against --text-xl's 22px, text-2xl 24px against 40px). Nothing
    // used those names — the mismatch was a trap, not a bug — and now nothing can.
    // Line heights for xs/sm/base are Tailwind's own, unchanged, so the pages that use
    // them do not move; the rest come from the type scale table in DESIGN.md.
    fontSize: {
      xs: ['var(--text-xs)', '1rem'],
      sm: ['var(--text-sm)', '1.25rem'],
      base: ['var(--text-base)', '1.5rem'],
      md: ['var(--text-md)', '1.875rem'],
      xl: ['var(--text-xl)', '1.75rem'],
      '2xl': ['var(--text-2xl)', '3.75rem'],
      '3xl': ['var(--text-3xl)', '3.5rem'],
      '4xl': ['var(--text-4xl)', '4rem'],
    },
    extend: {
      colors: {
        accent: 'var(--color-accent)',
        code: 'var(--color-code-bg)',
        ondark: 'var(--color-on-dark)',
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
      // Fonts resolve to the token scale too — the colours and radii below already do,
      // and a second copy of the stack here is a second thing to remember to change.
      fontFamily: {
        display: ['var(--font-display)'],
        sans: ['var(--font-body)'],
      },
      // Radii resolve to the token scale in src/styles/installer-tokens.css — keep one source.
      borderRadius: {
        md: 'var(--radius-sm)',
        lg: 'var(--radius-input)',
        xl: 'var(--radius-lg)',
        full: 'var(--radius-pill)',
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
            '--tw-prose-pre-code': 'var(--color-on-dark)',
            '--tw-prose-pre-bg': 'var(--color-code-bg)',
            '--tw-prose-th-borders': 'var(--color-rule-strong)',
            '--tw-prose-td-borders': 'var(--color-rule)',
            fontFamily: 'var(--font-body)',
            h2: {
              fontSize: 'var(--text-xl)',
              fontWeight: '700',
              letterSpacing: '-0.25px',
              lineHeight: '28px',
            },
            h3: {
              fontSize: 'var(--text-md)',
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
