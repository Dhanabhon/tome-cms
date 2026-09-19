import { ICONS, type IconName } from '../lib/icons';

interface IconProps {
  name: IconName;
}

/**
 * The twin of Icon.astro, for the screens that render in the browser.
 *
 * The paths come from a module constant and never from anything the owner or a visitor
 * typed, which is what makes setting them as HTML safe here -- the same reason the Astro
 * component can use `set:html`. Both renderers are pinned to the same attributes by
 * tests/unit/icons.test.ts.
 */
export default function Icon({ name }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    />
  );
}
