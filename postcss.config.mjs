import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';

/**
 * Tailwind is wired through PostCSS rather than through @astrojs/tailwind.
 *
 * That integration peers on Astro 3 to 5 and was not carried forward, so it could not come
 * with us past Astro 5 -- and it was never more than this file. Tailwind 4 has a Vite plugin
 * too; this is the same place in the same pipeline, so moving from 3 to 4 changed one import.
 *
 * optimize without minify: Tailwind's own Lightning CSS pass still flattens the nesting the
 * typography plugin writes, so the built CSS stays flat as it was, but minifying is left to Vite,
 * which did it before -- once, not twice. A minifier is what once folded animation-timeline into a
 * shorthand Chrome drops.
 *
 * autoprefixer stays: Tailwind's pass covers global.css alone, and the themes' and the installer's
 * sheets still need the prefixes autoprefixer adds, -webkit-mask-image among them.
 */
export default {
  plugins: [tailwindcss({ optimize: { minify: false } }), autoprefixer()],
};
