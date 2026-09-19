import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { adminCopy, fill, type AdminCopy } from '../../lib/admin-i18n';
import { authClient } from '../../lib/auth-client';
import { describePasskeyException, describePasskeyFailure } from '../../lib/passkey-failure';
import type { PostLocale } from '../../types/cms';
import Icon from '../Icon';

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

function formatDate(value: string | null, copy: AdminCopy, locale: PostLocale | null | undefined): string {
  if (!value) return copy.security.never;
  return new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

interface SecurityManagerProps {
  ownerLocale?: PostLocale | null;
}

export default function SecurityManager({ ownerLocale }: SecurityManagerProps = {}) {
  const copy = adminCopy(ownerLocale);
  const [passkeys, setPasskeys] = useState<PasskeyView[]>([]);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [newName, setNewName] = useState('Spare Passkey');
  const [busy, setBusy] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [message, setMessage] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renameButtons = useRef(new Map<string, HTMLButtonElement>());

  /** Renaming closes back onto the button that opened it, so the keyboard keeps its place. */
  const focusRename = (id: string) => requestAnimationFrame(() => renameButtons.current.get(id)?.focus());

  const loadPasskeys = useCallback(async () => {
    const response = await fetch('/api/admin/security/passkeys', { headers: { Accept: 'application/json' } });
    const payload = await responsePayload(response);
    if (response.status === 401 || response.status === 403) {
      setNeedsSignIn(true);
      setPasskeys([]);
      return;
    }
    if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : copy.security.passkeysUnavailable);
    setNeedsSignIn(false);
    setPasskeys(parsePasskeys(payload.passkeys));
  }, []);

  useEffect(() => {
    void loadPasskeys().catch(() => setMessage(copy.security.passkeysTemporarilyUnavailable));
  }, [loadPasskeys]);

  async function signIn() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await authClient.signIn.passkey();
      if (result.error || !result.data) {
        setMessage(describePasskeyFailure(result, copy, copy.security.noPasskeyAccepted, copy.auth.passkeyNotRegistered));
        return;
      }
      await loadPasskeys();
    } catch (error) {
      setMessage(describePasskeyException(error, copy, copy.security.noPasskeyAccepted));
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
      if (result.error || !result.data) {
        // Adding a spare is the one flow here that does need a session, so 401 means what it says.
        setMessage(describePasskeyFailure(result, copy, copy.security.spareNotAdded, copy.auth.sessionExpired));
        return;
      }
      setMessage(copy.security.spareAdded);
      await loadPasskeys();
    } catch (error) {
      setMessage(describePasskeyException(error, copy, copy.security.spareNotAdded));
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
    if (await mutatePasskey('PATCH', { id, name: name.trim() }, copy.security.passkeyRenamed)) {
      setRenamingId(null);
      focusRename(id);
    }
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
      if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : copy.security.passkeyUpdateFailed);
      setMessage(successMessage);
      await loadPasskeys();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : copy.security.passkeyUpdateFailed);
      return false;
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
      if (assertion.error || !assertion.data) throw new Error(describePasskeyFailure(assertion, copy, copy.security.codesUnchangedNoPasskey, copy.auth.passkeyNotRegistered));
      const response = await fetch('/api/admin/security/recovery-codes', { method: 'POST' });
      const payload = await responsePayload(response);
      const codes = Array.isArray(payload.recoveryCodes)
        ? payload.recoveryCodes.filter((code): code is string => typeof code === 'string')
        : [];
      if (!response.ok || !codes.length) throw new Error(typeof payload.detail === 'string' ? payload.detail : copy.security.codesNotChanged);
      setRecoveryCodes(codes);
      setMessage(copy.security.codesCreated);
    } catch (error) {
      const detail = error instanceof Error ? error.message : copy.security.codesNotChanged;
      setMessage(describePasskeyException(error, copy, detail));
    } finally {
      setBusy(false);
    }
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setMessage(copy.security.codesCopied);
    } catch {
      setMessage(copy.security.copyBlocked);
    }
  }

  if (needsSignIn) {
    return (
      <section className="admin-card" aria-busy={busy}>
        <h2>{copy.security.verifyOwner}</h2>
        <p>{copy.security.verifyHint}</p>
        <div className="security-actions">
          <button aria-busy={busy} className="admin-button admin-button--primary" disabled={busy} onClick={() => void signIn()} type="button">{copy.security.verifyWithPasskey}</button>
          <a className="admin-button admin-button--secondary" href="/recovery">{copy.security.recoverAccess}</a>
        </div>
        <p className="admin-form-error security-message" role="alert" aria-live="polite">{message}</p>
      </section>
    );
  }

  return (
    <div className="admin-card-stack" aria-busy={busy}>
      <section className="admin-card" aria-labelledby="passkeys-title">
        <header className="admin-card__head">
          <h2 id="passkeys-title">{copy.security.passkeys}</h2>
          <p>{copy.security.keepTwo}</p>
        </header>
        <div className="security-list">
          {passkeys.map((passkey) => (
            <div className="security-key" key={passkey.id}>
              {renamingId === passkey.id ? (
                <form className="security-key__edit" onSubmit={(event) => void renamePasskey(event, passkey.id)}>
                  <label className="admin-field">
                    {copy.security.passkeyName}
                    <input autoFocus className="admin-control" defaultValue={passkey.name} maxLength={80} name="name" required />
                  </label>
                  <button aria-busy={busy} className="admin-button admin-button--primary" disabled={busy} type="submit">{copy.security.saveName}</button>
                  <button
                    className="admin-button"
                    disabled={busy}
                    onClick={() => { setRenamingId(null); focusRename(passkey.id); }}
                    type="button"
                  >{copy.security.cancelRename}</button>
                </form>
              ) : (
                <>
                  <div className="security-key__head">
                    <span className="security-key__name">{passkey.name}</span>
                    <span className="security-key__meta">{fill(copy.security.created, { created: formatDate(passkey.createdAt, copy, ownerLocale), used: formatDate(passkey.lastUsedAt, copy, ownerLocale) })}</span>
                  </div>
                  <div className="security-key__actions">
                    <button
                      aria-label={fill(copy.security.renameLabelFor, { name: passkey.name })}
                      className="admin-button admin-button--ghost admin-button--icon"
                      disabled={busy}
                      onClick={() => { setRenamingId(passkey.id); setMessage(''); }}
                      ref={(button) => { if (button) renameButtons.current.set(passkey.id, button); }}
                      title={fill(copy.security.renameLabelFor, { name: passkey.name })}
                      type="button"
                    ><Icon name="pencil" /></button>
                    <button aria-busy={busy}
                      aria-label={fill(copy.security.deleteLabelFor, { name: passkey.name })}
                      className="admin-button admin-button--ghost admin-button--icon security-key__delete"
                      disabled={busy || passkeys.length < 2}
                      onClick={() => void mutatePasskey('DELETE', { id: passkey.id }, copy.security.passkeyDeleted)}
                      title={fill(copy.security.deleteLabelFor, { name: passkey.name })}
                      type="button"
                    ><Icon name="trash" /></button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
        <form className="security-add" onSubmit={(event) => void addPasskey(event)}>
          <label className="admin-field" htmlFor="new-passkey-name">
            {copy.security.newPasskeyName}
            <input className="admin-control" id="new-passkey-name" maxLength={80} onChange={(event) => setNewName(event.target.value)} required value={newName} />
          </label>
          <button aria-busy={busy} className="admin-button admin-button--primary" disabled={busy} type="submit">{copy.security.addSpare}</button>
        </form>
      </section>

      <section className="admin-card" aria-labelledby="recovery-codes-title">
        <header className="admin-card__head">
          <h2 id="recovery-codes-title">{copy.security.recoveryCodes}</h2>
          <p>{copy.security.regenerateWarning}</p>
        </header>
        <button aria-busy={busy} className="admin-button admin-button--secondary" disabled={busy} onClick={() => void regenerateCodes()} type="button">{copy.security.regenerate}</button>
        {recoveryCodes.length > 0 && (
          <div className="security-codes">
            <ol>{recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ol>
            <button aria-busy={busy} className="admin-button" onClick={() => void copyCodes()} type="button">{copy.security.copyCodes}</button>
          </div>
        )}
      </section>

      <p className="admin-form-error security-message" role="status" aria-live="polite">{message}</p>
    </div>
  );
}
