import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';

/**
 * Tailwind is wired through PostCSS rather than through @astrojs/tailwind.
 *
 * That integration peers on Astro 3 to 5 and was not carried forward, so it could not come
 * with us past Astro 5 -- and it was never more than this file. Tailwind's own config is
 * untouched; only the way Astro is told about it changed.
 */
export default {
  plugins: [tailwindcss(), autoprefixer()],
};
