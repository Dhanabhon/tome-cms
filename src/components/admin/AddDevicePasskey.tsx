import { useState, type FormEvent } from 'react';

import { adminSignInPath, normalizeAdminPath } from '../../lib/admin';
import { adminCopy } from '../../lib/admin-i18n';
import { authClient } from '../../lib/auth-client';
import { guessDeviceName } from '../../lib/device-name';
import {
  describePasskeyException,
  describePasskeyFailure,
  isExpiredLinkFailure,
  readPasskeyCode,
} from '../../lib/passkey-failure';
import type { PostLocale } from '../../types/cms';

interface AddDevicePasskeyProps {
  ownerLocale?: PostLocale | null;
  adminPath?: string;
  initialContext?: string;
  /** False when the page already found the link dead; the form never shows. */
  usable?: boolean;
}

/** The ways a device link can end without a new passkey, beyond a retryable error. */
type Verdict = 'expired' | 'already-here' | null;

function webAuthnAvailable(): boolean {
  return window.isSecureContext
    && typeof PublicKeyCredential !== 'undefined'
    && typeof navigator.credentials?.create === 'function';
}

export default function AddDevicePasskey({ adminPath = '/admin', initialContext = '', ownerLocale, usable = true }: AddDevicePasskeyProps) {
  const copy = adminCopy(ownerLocale);
  const [name, setName] = useState(() => guessDeviceName(navigator, copy.addDevice.deviceNames));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [verdict, setVerdict] = useState<Verdict>(initialContext && usable ? null : 'expired');
  const safeAdminPath = normalizeAdminPath(adminPath);

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !initialContext) return;
    if (!webAuthnAvailable()) {
      setError(copy.security.unsupportedDevice);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await authClient.passkey.addPasskey({
        context: initialContext,
        createSession: true,
        fetchOptions: { headers: { 'X-TomeCMS-Recovery-Context': initialContext } },
        name: name.trim() || guessDeviceName(navigator, copy.addDevice.deviceNames),
      });
      if (result.error || !result.data) {
        // The browser refuses a second passkey for this site on the same device; that is not a fault.
        if (readPasskeyCode(result) === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') setVerdict('already-here');
        else if (isExpiredLinkFailure(result)) setVerdict('expired');
        else setError(describePasskeyFailure(result, copy, copy.security.passkeyNotCreated, copy.addDevice.linkExpired));
        return;
      }
      window.location.assign(safeAdminPath);
    } catch (thrown) {
      setError(describePasskeyException(thrown, copy, copy.security.passkeyNotCreated));
    } finally {
      setBusy(false);
    }
  }

  if (verdict === 'expired') {
    return (
      <div className="admin-card-stack">
        <p className="admin-form-error security-message" role="alert">{copy.addDevice.linkExpired}</p>
      </div>
    );
  }

  if (verdict === 'already-here') {
    return (
      <div className="admin-card-stack">
        <section className="admin-card">
          <header className="admin-card__head">
            <p role="status">{copy.addDevice.alreadyHere}</p>
          </header>
          <a className="admin-button admin-button--primary" href={adminSignInPath(safeAdminPath)}>{copy.addDevice.signIn}</a>
        </section>
      </div>
    );
  }

  return (
    <div className="admin-card-stack" aria-busy={busy}>
      <form className="admin-card security-form" noValidate onSubmit={(event) => void register(event)}>
        <label className="admin-field" htmlFor="add-device-name">
          {copy.addDevice.nameLabel}
          <input
            autoComplete="off"
            className="admin-control"
            id="add-device-name"
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            type="text"
            value={name}
          />
        </label>
        <button className="admin-button admin-button--primary" disabled={busy} type="submit">
          {busy ? copy.security.waitingForPasskey : copy.addDevice.create}
        </button>
      </form>
      <p className="admin-form-error security-message" role="alert" aria-live="polite">{error}</p>
    </div>
  );
}
