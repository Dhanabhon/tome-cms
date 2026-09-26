// Starlight builds these two modules at run time and ships no types for them. Its own
// LanguageSelect reads both, and so does ours, so they are described here for astro check.
declare module 'virtual:starlight/user-config' {
  const config: import('@astrojs/starlight/types').StarlightConfig;
  export default config;
}

declare module 'virtual:starlight/project-context' {
  const context: { trailingSlash: import('astro').AstroConfig['trailingSlash'] };
  export default context;
}
