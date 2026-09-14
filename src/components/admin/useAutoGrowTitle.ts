import { useLayoutEffect, useRef } from 'react';

/**
 * Keeps a `resize: none` title field tall enough for its own content.
 *
 * Without this the field is a fixed two-row box, so a long title — common in Thai,
 * where the display size leaves room for only a handful of characters per line —
 * scrolls inside the field and the writer cannot see what they typed.
 */
export default function useAutoGrowTitle(value: string) {
  const field = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    // Collapse first: scrollHeight never reports less than the box already occupies.
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  return field;
}
