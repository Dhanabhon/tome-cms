import { useState, type FormEvent } from 'react';

import { normalizeAdminPath, safeAdminReturnTo } from '../../lib/admin';
import { adminCopy } from '../../lib/admin-i18n';
import { authClient } from '../../lib/auth-client';
import { describePasskeyException, describePasskeyFailure } from '../../lib/passkey-failure';
import type { PostLocale } from '../../types/cms';

interface PasskeySignInProps {
  adminPath?: string;
  ownerLocale?: PostLocale | null;
  returnTo?: string | null;
}

export default function PasskeySignIn({ adminPath = '/admin', ownerLocale, returnTo }: PasskeySignInProps) {
  const copy = adminCopy(ownerLocale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = normalizeAdminPath(adminPath);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!window.isSecureContext || typeof PublicKeyCredential === 'undefined' || typeof navigator.credentials?.get !== 'function') {
      setError(copy.auth.unsupported);
      return;
    }

    setBusy(true);
    setError('');
    try {
      const result = await authClient.signIn.passkey();
      if (result.error || !result.data) {
        setError(describePasskeyFailure(result, copy, copy.auth.noPasskey, copy.auth.passkeyNotRegistered));
        return;
      }
      window.location.assign(safeAdminReturnTo(returnTo, base));
    } catch (error) {
      setError(describePasskeyException(error, copy, copy.auth.noPasskey));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-auth__form" onSubmit={(event) => void signIn(event)} aria-busy={busy}>
      <p>{copy.auth.passkeyHint}</p>
      <p className="admin-form-error admin-auth__error" role="alert" aria-live="polite">{error}</p>
      <button aria-busy={busy} className="admin-button admin-button--primary admin-auth__submit" disabled={busy} type="submit">
        {busy ? copy.auth.checking : copy.auth.signIn}
      </button>
      <a className="admin-auth-nav__link" href="/recovery">{copy.auth.recoverAccess}</a>
    </form>
  );
}
