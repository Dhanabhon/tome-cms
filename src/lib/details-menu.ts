/**
 * The admin's <details> menus: the row menu on Posts and Pages and the File Manager's folder menu.
 * <details> opens and closes itself on its summary, and nothing else; this adds what a menu is
 * expected to do -- close on a press outside, close on Escape with focus back on its button, and
 * be the only one open.
 */
export interface MenuLike { open: boolean; contains(node: unknown): boolean }

export function menusToClose<T extends MenuLike>(menus: readonly T[], target: unknown): T[] {
  return menus.filter((menu) => menu.open && !menu.contains(target));
}

export function wireDetailsMenus(selector: string, doc: Document = document): () => void {
  const menus = () => [...doc.querySelectorAll<HTMLDetailsElement>(selector)];
  const onPointerDown = (event: PointerEvent) => {
    for (const menu of menusToClose(menus(), event.target)) menu.open = false;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    const menu = menus().find((candidate) => candidate.open && candidate.contains(doc.activeElement));
    if (!menu) return;
    menu.open = false;
    menu.querySelector<HTMLElement>('summary')?.focus();
  };
  // toggle does not bubble, so it is listened for in the capture phase.
  const onToggle = (event: Event) => {
    const opened = event.target;
    if (!(opened instanceof HTMLDetailsElement) || !opened.open || !opened.matches(selector)) return;
    for (const menu of menus()) if (menu !== opened) menu.open = false;
  };
  doc.addEventListener('pointerdown', onPointerDown);
  doc.addEventListener('keydown', onKeyDown);
  doc.addEventListener('toggle', onToggle, true);
  return () => {
    doc.removeEventListener('pointerdown', onPointerDown);
    doc.removeEventListener('keydown', onKeyDown);
    doc.removeEventListener('toggle', onToggle, true);
  };
}
