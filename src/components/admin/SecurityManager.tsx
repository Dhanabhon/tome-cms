import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { authClient } from '../../lib/auth-client';

interface PasskeyView {
  id: string;
  name: string;
  createdAt: string | null;
  lastUsedAt: string | null;
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

function parsePasskeys(value: unknown): PasskeyView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') return [];
    return [{
      id: item.id,
      name: item.name,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : null,
      lastUsedAt: typeof item.lastUsedAt === 'string' ? item.lastUsedAt : null,
    }];
  });
}

function formatDate(value: string | null): string {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Never';
}

export default function SecurityManager() {
  const [passkeys, setPasskeys] = useState<PasskeyView[]>([]);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [newName, setNewName] = useState('Spare Passkey');
  const [busy, setBusy] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [message, setMessage] = useState('');

  const loadPasskeys = useCallback(async () => {
    const response = await fetch('/api/admin/security/passkeys', { headers: { Accept: 'application/json' } });
    const payload = await responsePayload(response);
    if (response.status === 401 || response.status === 403) {
      setNeedsSignIn(true);
      setPasskeys([]);
      return;
    }
    if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : 'Passkeys are unavailable.');
    setNeedsSignIn(false);
    setPasskeys(parsePasskeys(payload.passkeys));
  }, []);

  useEffect(() => {
    void loadPasskeys().catch(() => setMessage('Passkeys are temporarily unavailable.'));
  }, [loadPasskeys]);

  async function signIn() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await authClient.signIn.passkey();
      if (result.error || !result.data) throw new Error();
      await loadPasskeys();
    } catch {
      setMessage('No Passkey was accepted. Try again or use account recovery.');
    } finally {
      setBusy(false);
    }
  }

  async function addPasskey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !newName.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await authClient.passkey.addPasskey({ name: newName.trim() });
      if (result.error || !result.data) throw new Error();
      setMessage('Spare Passkey added.');
      await loadPasskeys();
    } catch {
      setMessage('The spare Passkey was not added. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function renamePasskey(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const name = form.get('name');
    if (typeof name !== 'string' || !name.trim()) return;
    await mutatePasskey('PATCH', { id, name: name.trim() }, 'Passkey renamed.');
  }

  async function mutatePasskey(method: 'DELETE' | 'PATCH', body: Record<string, string>, successMessage: string) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/security/passkeys', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : 'Passkey update failed.');
      setMessage(successMessage);
      await loadPasskeys();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Passkey update failed.');
    } finally {
      setBusy(false);
    }
  }

  async function regenerateCodes() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    setRecoveryCodes([]);
    try {
      const assertion = await authClient.signIn.passkey();
      if (assertion.error || !assertion.data) throw new Error('No Passkey was accepted. Recovery codes were not changed.');
      const response = await fetch('/api/admin/security/recovery-codes', { method: 'POST' });
      const payload = await responsePayload(response);
      const codes = Array.isArray(payload.recoveryCodes)
        ? payload.recoveryCodes.filter((code): code is string => typeof code === 'string')
        : [];
      if (!response.ok || !codes.length) throw new Error(typeof payload.detail === 'string' ? payload.detail : 'Recovery codes were not changed.');
      setRecoveryCodes(codes);
      setMessage('New recovery codes created. Save them now; they will not be shown again.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Recovery codes were not changed.');
    } finally {
      setBusy(false);
    }
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setMessage('Recovery codes copied.');
    } catch {
      setMessage('Copy was blocked. Select and save the codes manually.');
    }
  }

  if (needsSignIn) {
    return (
      <section className="security-card" aria-busy={busy}>
        <h2>Verify the TomeCMS owner</h2>
        <p>Use an existing Passkey before managing credentials and recovery codes.</p>
        <div className="security-actions">
          <button className="admin-button admin-button--primary" disabled={busy} onClick={() => void signIn()} type="button">Verify with Passkey</button>
          <a className="admin-button admin-button--secondary" href="/recovery">Recover access</a>
        </div>
        <p className="admin-form-error security-message" role="alert" aria-live="polite">{message}</p>
      </section>
    );
  }

  return (
    <div className="security-stack" aria-busy={busy}>
      <section className="security-card" aria-labelledby="passkeys-title">
        <div>
          <h2 id="passkeys-title">Passkeys</h2>
          <p>Keep at least two Passkeys on different devices so one loss does not lock you out.</p>
        </div>
        <div className="security-list">
          {passkeys.map((passkey) => (
            <form className="security-key" key={passkey.id} onSubmit={(event) => void renamePasskey(event, passkey.id)}>
              <label className="admin-field">
                Passkey name
                <input className="admin-control" defaultValue={passkey.name} maxLength={80} name="name" required />
              </label>
              <p>Created {formatDate(passkey.createdAt)} · Last used {formatDate(passkey.lastUsedAt)}</p>
              <div className="security-actions">
                <button className="admin-button admin-button--secondary" disabled={busy} type="submit">Save name</button>
                <button
                  className="admin-button"
                  disabled={busy || passkeys.length < 2}
                  onClick={() => void mutatePasskey('DELETE', { id: passkey.id }, 'Passkey deleted.')}
                  type="button"
                >Delete</button>
              </div>
            </form>
          ))}
        </div>
        <form className="security-form" onSubmit={(event) => void addPasskey(event)}>
          <label className="admin-field" htmlFor="new-passkey-name">
            New Passkey name
            <input className="admin-control" id="new-passkey-name" maxLength={80} onChange={(event) => setNewName(event.target.value)} required value={newName} />
          </label>
          <button className="admin-button admin-button--primary" disabled={busy} type="submit">Add spare Passkey</button>
        </form>
      </section>

      <section className="security-card" aria-labelledby="recovery-codes-title">
        <div>
          <h2 id="recovery-codes-title">Recovery codes</h2>
          <p>Creating a new set immediately invalidates every unused code in the previous set.</p>
        </div>
        <button className="admin-button admin-button--secondary" disabled={busy} onClick={() => void regenerateCodes()} type="button">Verify and create new codes</button>
        {recoveryCodes.length > 0 && (
          <div className="security-codes">
            <ol>{recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ol>
            <button className="admin-button" onClick={() => void copyCodes()} type="button">Copy codes</button>
          </div>
        )}
      </section>

      <p className="admin-form-error security-message" role="status" aria-live="polite">{message}</p>
    </div>
  );
}
