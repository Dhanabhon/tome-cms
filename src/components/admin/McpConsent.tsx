import { useState } from 'react';

import { adminCopy, fill } from '../../lib/admin-i18n';
import { authClient } from '../../lib/auth-client';
import { describeReauthFailure } from '../../lib/passkey-failure';
import type { PendingSummary } from '../../server/mcp/oauth';
import type { PostLocale } from '../../types/cms';
import BrandMark from '../BrandMark';
import Icon from '../Icon';

interface McpConsentProps {
  ownerLocale?: PostLocale | null;
  requestId: string;
  summary: PendingSummary;
}

/**
 * Whether an AI app may have this site. The host the approval goes back to is the largest thing
 * here, because a client's name is whatever it chose to call itself and the host is not.
 */
export default function McpConsent({ ownerLocale, requestId, summary }: McpConsentProps) {
  const copy = adminCopy(ownerLocale);
  const text = copy.mcp;
  const [write, setWrite] = useState(summary.wantsWrite);
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState('');

  async function answer(allow: boolean) {
    if (busy) return;
    setBusy(allow ? 'allow' : 'deny');
    setError('');
    try {
      if (allow) {
        // A passkey now, not the session from this morning: the server wants one under five minutes old.
        const assertion = await authClient.signIn.passkey();
        if (assertion.error || !assertion.data) {
          setError(describeReauthFailure(assertion, copy, text.failed));
          return;
        }
      }
      const response = await fetch('/api/admin/mcp/consent', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request: requestId, allow, write: allow && write && summary.writeAllowed }),
      });
      const result = await response.json().catch(() => null) as { code?: unknown; redirect?: unknown } | null;
      if (response.ok && typeof result?.redirect === 'string') {
        window.location.assign(result.redirect);
        return;
      }
      setError(result?.code === 'mcp_request_invalid' ? text.expired : text.failed);
    } catch {
      setError(text.failed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="admin-auth-stage mcp-consent">
      <section className="admin-auth-context" aria-labelledby="mcp-consent-host">
        <div>
          <p>{text.sendsTo}</p>
          <p className="mcp-consent__host" id="mcp-consent-host">{summary.redirectIsLoopback ? text.thisComputer : summary.redirectHost}</p>
          {summary.redirectIsLoopback && <p className="mcp-consent__address">{summary.redirectHost}</p>}
          {summary.loopbackOnly && <p className="mcp-consent__warning">{text.loopbackWarning}</p>}
        </div>
      </section>
      <section className="admin-auth-panel" aria-labelledby="mcp-consent-title">
        <header>
          <span aria-hidden="true" className="mcp-consent__mark">
            {summary.brand ? <BrandMark name={summary.brand} /> : <Icon name="system" />}
          </span>
          <h1 id="mcp-consent-title">{fill(text.title, { client: summary.clientName })}</h1>
          {!summary.brand && <p className="mcp-consent__given">{text.nameGiven}</p>}
        </header>
        <fieldset className="mcp-consent__scopes" disabled={busy !== null}>
          <div className="admin-check">
            <label><input checked disabled type="checkbox" /><span>{text.scopeRead}</span></label>
          </div>
          {summary.writeAllowed && (
            <div className="admin-check">
              <label>
                <input aria-describedby="mcp-consent-write-hint" checked={write} onChange={(event) => setWrite(event.target.checked)} type="checkbox" />
                <span>{text.scopeWrite}</span>
              </label>
              <small id="mcp-consent-write-hint">{text.scopeWriteHint}</small>
            </div>
          )}
        </fieldset>
        {error && <p className="admin-alert" role="alert">{error}</p>}
        <div className="mcp-consent__actions">
          <button aria-busy={busy === 'allow'} className="admin-button admin-button--primary" disabled={busy !== null} onClick={() => void answer(true)} type="button">{text.allow}</button>
          <button aria-busy={busy === 'deny'} className="admin-button admin-button--secondary" disabled={busy !== null} onClick={() => void answer(false)} type="button">{text.deny}</button>
        </div>
      </section>
    </div>
  );
}
