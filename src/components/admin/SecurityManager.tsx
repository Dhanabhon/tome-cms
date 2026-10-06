import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { adminCopy, fill, type AdminCopy } from '../../lib/admin-i18n';
import { atLeast } from '../../lib/busy';
import { authClient } from '../../lib/auth-client';
import { describePasskeyException, describePasskeyFailure, describeReauthFailure } from '../../lib/passkey-failure';
import type { PasskeyProvider } from '../../lib/passkey-providers';
import type { PostLocale } from '../../types/cms';
import Icon from '../Icon';

interface PasskeyView {
  id: string;
  name: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  provider: PasskeyProvider | null;
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

function parsePasskeys(value: unknown, copy: AdminCopy): PasskeyView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') return [];
    return [{
      id: item.id,
      name: item.name,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : null,
      lastUsedAt: typeof item.lastUsedAt === 'string' ? item.lastUsedAt : null,
      provider: typeof item.provider === 'string' && Object.hasOwn(copy.security.providers, item.provider) ? item.provider as PasskeyProvider : null,
    }];
  });
}

function formatDate(value: string | null, copy: AdminCopy, locale: PostLocale | null | undefined): string {
  if (!value) return copy.security.never;
  return new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

interface DeviceLink {
  url: string;
  expiresAt: number;
  /** The passkeys there were when the link was made; one not among them is the new device. */
  knownIds: ReadonlySet<string>;
  /** A `data:` URL of the QR code; empty when the QR library could not load. */
  qr: string;
}

/**
 * The QR is the link in black on white, drawn as SVG so it stays sharp at any size. The margin is
 * 16 units: four modules of cellSize 4, the quiet zone a scanner needs. The SVG paints its own white
 * behind it, so the code is dark on white in both themes.
 */
async function qrDataUrl(url: string): Promise<string> {
  try {
    const { default: qrcode } = await import('qrcode-generator');
    const code = qrcode(0, 'M');
    code.addData(url);
    code.make();
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(code.createSvgTag({ cellSize: 4, margin: 16, scalable: true }))}`;
  } catch {
    // The link still works without its picture.
    return '';
  }
}

/** How often the screen asks whether the device a link was made for has come in. */
const DEVICE_LINK_POLL_MS = 3_000;
/** How long the new passkey stays marked; matches the fade in global.css. */
const ARRIVED_MARK_MS = 2_400;

interface SecurityManagerProps {
  ownerLocale?: PostLocale | null;
}

export default function SecurityManager({ ownerLocale }: SecurityManagerProps = {}) {
  const copy = adminCopy(ownerLocale);
  const [passkeys, setPasskeys] = useState<PasskeyView[]>([]);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [newName, setNewName] = useState(copy.security.spareName);
  // Which action is running, so only its own button says so; the others are only disabled.
  const [busy, setBusy] = useState<string | null>(null);
  const pressed = (action: string) => busy === action;
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [message, setMessage] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renameButtons = useRef(new Map<string, HTMLButtonElement>());
  const [missingName, setMissingName] = useState<'add' | 'rename' | null>(null);
  const addField = useRef<HTMLInputElement>(null);
  const [deviceLink, setDeviceLink] = useState<DeviceLink | null>(null);
  // The passkey a device link just brought in, marked in the list for a moment.
  const [arrivedId, setArrivedId] = useState<string | null>(null);
  // How the last link ended, said in its own card, where the owner is looking.
  const [linkOutcome, setLinkOutcome] = useState('');

  /** Renaming closes back onto the button that opened it, so the keyboard keeps its place. */
  const focusRename = (id: string) => requestAnimationFrame(() => renameButtons.current.get(id)?.focus());

  const loadPasskeys = useCallback(async (): Promise<PasskeyView[]> => {
    const response = await fetch('/api/admin/security/passkeys', { headers: { Accept: 'application/json' } });
    const payload = await responsePayload(response);
    if (response.status === 401 || response.status === 403) {
      setNeedsSignIn(true);
      setPasskeys([]);
      return [];
    }
    if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : copy.security.passkeysUnavailable);
    setNeedsSignIn(false);
    const loaded = parsePasskeys(payload.passkeys, copy);
    setPasskeys(loaded);
    return loaded;
  }, []);

  useEffect(() => {
    void loadPasskeys().catch(() => setMessage(copy.security.passkeysTemporarilyUnavailable));
  }, [loadPasskeys]);

  async function signIn() {
    if (busy) return;
    setBusy('sign-in');
    setMessage('');
    try {
      const result = await authClient.signIn.passkey();
      if (result.error || !result.data) {
        setMessage(describeReauthFailure(result, copy, copy.security.noPasskeyAccepted));
        return;
      }
      await loadPasskeys();
    } catch (error) {
      setMessage(describePasskeyException(error, copy, copy.security.noPasskeyAccepted));
    } finally {
      setBusy(null);
    }
  }

  /** An empty name is told in the admin's words, beside the field, and the field takes focus. */
  function nameMissing(form: 'add' | 'rename', field: HTMLInputElement | null) {
    setMissingName(form);
    setMessage(copy.security.nameRequired);
    field?.focus();
  }

  /** Typing a name ends the warning about its absence, and leaves any other message alone. */
  function nameTyped() {
    setMissingName(null);
    setMessage((current) => current === copy.security.nameRequired ? '' : current);
  }

  async function addPasskey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!newName.trim()) return nameMissing('add', addField.current);
    setBusy('add');
    setMessage('');
    try {
      // The server only takes a spare from a session verified in the last few minutes.
      const assertion = await authClient.signIn.passkey();
      if (assertion.error || !assertion.data) {
        setMessage(describeReauthFailure(assertion, copy, copy.security.spareNotAdded));
        return;
      }
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
      setBusy(null);
    }
  }

  async function renamePasskey(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const name = form.get('name');
    if (typeof name !== 'string' || !name.trim()) return nameMissing('rename', event.currentTarget.elements.namedItem('name') as HTMLInputElement | null);
    if (await mutatePasskey('PATCH', { id, name: name.trim() }, copy.security.passkeyRenamed, `rename:${id}`)) {
      setRenamingId(null);
      focusRename(id);
    }
  }

  async function mutatePasskey(method: 'DELETE' | 'PATCH', body: Record<string, string>, successMessage: string, action: string) {
    setBusy(action);
    setMessage('');
    try {
      // As with a spare, the server only renames or deletes for a session verified in the last few minutes.
      const assertion = await authClient.signIn.passkey();
      if (assertion.error || !assertion.data) {
        setMessage(describeReauthFailure(assertion, copy, copy.security.passkeyUpdateFailed));
        return false;
      }
      const response = await atLeast(fetch('/api/admin/security/passkeys', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }));
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : copy.security.passkeyUpdateFailed);
      setMessage(successMessage);
      await loadPasskeys();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : copy.security.passkeyUpdateFailed);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function regenerateCodes() {
    if (busy) return;
    setBusy('codes');
    setMessage('');
    setRecoveryCodes([]);
    try {
      const assertion = await authClient.signIn.passkey();
      if (assertion.error || !assertion.data) throw new Error(describeReauthFailure(assertion, copy, copy.security.codesUnchangedNoPasskey));
      const response = await fetch('/api/admin/security/recovery-codes', { headers: { 'content-type': 'application/json' }, method: 'POST' });
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
      setBusy(null);
    }
  }

  // While a link is showing, the screen watches for the device it was made for. The owner is
  // usually holding that device, so this window keeps its focus and a focus event never comes:
  // it asks again every few seconds while it is on screen, and at once when it comes back.
  useEffect(() => {
    if (!deviceLink) return;
    let settled = false;
    const look = () => {
      if (document.visibilityState !== 'visible') return;
      void loadPasskeys().then((loaded) => {
        const arrived = loaded.find((passkey) => !deviceLink.knownIds.has(passkey.id));
        // A link cancelled or expired while the list was loading is not a device that came in.
        if (settled || !arrived) return;
        settled = true;
        setDeviceLink(null);
        setArrivedId(arrived.id);
        setLinkOutcome(fill(copy.security.deviceAdded, { name: arrived.name }));
      }).catch(() => {
        // The next look tries again; a passing failure should not cover the link with an error.
      });
    };
    const every = window.setInterval(look, DEVICE_LINK_POLL_MS);
    window.addEventListener('focus', look);
    document.addEventListener('visibilitychange', look);
    const expiry = window.setTimeout(() => {
      settled = true;
      setDeviceLink(null);
      setLinkOutcome(copy.security.linkExpired);
    }, Math.max(0, deviceLink.expiresAt - Date.now()));
    return () => {
      settled = true;
      window.clearInterval(every);
      window.removeEventListener('focus', look);
      document.removeEventListener('visibilitychange', look);
      window.clearTimeout(expiry);
    };
  }, [deviceLink, loadPasskeys]);

  // The mark on the new passkey fades with its animation; the class goes after it.
  useEffect(() => {
    if (!arrivedId) return;
    const clear = window.setTimeout(() => setArrivedId(null), ARRIVED_MARK_MS);
    return () => window.clearTimeout(clear);
  }, [arrivedId]);

  async function createLink() {
    if (busy) return;
    setBusy('link');
    setMessage('');
    setLinkOutcome('');
    try {
      // The server only makes a link for a session verified in the last few minutes.
      const assertion = await authClient.signIn.passkey();
      if (assertion.error || !assertion.data) {
        setMessage(describeReauthFailure(assertion, copy, copy.security.linkNotCreated));
        return;
      }
      // Taken from a fresh load, so a list that was stale or not yet loaded cannot make the first
      // look read as a device that came in.
      const knownIds = new Set((await loadPasskeys()).map((passkey) => passkey.id));
      const response = await fetch('/api/admin/security/device-link', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' } });
      const payload = await responsePayload(response);
      // The time left, laid on this device's own clock: the server's clock and this one may differ.
      const expiresAt = typeof payload.expiresInSeconds === 'number' ? Date.now() + payload.expiresInSeconds * 1_000 : Number.NaN;
      if (!response.ok || typeof payload.url !== 'string' || !Number.isFinite(expiresAt)) {
        throw new Error(typeof payload.detail === 'string' ? payload.detail : copy.security.linkNotCreated);
      }
      setDeviceLink({ url: payload.url, expiresAt, knownIds, qr: await qrDataUrl(payload.url) });
    } catch (error) {
      setMessage(describePasskeyException(error, copy, error instanceof Error ? error.message : copy.security.linkNotCreated));
    } finally {
      setBusy(null);
    }
  }

  async function cancelLink() {
    if (busy) return;
    setBusy('cancel');
    setMessage('');
    try {
      const response = await fetch('/api/admin/security/device-link', { method: 'DELETE', headers: { Accept: 'application/json', 'Content-Type': 'application/json' } });
      if (!response.ok) {
        const payload = await responsePayload(response);
        throw new Error(typeof payload.detail === 'string' ? payload.detail : copy.security.linkNotCancelled);
      }
      setDeviceLink(null);
      setLinkOutcome(copy.security.linkCancelled);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : copy.security.linkNotCancelled);
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    if (!deviceLink) return;
    try {
      await navigator.clipboard.writeText(deviceLink.url);
      setMessage(copy.security.linkCopied);
    } catch {
      setMessage(copy.security.copyBlockedLink);
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
      <section className="admin-card" aria-busy={busy !== null}>
        <h2>{copy.security.verifyOwner}</h2>
        <p>{copy.security.verifyHint}</p>
        <div className="security-actions">
          <button aria-busy={pressed('sign-in')} className="admin-button admin-button--primary" disabled={busy !== null} onClick={() => void signIn()} type="button">{copy.security.verifyWithPasskey}</button>
          <a className="admin-button admin-button--secondary" href="/recovery">{copy.security.recoverAccess}</a>
        </div>
        <p className="admin-form-error security-message" role="alert" aria-live="polite">{message}</p>
      </section>
    );
  }

  return (
    <div className="admin-card-stack" aria-busy={busy !== null}>
      <section className="admin-card" aria-labelledby="passkeys-title">
        <header className="admin-card__head">
          <h2 id="passkeys-title">{copy.security.passkeys}</h2>
          <p>{copy.security.keepTwo}</p>
        </header>
        <div className="security-list">
          {passkeys.map((passkey) => (
            <div className={passkey.id === arrivedId ? 'security-key security-key--new' : 'security-key'} key={passkey.id}>
              {renamingId === passkey.id ? (
                <form className="security-key__edit" noValidate onSubmit={(event) => void renamePasskey(event, passkey.id)}>
                  <label className="admin-field">
                    {copy.security.passkeyName}
                    <input aria-invalid={missingName === 'rename' || undefined} autoFocus className="admin-control" defaultValue={passkey.name} maxLength={80} name="name" onChange={() => nameTyped()} required />
                  </label>
                  <button aria-busy={pressed(`rename:${passkey.id}`)} className="admin-button admin-button--secondary" disabled={busy !== null} type="submit">{copy.security.saveName}</button>
                  <button
                    className="admin-button"
                    disabled={busy !== null}
                    onClick={() => { setRenamingId(null); focusRename(passkey.id); }}
                    type="button"
                  >{copy.security.cancelRename}</button>
                </form>
              ) : (
                <>
                  <div className="security-key__head">
                    <span className="security-key__name">{passkey.name}</span>
                    <span className="security-key__meta">{fill(copy.security.created, { created: formatDate(passkey.createdAt, copy, ownerLocale), used: formatDate(passkey.lastUsedAt, copy, ownerLocale) })}</span>
                    {passkey.provider ? <span className="security-key__meta">{copy.security.providers[passkey.provider].name} {'\u2014'} {copy.security.providers[passkey.provider].hint}</span> : null}
                  </div>
                  <div className="security-key__actions">
                    <button
                      aria-label={fill(copy.security.renameLabelFor, { name: passkey.name })}
                      className="admin-button admin-button--ghost admin-button--icon"
                      disabled={busy !== null}
                      onClick={() => { setRenamingId(passkey.id); setMessage(''); }}
                      ref={(button) => { if (button) renameButtons.current.set(passkey.id, button); }}
                      title={fill(copy.security.renameLabelFor, { name: passkey.name })}
                      type="button"
                    ><Icon name="pencil" /></button>
                    <button aria-busy={pressed(`delete:${passkey.id}`)}
                      aria-label={fill(copy.security.deleteLabelFor, { name: passkey.name })}
                      className="admin-button admin-button--ghost admin-button--icon security-key__delete"
                      disabled={busy !== null || passkeys.length < 2}
                      onClick={() => void mutatePasskey('DELETE', { id: passkey.id }, copy.security.passkeyDeleted, `delete:${passkey.id}`)}
                      title={fill(copy.security.deleteLabelFor, { name: passkey.name })}
                      type="button"
                    ><Icon name="trash" /></button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
        <form className="security-add" noValidate onSubmit={(event) => void addPasskey(event)}>
          <label className="admin-field" htmlFor="new-passkey-name">
            {copy.security.newPasskeyName}
            <input aria-invalid={missingName === 'add' || undefined} className="admin-control" id="new-passkey-name" maxLength={80} onChange={(event) => { setNewName(event.target.value); nameTyped(); }} ref={addField} required value={newName} />
          </label>
          <button aria-busy={pressed('add')} className="admin-button admin-button--primary" disabled={busy !== null} type="submit">{copy.security.addSpare}</button>
        </form>
      </section>

      <section className="admin-card" aria-labelledby="device-title">
        <header className="admin-card__head">
          <h2 id="device-title">{copy.security.deviceHeading}</h2>
          <p>{copy.security.deviceHint}</p>
        </header>
        {deviceLink ? (
          <div className="security-link">
            <div className="security-link__row">
              <input aria-label={copy.security.linkLabel} className="admin-control" onFocus={(event) => event.currentTarget.select()} readOnly value={deviceLink.url} />
              <button className="admin-button" onClick={() => void copyLink()} type="button">{copy.security.copyLink}</button>
            </div>
            {deviceLink.qr && <img alt={copy.security.qrAlt} className="security-link__qr" height={240} src={deviceLink.qr} width={240} />}
            <p className="security-link__waiting">{copy.security.waitingForDevice}</p>
            <p className="security-link__meta">{fill(copy.security.linkExpires, { time: new Intl.DateTimeFormat(ownerLocale === 'th' ? 'th-TH' : 'en', { timeStyle: 'short' }).format(deviceLink.expiresAt) })}</p>
            <button aria-busy={pressed('cancel')} className="admin-button admin-button--secondary" disabled={busy !== null} onClick={() => void cancelLink()} type="button">{copy.security.cancelLink}</button>
          </div>
        ) : (
          <button aria-busy={pressed('link')} className="admin-button admin-button--secondary" disabled={busy !== null} onClick={() => void createLink()} type="button">{copy.security.createLink}</button>
        )}
        <p className="security-link__outcome" role="status" aria-live="polite">{linkOutcome}</p>
      </section>

      <section className="admin-card" aria-labelledby="recovery-codes-title">
        <header className="admin-card__head">
          <h2 id="recovery-codes-title">{copy.security.recoveryCodes}</h2>
          <p>{copy.security.regenerateWarning}</p>
        </header>
        <button aria-busy={pressed('codes')} className="admin-button admin-button--secondary" disabled={busy !== null} onClick={() => void regenerateCodes()} type="button">{copy.security.regenerate}</button>
        {recoveryCodes.length > 0 && (
          <div className="security-codes">
            <ol>{recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ol>
            <button className="admin-button" onClick={() => void copyCodes()} type="button">{copy.security.copyCodes}</button>
          </div>
        )}
      </section>

      <p className="admin-form-error security-message" role="status" aria-live="polite">{message}</p>
    </div>
  );
}
