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
  const [status, setStatus] = useState('');
  const pickerTrigger = useRef<HTMLButtonElement>(null);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authorAvatarMediaId, authorBioEn, authorBioTh, authorLinks, authorName }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'The profile could not be saved.');
      setStatus('Saved.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The profile could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <form className="admin-settings-form" onSubmit={save} onChange={() => setStatus('')}>
        <fieldset disabled={saving}>
          <div className="profile-avatar">
            {avatar ? <img src={avatar.publicUrl} alt="Author avatar" width="96" height="96" /> : <span>No avatar selected</span>}
            <div className="admin-form-actions">
              <button className="admin-button" onClick={() => setPickerOpen(true)} ref={pickerTrigger} type="button">Choose avatar</button>
              {authorAvatarMediaId && <button className="admin-button" type="button" onClick={() => { setAvatar(null); setAuthorAvatarMediaId(null); setStatus(''); }}>Remove avatar</button>}
            </div>
          </div>
          <label className="admin-field">Author name<input className="admin-control" maxLength={120} value={authorName} onChange={(event) => setAuthorName(event.target.value)} /></label>
          <label className="admin-field">Bio (English)<textarea className="admin-control admin-control--textarea" lang="en" maxLength={1000} value={authorBioEn} onChange={(event) => setAuthorBioEn(event.target.value)} /></label>
          <label className="admin-field">Bio (Thai)<textarea className="admin-control admin-control--textarea" lang="th" maxLength={1000} value={authorBioTh} onChange={(event) => setAuthorBioTh(event.target.value)} /></label>
          <div className="profile-links">
            <h2>Links</h2>
            <p>Add up to five links.</p>
            {authorLinks.map((link, index) => (
              <div className="profile-link" key={index}>
                <label className="admin-field">Link {index + 1} label<input className="admin-control" maxLength={80} required value={link.label} onChange={(event) => setAuthorLinks(authorLinks.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} /></label>
                <label className="admin-field">Link {index + 1} URL<input className="admin-control" type="url" pattern="https?://.*" title="Use an HTTP or HTTPS URL." required value={link.url} onChange={(event) => setAuthorLinks(authorLinks.map((item, i) => i === index ? { ...item, url: event.target.value } : item))} /></label>
                <button className="admin-button" type="button" aria-label={`Remove link ${index + 1}`} onClick={() => { setAuthorLinks(authorLinks.filter((_, i) => i !== index)); setStatus(''); }}>Remove</button>
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
      {pickerOpen && <MediaPicker returnFocus={pickerTrigger.current} onCancel={() => setPickerOpen(false)} onSelect={(asset) => { setAvatar(asset); setAuthorAvatarMediaId(asset.id); setPickerOpen(false); setStatus(''); }} />}
    </>
  );
}
