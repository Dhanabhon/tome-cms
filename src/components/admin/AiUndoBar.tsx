import { useState } from 'react';

import { fill, type AdminCopy } from '../../lib/admin-i18n';
import { confirmUi } from '../../lib/ui-dialog';

interface AiUndoBarProps {
  cancelLabel: string;
  id: string;
  kind: 'post' | 'page';
  snapshot: { clientName: string; ownerEditedSince: boolean; time: string };
  text: AdminCopy['aiUndo'];
  updatedAt: string;
}

/**
 * Above a draft an AI has changed: who did it and when, and one step back. A reload follows,
 * so the editor opens on what was put back; its own prompt guards anything not yet saved.
 */
export default function AiUndoBar({ cancelLabel, id, kind, snapshot, text, updatedAt }: AiUndoBarProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function putBack() {
    if (busy) return;
    // Always asked: one stray press would throw the AI's work away for good, and the owner's own
    // edits since it too; say which before, not after.
    const message = fill(snapshot.ownerEditedSince ? text.confirmBodyEdited : text.confirmBody, { client: snapshot.clientName });
    if (!(await confirmUi({
      cancelLabel, confirmLabel: text.putBack, message, title: text.confirmTitle, tone: 'danger',
    }))) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/ai-snapshots', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, id, updatedAt }),
      });
      if (response.ok) {
        location.reload();
        return;
      }
      setError(response.status === 409 ? text.stale : text.failed);
    } catch {
      setError(text.failed);
    }
    setBusy(false);
  }

  return (
    <div className="ai-undo" role="status">
      <p>{fill(text.changedBy, { client: snapshot.clientName, time: snapshot.time })}</p>
      <button aria-busy={busy} className="admin-button admin-button--secondary" disabled={busy} onClick={() => void putBack()} type="button">{text.putBack}</button>
      {error && <p className="admin-form-error" role="alert">{error}</p>}
    </div>
  );
}
