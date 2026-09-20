import { useEffect, useState, type FormEvent } from 'react';

import { normalizeAdminPath, safeAdminReturnTo } from '../../lib/admin';
import { adminCopy } from '../../lib/admin-i18n';
import { authClient } from '../../lib/auth-client';
import { describePasskeyException, describePasskeyFailure } from '../../lib/passkey-failure';
import type { SignInWidget } from '../../plugins/contract';
import type { PostLocale } from '../../types/cms';

interface PasskeySignInProps {
  adminPath?: string;
  ownerLocale?: PostLocale | null;
  returnTo?: string | null;
  /** What an enabled plugin asked to put in this form, if one did. See src/plugins. */
  widget?: SignInWidget | null;
}

export default function PasskeySignIn({ adminPath = '/admin', ownerLocale, returnTo, widget }: PasskeySignInProps) {
  const copy = adminCopy(ownerLocale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = normalizeAdminPath(adminPath);

  useEffect(() => {
    if (!widget || document.querySelector(`script[src="${widget.script}"]`)) return;
    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = widget.script;
    document.head.append(script);
  }, [widget]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!window.isSecureContext || typeof PublicKeyCredential === 'undefined' || typeof navigator.credentials?.get !== 'function') {
      setError(copy.auth.unsupported);
      return;
    }

    const token = widget ? String(new FormData(event.currentTarget).get(widget.tokenField) ?? '') : '';
    setBusy(true);
    setError('');
    try {
      const result = await authClient.signIn.passkey(
        token ? { fetchOptions: { headers: { 'X-TomeCMS-Plugin-Token': token } } } : undefined,
      );
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
      {widget && (
        <div
          className={widget.container.className}
          {...Object.fromEntries(Object.entries(widget.container.dataset).map(([key, value]) => [`data-${key}`, value]))}
        />
      )}
      <p className="admin-form-error admin-auth__error" role="alert" aria-live="polite">{error}</p>
      <button aria-busy={busy} className="admin-button admin-button--primary admin-auth__submit" disabled={busy} type="submit">
        {busy ? copy.auth.checking : copy.auth.signIn}
      </button>
      <a className="admin-auth-nav__link" href="/recovery">{copy.auth.recoverAccess}</a>
    </form>
  );
}
