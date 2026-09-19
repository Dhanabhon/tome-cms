import { useState, type FormEvent } from 'react';

import { normalizeAdminPath } from '../../lib/admin';
import { adminCopy } from '../../lib/admin-i18n';
import { authClient } from '../../lib/auth-client';
import { describePasskeyException, describePasskeyFailure } from '../../lib/passkey-failure';
import type { PostLocale } from '../../types/cms';

interface RecoveryPasskeyProps {
  ownerLocale?: PostLocale | null;
  adminPath?: string;
  initialContext?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function webAuthnAvailable(): boolean {
  return window.isSecureContext
    && typeof PublicKeyCredential !== 'undefined'
    && typeof navigator.credentials?.create === 'function';
}

export default function RecoveryPasskey({ adminPath = '/admin', initialContext = '', ownerLocale }: RecoveryPasskeyProps) {
  const copy = adminCopy(ownerLocale);
  const [code, setCode] = useState('');
  const [context, setContext] = useState(initialContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function register(recoveryContext: string): Promise<boolean> {
    if (!webAuthnAvailable()) {
      setError(copy.security.unsupportedDevice);
      return false;
    }
    const result = await authClient.passkey.addPasskey({
      context: recoveryContext,
      createSession: true,
      fetchOptions: { headers: { 'X-TomeCMS-Recovery-Context': recoveryContext } },
      name: 'Recovery passkey',
    });
    if (result.error || !result.data) {
      setError(describePasskeyFailure(result, copy, copy.security.passkeyNotCreated, copy.auth.sessionExpired));
      return false;
    }
    window.location.assign(normalizeAdminPath(adminPath));
    return true;
  }

  async function continueRecovery() {
    if (!context || busy) return;
    setBusy(true);
    setError('');
    try {
      await register(context);
    } catch (error) {
      setError(describePasskeyException(error, copy, copy.security.passkeyNotCreated));
    } finally {
      setBusy(false);
    }
  }

  async function startRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/recovery/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const payload = await responsePayload(response);
      const nextContext = typeof payload.context === 'string' ? payload.context : '';
      if (!response.ok || !nextContext) {
        setError(typeof payload.detail === 'string' ? payload.detail : copy.security.recoveryNotStarted);
        return;
      }
      setContext(nextContext);
      const url = new URL(window.location.href);
      url.search = '';
      url.searchParams.set('context', nextContext);
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
      await register(nextContext);
    } catch {
      setError(copy.security.recoveryNotStartedLater);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-card-stack" aria-busy={busy}>
      {context && (
        <section className="admin-card" aria-labelledby="recovery-passkey-title">
          <header className="admin-card__head">
            <h2 id="recovery-passkey-title">{copy.security.replacementPasskey}</h2>
            <p>{copy.security.recoveryLinkReady}</p>
          </header>
          <button className="admin-button admin-button--primary" disabled={busy} onClick={() => void continueRecovery()} type="button">
            {busy ? copy.security.waitingForPasskey : copy.security.createRecoveryPasskey}
          </button>
        </section>
      )}

      <form className="admin-card security-form" onSubmit={(event) => void startRecovery(event)}>
        <header className="admin-card__head">
          <h2>{copy.security.useRecoveryCode}</h2>
          <p>{copy.security.useRecoveryCodeHint}</p>
        </header>
        <label className="admin-field" htmlFor="recovery-code">
          {copy.security.codeLabel}
          <input
            className="admin-control"
            id="recovery-code"
            maxLength={128}
            onChange={(event) => setCode(event.target.value)}
            required
            spellCheck={false}
            type="text"
            value={code}
            autoComplete="one-time-code"
          />
        </label>
        <button className="admin-button admin-button--primary" disabled={busy || !code.trim()} type="submit">
          {busy ? copy.security.checkingCode : copy.security.continueSecurely}
        </button>
      </form>

      <p className="admin-form-error security-message" role="alert" aria-live="polite">{error}</p>
    </div>
  );
}
