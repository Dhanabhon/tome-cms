import { ADMIN_ICONS, type AdminIconName } from '../../lib/admin-icons';

interface AdminIconProps {
  name: AdminIconName;
}

/**
 * The twin of AdminIcon.astro, for the screens that render in the browser.
 *
 * The paths come from a module constant and never from anything the owner or a visitor
 * typed, which is what makes setting them as HTML safe here -- the same reason the Astro
 * component can use `set:html`. Both renderers are pinned to the same attributes by
 * tests/unit/admin-icons.test.ts.
 */
export default function AdminIcon({ name }: AdminIconProps) {
  return (
    <svg
      aria-hidden="true"
      className="admin-icon"
      dangerouslySetInnerHTML={{ __html: ADMIN_ICONS[name] }}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    />
  );
}
