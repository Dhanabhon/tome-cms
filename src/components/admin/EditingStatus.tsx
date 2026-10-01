import { useEffect, useRef, useState } from 'react';

import { fill, type AdminCopy } from '../../lib/admin-i18n';
import type { BrandName } from '../../lib/brand-marks';
import { EDITING_POLL_MS, EDITOR_SAVED_EVENT, oneAtATime, relativeTime, shouldBeat, undoBarTellsOf } from '../../lib/editing-poll';
import type { PostLocale } from '../../types/cms';
import BrandMark from '../BrandMark';
import Icon from '../Icon';

interface EditingStatusProps {
  id: string;
  kind: 'post' | 'page';
  locale: PostLocale | null | undefined;
  text: AdminCopy['editing'];
  /** The app the AI undo bar above names, when the page shows one. */
  undoClient: string | null;
  updatedAt: string;
}

interface Answer {
  ai: { clientName: string; brand: BrandName | null; action: 'read' | 'write'; at: string } | null;
  newer: boolean;
}

/**
 * Above an open draft: which AI app read or changed it lately, and whether it was changed
 * elsewhere. Each check is also the editor's heartbeat, which keeps an AI from writing the draft
 * while the owner has it open; a hidden tab stops checking, and so lets go of it.
 */
export default function EditingStatus({ id, kind, locale, text, undoClient, updatedAt }: EditingStatusProps) {
  // The version the editor holds, moved on by each save the editor makes.
  const held = useRef(updatedAt);
  const [answer, setAnswer] = useState<Answer & { now: number }>({ ai: null, newer: false, now: 0 });

  useEffect(() => {
    let stopped = false;
    const check = oneAtATime(async () => {
      if (!shouldBeat(document.visibilityState)) return;
      const sent = held.current;
      try {
        const response = await fetch('/api/admin/editing', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind, id, updatedAt: sent }),
          // A hung request would hold the guard, and the draft would stop being held as the owner's.
          signal: AbortSignal.timeout(EDITING_POLL_MS),
        });
        if (!response.ok || stopped) return;
        const next = await response.json() as Answer;
        // A save of the editor's own that landed meanwhile makes "newer" about a copy it no longer holds.
        setAnswer({ ai: next.ai, newer: next.newer && held.current === sent, now: Date.now() });
      } catch {
        // Offline for a moment: the next check tries again.
      }
    });
    function saved(event: Event) {
      held.current = (event as CustomEvent<string>).detail;
      // The save went through the version check, so the editor now holds the latest.
      setAnswer((current) => ({ ...current, newer: false }));
    }
    function shown() {
      void check();
    }
    void check();
    const timer = window.setInterval(() => void check(), EDITING_POLL_MS);
    document.addEventListener('visibilitychange', shown);
    window.addEventListener(EDITOR_SAVED_EVENT, saved);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', shown);
      window.removeEventListener(EDITOR_SAVED_EVENT, saved);
    };
  }, [id, kind]);

  const { ai, newer, now } = answer;
  // A write the undo bar already tells of is not said twice: only that the owner comes first.
  const told = undoBarTellsOf(ai, undoClient);
  // The live region stays in the page while empty, so what appears in it is announced.
  return (
    <div role="status">
      {(ai || newer) && (
        <div className="editing-status">
          {ai && (
            <p className="editing-status__ai">
              <span aria-hidden="true" className="editing-status__mark">{ai.brand ? <BrandMark name={ai.brand} /> : <Icon name="system" />}</span>
              <span>
                {told ? text.youFirst : `${fill(ai.action === 'read' ? text.read : text.wrote, { client: ai.clientName, when: relativeTime(ai.at, now, locale) })} ${text.youFirst}`}
              </span>
            </p>
          )}
          {newer && (
            <p className="editing-status__newer">
              <span>{text.newer}</span>
              <button className="admin-button admin-button--secondary" onClick={() => location.reload()} type="button">{text.loadLatest}</button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
