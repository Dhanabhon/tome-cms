import { useState, type FormEvent } from 'react';

import { normalizeAdminPath } from '../../lib/admin';
import { authClient } from '../../lib/auth-client';

interface RecoveryPasskeyProps {
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

export default function RecoveryPasskey({ adminPath = '/admin', initialContext = '' }: RecoveryPasskeyProps) {
  const [code, setCode] = useState('');
  const [context, setContext] = useState(initialContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function register(recoveryContext: string): Promise<boolean> {
    if (!webAuthnAvailable()) {
      setError('Passkeys are not available in this browser. Open this page on a supported device.');
      return false;
    }
    const result = await authClient.passkey.addPasskey({
      context: recoveryContext,
      createSession: true,
      fetchOptions: { headers: { 'X-TomeCMS-Recovery-Context': recoveryContext } },
      name: 'Recovery passkey',
    });
    if (result.error || !result.data) {
      setError('The Passkey was not created. You can retry while this recovery link is valid.');
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
    } catch {
      setError('The Passkey was not created. You can retry while this recovery link is valid.');
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
        setError(typeof payload.detail === 'string' ? payload.detail : 'Recovery could not be started. Check the code and try again.');
        return;
      }
      setContext(nextContext);
      const url = new URL(window.location.href);
      url.search = '';
      url.searchParams.set('context', nextContext);
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
      await register(nextContext);
    } catch {
      setError('Recovery could not be started. Try again later.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="security-stack" aria-busy={busy}>
      {context && (
        <section className="security-card" aria-labelledby="recovery-passkey-title">
          <h2 id="recovery-passkey-title">Create a replacement Passkey</h2>
          <p>Your one-time recovery link is ready. TomeCMS will replace the lost credentials after the new Passkey succeeds.</p>
          <button className="admin-button admin-button--primary" disabled={busy} onClick={() => void continueRecovery()} type="button">
            {busy ? 'Waiting for Passkey…' : 'Create recovery Passkey'}
          </button>
        </section>
      )}

      <form className="security-card security-form" onSubmit={(event) => void startRecovery(event)}>
        <div>
          <h2>Use a recovery code</h2>
          <p>Enter one unused code from the set shown during installation. Each code works once.</p>
        </div>
        <label className="admin-field" htmlFor="recovery-code">
          Recovery code
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
          {busy ? 'Checking code…' : 'Continue securely'}
        </button>
      </form>

      <p className="admin-form-error security-message" role="alert" aria-live="polite">{error}</p>
    </div>
  );
}
