import { useState } from 'react';

import type { AdminCopy } from '../../lib/admin-i18n';
import type { ExcerptPurpose } from '../../lib/excerpt-candidates';
import { atLeast } from '../../lib/busy';

/** What the button, the answer and an empty answer say, for each field. */
const LABELS = {
  description: { empty: 'suggestDescriptionEmpty', suggest: 'suggestDescription', use: 'useDescription' },
  excerpt: { empty: 'suggestExcerptEmpty', suggest: 'suggestExcerpt', use: 'useExcerpt' },
} as const;

interface ExcerptSuggestionProps {
  copy: AdminCopy;
  /** Asks for a passage that is not one of `exclude`, the ones already shown. */
  onSuggest: (exclude: readonly string[]) => Promise<string | null>;
  onUse: (excerpt: string) => void;
  /** Which field the passage is for; the card's excerpt unless it says otherwise. */
  purpose?: ExcerptPurpose;
}

/** As many shown passages as a request may name; the server refuses more. */
const MAX_SHOWN = 20;

/**
 * A passage from the article, offered for a field -- the excerpt, or the description -- and
 * never written into it unasked.
 *
 * Shown as a quotation with its own button, because it is the owner's own words and they
 * should be able to read it where it came from before it becomes the line on their card.
 * Offered even when the field already has something in it, and replaces it only on the press.
 * "Another one" names every passage shown since the main button was pressed, so the server
 * leaves them out and the next one is new; when none is left, the round ends and starts over.
 */
export default function ExcerptSuggestion({ copy, onSuggest, onUse, purpose = 'excerpt' }: ExcerptSuggestionProps) {
  const labels = LABELS[purpose];
  const [asking, setAsking] = useState(false);
  // Undefined: not asked. Null: asked, and nothing in the article works on its own.
  const [found, setFound] = useState<string | null | undefined>(undefined);
  // Asked, and not answered -- which is not the same as being told there is nothing.
  const [failed, setFailed] = useState(false);
  // Every passage shown in this round, for "another" to leave out.
  const [shown, setShown] = useState<readonly string[]>([]);
  // Asked for another, and every passage has been shown.
  const [exhausted, setExhausted] = useState(false);

  const ask = (exclude: readonly string[]) => {
    setAsking(true);
    setFound(undefined);
    setFailed(false);
    setExhausted(false);
    void atLeast(onSuggest(exclude))
      .then((passage) => {
        if (passage === null && exclude.length) {
          setShown([]);
          setExhausted(true);
          return;
        }
        setFound(passage);
        setShown(passage ? [...exclude, passage].slice(-MAX_SHOWN) : []);
      })
      .catch(() => setFailed(true))
      .finally(() => setAsking(false));
  };

  return (
    <div className="drawer-suggest">
      <button
        aria-busy={asking}
        className="admin-button admin-button--secondary"
        disabled={asking}
        onClick={() => ask([])}
        type="button"
      >
        {copy.drawer[labels.suggest]}
      </button>
      {/* The words live beside the button, so it keeps its width while it spins. */}
      {asking && <small role="status">{copy.drawer.suggestingExcerpt}</small>}
      {found && (
        <figure className="drawer-suggestion">
          <blockquote>{found}</blockquote>
          <div className="drawer-suggestion__actions">
            <button
              className="admin-chip"
              onClick={() => {
                onUse(found);
                setFound(undefined);
              }}
              type="button"
            >
              {copy.drawer[labels.use]}
            </button>
            <button className="admin-chip" disabled={asking} onClick={() => ask(shown)} type="button">
              {copy.drawer.suggestAnother}
            </button>
          </div>
        </figure>
      )}
      {found === null && <small>{copy.drawer[labels.empty]}</small>}
      {exhausted && <small role="status">{copy.drawer.suggestAnotherEmpty}</small>}
      {failed && <small role="status">{copy.drawer.suggestUnavailable}</small>}
    </div>
  );
}

/** The request both editors make: the draft as it stands, whether or not it has been saved. */
export async function requestExcerpt(
  draft: { contentJson: unknown; locale: string; title: string },
  purpose: ExcerptPurpose,
  exclude: readonly string[] = [],
): Promise<string | null> {
  const response = await fetch('/api/admin/suggest-excerpt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...draft, purpose, exclude }),
  });
  // A failed request is thrown, not returned as null: null means the article was read and
  // had nothing, and the screen says something different for each.
  if (!response.ok) throw new Error(`Suggestion request failed with ${response.status}`);
  const payload = await response.json() as { excerpt?: string | null };
  return payload.excerpt ?? null;
}
