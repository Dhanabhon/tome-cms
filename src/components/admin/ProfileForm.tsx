import { useRef, useState, type FormEvent } from 'react';

import type { AuthorLink, MediaAsset, SiteSettings } from '../../types/cms';
import MediaPicker from './MediaPicker';

interface ProfileFormProps {
  initialAvatar?: MediaAsset | null;
  initialSettings: Pick<SiteSettings,
    'author_avatar_media_id' | 'author_bio_en' | 'author_bio_th' | 'author_links' | 'author_name'
  >;
}

export default function ProfileForm({ initialAvatar = null, initialSettings }: ProfileFormProps) {
  const [authorName, setAuthorName] = useState(initialSettings.author_name);
  const [authorBioEn, setAuthorBioEn] = useState(initialSettings.author_bio_en);
  const [authorBioTh, setAuthorBioTh] = useState(initialSettings.author_bio_th);
  const [authorLinks, setAuthorLinks] = useState<AuthorLink[]>(initialSettings.author_links);
  const [authorAvatarMediaId, setAuthorAvatarMediaId] = useState(initialSettings.author_avatar_media_id);
  const [avatar, setAvatar] = useState(initialAvatar);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const pickerTrigger = useRef<HTMLButtonElement>(null);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    setFieldErrors({});
    setStatus('');
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authorAvatarMediaId, authorBioEn, authorBioTh, authorLinks, authorName }),
      });
      const result = await response.json();
      if (!response.ok) {
        const fields: Record<string, string> = {};
        for (const name of ['authorName', 'authorBioEn', 'authorBioTh', 'authorAvatarMediaId', 'authorLinks']) {
          fields[name] = result.issues?.properties?.[name]?.errors?.join(' ') ?? '';
        }
        for (let index = 0; index < authorLinks.length; index++) {
          for (const name of ['label', 'url']) {
            fields[`authorLinks.${index}.${name}`] = result.issues?.properties?.authorLinks?.items?.[index]?.properties?.[name]?.errors?.join(' ') ?? '';
          }
        }
        setFieldErrors(fields);
        throw new Error(result.error ?? 'The profile could not be saved.');
      }
      setStatus('Saved.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The profile could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <form className="admin-settings-form" noValidate onSubmit={save} onChange={(event) => {
        setStatus('');
        const name = (event.target as HTMLInputElement).name;
        setFieldErrors((current) => ({ ...current, [name]: '' }));
      }}>
        <fieldset disabled={saving}>
          <div className="profile-avatar">
            {avatar ? <img src={avatar.publicUrl} alt="Author avatar" width="96" height="96" /> : <span>No avatar selected</span>}
            <div className="admin-form-actions">
              <button className="admin-button" onClick={() => setPickerOpen(true)} ref={pickerTrigger} type="button" aria-invalid={Boolean(fieldErrors.authorAvatarMediaId)} aria-describedby="authorAvatarMediaId-error">Choose avatar</button>
              {authorAvatarMediaId && <button className="admin-button" type="button" onClick={() => { setAvatar(null); setAuthorAvatarMediaId(null); setFieldErrors((current) => ({ ...current, authorAvatarMediaId: '' })); setStatus(''); }}>Remove avatar</button>}
            </div>
            <p className="admin-field-error" id="authorAvatarMediaId-error" aria-live="polite">{fieldErrors.authorAvatarMediaId}</p>
          </div>
          <div className="admin-field">
            <label htmlFor="authorName">Author name</label>
            <input className="admin-control" id="authorName" name="authorName" aria-invalid={Boolean(fieldErrors.authorName)} aria-describedby="authorName-error" maxLength={120} value={authorName} onChange={(event) => setAuthorName(event.target.value)} />
            <p className="admin-field-error" id="authorName-error" aria-live="polite">{fieldErrors.authorName}</p>
          </div>
          <div className="admin-field">
            <label htmlFor="authorBioEn">Bio (English)</label>
            <textarea className="admin-control admin-control--textarea" id="authorBioEn" name="authorBioEn" aria-invalid={Boolean(fieldErrors.authorBioEn)} aria-describedby="authorBioEn-error" lang="en" maxLength={1000} value={authorBioEn} onChange={(event) => setAuthorBioEn(event.target.value)} />
            <p className="admin-field-error" id="authorBioEn-error" aria-live="polite">{fieldErrors.authorBioEn}</p>
          </div>
          <div className="admin-field">
            <label htmlFor="authorBioTh">Bio (Thai)</label>
            <textarea className="admin-control admin-control--textarea" id="authorBioTh" name="authorBioTh" aria-invalid={Boolean(fieldErrors.authorBioTh)} aria-describedby="authorBioTh-error" lang="th" maxLength={1000} value={authorBioTh} onChange={(event) => setAuthorBioTh(event.target.value)} />
            <p className="admin-field-error" id="authorBioTh-error" aria-live="polite">{fieldErrors.authorBioTh}</p>
          </div>
          <div className="profile-links" role="group" aria-labelledby="profile-links-heading" aria-describedby="authorLinks-error">
            <h2 id="profile-links-heading">Links</h2>
            <p>Add up to five links.</p>
            <p className="admin-field-error" id="authorLinks-error" aria-live="polite">{fieldErrors.authorLinks}</p>
            {authorLinks.map((link, index) => (
              <div className="profile-link" key={index}>
                <div className="admin-field">
                  <label htmlFor={`authorLinks.${index}.label`}>Link {index + 1} label</label>
                  <input className="admin-control" id={`authorLinks.${index}.label`} name={`authorLinks.${index}.label`} aria-invalid={Boolean(fieldErrors[`authorLinks.${index}.label`])} aria-describedby={`authorLinks.${index}.label-error`} maxLength={80} required value={link.label} onChange={(event) => setAuthorLinks(authorLinks.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} />
                  <p className="admin-field-error" id={`authorLinks.${index}.label-error`} aria-live="polite">{fieldErrors[`authorLinks.${index}.label`]}</p>
                </div>
                <div className="admin-field">
                  <label htmlFor={`authorLinks.${index}.url`}>Link {index + 1} URL</label>
                  <input className="admin-control" id={`authorLinks.${index}.url`} name={`authorLinks.${index}.url`} aria-invalid={Boolean(fieldErrors[`authorLinks.${index}.url`])} aria-describedby={`authorLinks.${index}.url-error`} type="url" pattern="https?://.*" required value={link.url} onChange={(event) => setAuthorLinks(authorLinks.map((item, i) => i === index ? { ...item, url: event.target.value } : item))} />
                  <p className="admin-field-error" id={`authorLinks.${index}.url-error`} aria-live="polite">{fieldErrors[`authorLinks.${index}.url`]}</p>
                </div>
                <button className="admin-button" type="button" aria-label={`Remove link ${index + 1}`} onClick={() => { setAuthorLinks(authorLinks.filter((_, i) => i !== index)); setFieldErrors({}); setStatus(''); }}>Remove</button>
              </div>
            ))}
            <button className="admin-button" type="button" disabled={authorLinks.length >= 5} onClick={() => { setAuthorLinks([...authorLinks, { label: '', url: '' }]); setStatus(''); }}>Add link</button>
          </div>
        </fieldset>
        <p className="admin-form-error" role="alert">{error}</p>
        <div className="admin-form-actions">
          <button className="admin-button admin-button--primary" disabled={saving} type="submit">{saving ? 'Saving…' : 'Save'}</button>
          <p role="status">{status}</p>
        </div>
      </form>
      {pickerOpen && <MediaPicker returnFocus={pickerTrigger.current} onCancel={() => setPickerOpen(false)} onSelect={(asset) => { setAvatar(asset); setAuthorAvatarMediaId(asset.id); setFieldErrors((current) => ({ ...current, authorAvatarMediaId: '' })); setPickerOpen(false); setStatus(''); }} />}
    </>
  );
}
