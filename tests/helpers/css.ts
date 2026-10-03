/**
 * The declarations a Thai page adds for `target`: every rule whose selector is scoped by
 * `:lang(th)` and names it, joined. Empty when there is none, so a missing rule fails the
 * assertion that reads it rather than throwing here.
 */
export function thaiDeclarations(css: string, target: string): string {
  return [...css.matchAll(/([^{};/]*:lang\(th\)[^{};]*)\{([^}]*)\}/g)]
    .filter(([, selector]) => selector.includes(target))
    .map(([, , body]) => body)
    .join(';');
}
