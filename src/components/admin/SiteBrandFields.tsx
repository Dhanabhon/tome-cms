import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';

import type { AdminCopy } from '../../lib/admin-i18n';
import type { SiteBrand } from '../../lib/site-brand';
import Icon from '../Icon';
import { atLeast } from '../../lib/busy';

type Kind = 'icon' | 'logo' | 'logo-dark';
type Action = 'remove' | 'upload';

interface SiteBrandFieldsProps {
  /** Drawn under the logo, for what is about the logo but saved with the form -- the name switch. */
  afterLogo?: ReactNode;
  copy: AdminCopy;
  initialBrand: SiteBrand;
  /** A file applies on the spot; the form is handed the brand and the row's new version. */
  onChange: (brand: SiteBrand, updatedAt: string) => void;
}

const ACCEPT: Record<Kind, string> = {
  icon: 'image/png,image/svg+xml',
  logo: 'image/png,image/jpeg,image/webp,image/svg+xml',
  'logo-dark': 'image/png,image/jpeg,image/webp,image/svg+xml',
};

/** What the server's refusal codes say, in the owner's language. */
const REFUSALS: Record<string, keyof AdminCopy['brand']> = {
  brand_icon_small: 'iconTooSmall',
  brand_svg_unusable: 'svgUnusable',
  brand_too_large: 'tooLarge',
  brand_type: 'typeRefused',
};

/**
 * The site's logo, its dark logo and its icon: each chosen, previewed where it will be seen,
 * and removed. Each applies on its own request, so there is nothing here for Save to lose.
 */
export default function SiteBrandFields({ afterLogo, copy, initialBrand, onChange }: SiteBrandFieldsProps) {
  const [brand, setBrand] = useState(initialBrand);
  const [busy, setBusy] = useState<{ action: Action; kind: Kind } | null>(null);
  const [message, setMessage] = useState<{ failed: boolean; kind: Kind; text: string } | null>(null);
  const inputs = {
    icon: useRef<HTMLInputElement>(null),
    logo: useRef<HTMLInputElement>(null),
    'logo-dark': useRef<HTMLInputElement>(null),
  };
  // Only the control that was pressed says it is working; the others are only disabled.
  const pressed = (kind: Kind, action: Action) => busy?.kind === kind && busy.action === action;

  const send = async (kind: Kind, action: Action, file?: File) => {
    if (busy) return;
    setBusy({ action, kind });
    setMessage(null);
    try {
      const response = await atLeast(fetch(`/api/admin/brand/${kind}`, action === 'upload'
        ? { body: file, headers: { 'content-type': file?.type || 'application/octet-stream' }, method: 'POST' }
        : { method: 'DELETE' }));
      const result = await response.json().catch(() => ({})) as { brand?: SiteBrand; code?: string; updatedAt?: string };
      if (!response.ok || !result.brand || !result.updatedAt) {
        const refusal = result.code ? REFUSALS[result.code] : undefined;
        throw new Error(refusal ? copy.brand[refusal] : action === 'upload' ? copy.brand.uploadFailed : copy.brand.removeFailed);
      }
      setBrand(result.brand);
      onChange(result.brand, result.updatedAt);
      setMessage({ failed: false, kind, text: action === 'upload' ? copy.brand.uploaded : copy.brand.removed });
    } catch (failure) {
      setMessage({ failed: true, kind, text: failure instanceof Error ? failure.message : copy.brand.uploadFailed });
    } finally {
      setBusy(null);
    }
  };

  const chosen = (kind: Kind) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    // Cleared at once, so choosing the same file again after a refusal is a change again.
    event.currentTarget.value = '';
    if (file) void send(kind, 'upload', file);
  };

  const field = (kind: Kind, label: string, hint: string, preview: ReactNode) => (
    <div className="brand-field" data-kind={kind}>
      <div className="brand-field__label"><strong>{label}</strong><small>{hint}</small></div>
      {preview && <div className="brand-field__previews">{preview}</div>}
      <div className="brand-field__actions">
        <input accept={ACCEPT[kind]} aria-label={label} hidden name={`brand-${kind}`} onChange={chosen(kind)} ref={inputs[kind]} type="file" />
        <button aria-busy={pressed(kind, 'upload')} className="admin-button admin-button--secondary" disabled={busy !== null} onClick={() => inputs[kind].current?.click()} type="button">
          {copy.brand.choose}
        </button>
        {preview && (
          <button aria-busy={pressed(kind, 'remove')} className="admin-button admin-button--ghost" disabled={busy !== null} onClick={() => void send(kind, 'remove')} type="button">
            <Icon name="trash" /> {copy.brand.remove}
          </button>
        )}
      </div>
      {message?.kind === kind && (
        <p className={message.failed ? 'admin-field-error' : 'brand-field__status'} role={message.failed ? 'alert' : 'status'}>{message.text}</p>
      )}
    </div>
  );

  return (
    <div className="brand-fields">
      {field('logo', copy.brand.logo, copy.brand.logoHint, brand.logo && <>
        <figure className="brand-preview brand-preview--light"><img alt="" src={brand.logo.url} /></figure>
        {/* Without a dark logo this one is used on the dark theme too, so it is shown there. */}
        {!brand.logoDark && (
          <figure className="brand-preview brand-preview--dark"><img alt="" src={brand.logo.url} /><figcaption>{copy.brand.onDark}</figcaption></figure>
        )}
      </>)}
      {afterLogo}
      {field('logo-dark', copy.brand.logoDark, copy.brand.logoDarkHint, brand.logoDark && (
        <figure className="brand-preview brand-preview--dark"><img alt="" src={brand.logoDark.url} /></figure>
      ))}
      {field('icon', copy.brand.icon, copy.brand.iconHint, brand.icon && (
        <figure className="brand-preview brand-preview--light brand-preview--icon">
          <img alt="" height={32} src={brand.icon.png32} width={32} />
          <img alt="" height={90} src={brand.icon.png180} width={90} />
        </figure>
      ))}
    </div>
  );
}
