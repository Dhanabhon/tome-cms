import { useState, type FormEvent } from 'react';

import { normalizeAdminPath, safeAdminReturnTo } from '../../lib/admin';
import { authClient } from '../../lib/auth-client';

interface PasskeySignInProps {
  adminPath?: string;
  returnTo?: string | null;
}

export default function PasskeySignIn({ adminPath = '/admin', returnTo }: PasskeySignInProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = normalizeAdminPath(adminPath);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!window.isSecureContext || typeof PublicKeyCredential === 'undefined' || typeof navigator.credentials?.get !== 'function') {
      setError('Passkeys are not supported in this browser. Use a supported browser or recover access.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const result = await authClient.signIn.passkey();
      if (result.error || !result.data) {
        setError('No Passkey was accepted. Try again or recover access.');
        return;
      }
      window.location.assign(safeAdminReturnTo(returnTo, base));
    } catch {
      setError('No Passkey was accepted. Try again or recover access.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-auth__form" onSubmit={(event) => void signIn(event)} aria-busy={busy}>
      <p>Use the Passkey created during setup. TomeCMS does not ask for your email address.</p>
      <p className="admin-form-error admin-auth__error" role="alert" aria-live="polite">{error}</p>
      <button className="admin-button admin-button--primary admin-auth__submit" disabled={busy} type="submit">
        {busy ? 'Checking Passkey…' : 'Sign in with a Passkey'}
      </button>
      <a className="admin-auth-nav__link" href="/recovery">Recover access</a>
    </form>
  );
}
