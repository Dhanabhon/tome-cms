import { BRAND_MARKS, type BrandName } from '../lib/brand-marks';

interface BrandMarkProps {
  name: BrandName;
}

/**
 * Someone else's mark, drawn as they draw it.
 *
 * Unlike Icon, this keeps the fills and the colours it was given: a brand mark recoloured to
 * currentColor is not that brand's mark. The paths come from a module constant and never from
 * anything an owner or a plugin typed, which is what makes setting them as HTML safe here.
 */
export default function BrandMark({ name }: BrandMarkProps) {
  const mark = BRAND_MARKS[name];
  return (
    <svg
      aria-hidden="true"
      className="brand-mark"
      dangerouslySetInnerHTML={{ __html: mark.paths }}
      viewBox={mark.viewBox}
    />
  );
}
