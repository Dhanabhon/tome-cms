import { useState } from 'react';

import type { AdminCopy } from '../../lib/admin-i18n';

interface ExcerptSuggestionProps {
  copy: AdminCopy;
  onSuggest: () => Promise<string | null>;
  onUse: (excerpt: string) => void;
}

/**
 * A line from the article, offered for the excerpt field and never written into it unasked.
 *
 * Shown as a quotation with its own button, because it is the owner's own words and they
 * should be able to read it where it came from before it becomes the line on their card.
 * Offered even when the field already has something in it, and replaces it only on the press.
 */
export default function ExcerptSuggestion({ copy, onSuggest, onUse }: ExcerptSuggestionProps) {
  const [asking, setAsking] = useState(false);
  // Undefined: not asked. Null: asked, and nothing in the article works on its own.
  const [found, setFound] = useState<string | null | undefined>(undefined);

  return (
    <div className="drawer-suggest">
      <button
        className="admin-button admin-button--secondary"
        disabled={asking}
        onClick={() => {
          setAsking(true);
          setFound(undefined);
          void onSuggest()
            .then(setFound)
            .catch(() => setFound(null))
            .finally(() => setAsking(false));
        }}
        type="button"
      >
        {asking ? copy.drawer.suggestingExcerpt : copy.drawer.suggestExcerpt}
      </button>
      {found && (
        <figure className="drawer-suggestion">
          <blockquote>{found}</blockquote>
          <button
            className="admin-chip"
            onClick={() => {
              onUse(found);
              setFound(undefined);
            }}
            type="button"
          >
            {copy.drawer.useExcerpt}
          </button>
        </figure>
      )}
      {found === null && <small>{copy.drawer.suggestExcerptEmpty}</small>}
    </div>
  );
}

/** The request both editors make: the draft as it stands, whether or not it has been saved. */
export async function requestExcerpt(draft: { contentJson: unknown; locale: string; title: string }): Promise<string | null> {
  const response = await fetch('/api/admin/suggest-excerpt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  });
  if (!response.ok) return null;
  const payload = await response.json() as { excerpt?: string | null };
  return payload.excerpt ?? null;
}
