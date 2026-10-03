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

/**
 * Every rule in a stylesheet, with the at-rules it sits inside (`@media (hover: hover)` and so on),
 * outermost first. Comments are dropped first, so a brace in one cannot open a block.
 */
export function cssRules(source: string): Array<{ context: string[]; selector: string; body: string }> {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: Array<{ context: string[]; selector: string; body: string }> = [];
  const stack: string[] = [];
  let prelude = '';
  for (let at = 0; at < css.length; at += 1) {
    const char = css[at];
    if (char === '{') {
      const selector = prelude.trim();
      const close = css.indexOf('}', at);
      const nextOpen = css.indexOf('{', at + 1);
      if (!selector.startsWith('@') && (nextOpen === -1 || nextOpen > close)) {
        found.push({ context: [...stack], selector, body: css.slice(at + 1, close) });
        at = close;
      } else {
        stack.push(selector);
      }
      prelude = '';
    } else if (char === '}') {
      stack.pop();
      prelude = '';
    } else if (char === ';' && !stack.length) {
      prelude = '';
    } else {
      prelude += char;
    }
  }
  return found;
}
