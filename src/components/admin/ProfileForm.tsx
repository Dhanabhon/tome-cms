import { useRef, useState, type FormEvent } from 'react';

import type { AuthorLink, PostLocale, SiteSettings } from '../../types/cms';
import { adminCopy, fill } from '../../lib/admin-i18n';
import MediaPicker from './MediaPicker';
import Icon from '../Icon';
import { atLeast } from '../../lib/busy';
import { LINK_SITES, linkNameChoice, type LinkNameChoice } from '../../lib/author-link-names';
import UiSelect from './UiSelect';

interface ProfileFormProps {
  ownerLocale?: PostLocale | null;
  initialAvatarUrl: string | null;
  initialSettings: Pick<SiteSettings,
    'author_avatar_media_id' | 'author_bio_en' | 'author_bio_th' | 'author_links' | 'author_name' | 'updated_at'
  >;
}

interface IssueNode {
  errors?: string[];
  items?: IssueNode[];
  properties?: Record<string, IssueNode>;
}

interface SaveResult {
  error?: string;
  issues?: IssueNode;
  settings?: { updated_at?: string };
}

export default function ProfileForm({ initialAvatarUrl, initialSettings, ownerLocale }: ProfileFormProps) {
  const copy = adminCopy(ownerLocale);
  const avatarButton = useRef<HTMLButtonElement>(null);
  const [authorName, setAuthorName] = useState(initialSettings.author_name);
  const [authorAvatarMediaId, setAuthorAvatarMediaId] = useState(initialSettings.author_avatar_media_id);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [authorBioEn, setAuthorBioEn] = useState(initialSettings.author_bio_en);
  const [authorBioTh, setAuthorBioTh] = useState(initialSettings.author_bio_th);
  const [authorLinks, setAuthorLinks] = useState<AuthorLink[]>(initialSettings.author_links);
  // What each link's list shows. Kept beside the links rather than read from their names, so
  // choosing "Other" for a link named GitHub leaves an empty name to write, not GitHub again.
  const [linkChoices, setLinkChoices] = useState<LinkNameChoice[]>(
    () => initialSettings.author_links.map((link) => linkNameChoice(link.label, copy.profile.linkWebsite)),
  );
  const linkNameOptions = [
    ...LINK_SITES.map((site) => ({ label: site, value: site })),
    { label: copy.profile.linkWebsite, value: 'website' },
    { label: copy.profile.linkOther, value: 'other' },
  ];
  const chooseLinkName = (index: number, choice: LinkNameChoice) => {
    const label = choice === 'website' ? copy.profile.linkWebsite : choice === 'other' ? '' : choice;
    setLinkChoices(linkChoices.map((current, i) => i === index ? choice : current));
    setAuthorLinks(authorLinks.map((item, i) => i === index ? { ...item, label } : item));
  };
  const [updatedAt, setUpdatedAt] = useState(initialSettings.updated_at);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');

  /** Serialised so a link edited and edited back counts as clean, not dirty. */
  const snapshot = (values: Pick<ProfileFormProps['initialSettings'],
    'author_avatar_media_id' | 'author_bio_en' | 'author_bio_th' | 'author_links' | 'author_name'>) =>
    JSON.stringify([values.author_avatar_media_id, values.author_bio_en, values.author_bio_th, values.author_links, values.author_name]);
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshot(initialSettings));
  const currentSnapshot = snapshot({
    author_avatar_media_id: authorAvatarMediaId,
    author_bio_en: authorBioEn,
    author_bio_th: authorBioTh,
    author_links: authorLinks,
    author_name: authorName,
  });
  const dirty = currentSnapshot !== savedSnapshot;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    setFieldErrors({});
    setStatus('');
    try {
      const response = await atLeast(fetch('/api/admin/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authorAvatarMediaId, authorBioEn, authorBioTh, authorLinks, authorName, updatedAt }),
      }));
      const result = await response.json().catch(() => ({})) as SaveResult;
      if (!response.ok) {
        const fields: Record<string, string> = {};
        for (const name of ['authorName', 'authorBioEn', 'authorBioTh', 'authorLinks']) {
          fields[name] = result.issues?.properties?.[name]?.errors?.join(' ') ?? '';
        }
        for (let index = 0; index < authorLinks.length; index++) {
          for (const name of ['label', 'url']) {
            fields[`authorLinks.${index}.${name}`] = result.issues?.properties?.authorLinks?.items?.[index]?.properties?.[name]?.errors?.join(' ') ?? '';
          }
        }
        setFieldErrors(fields);
        throw new Error(result.error ?? copy.profile.saveFailed);
      }
      if (typeof result.settings?.updated_at !== 'string') throw new Error(copy.settings.incompleteResponse);
      setUpdatedAt(result.settings.updated_at);
      setSavedSnapshot(currentSnapshot);
      setStatus(copy.settings.saved);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : copy.profile.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="admin-settings-form" noValidate onSubmit={save} onChange={(event) => {
        setStatus('');
        const name = (event.target as HTMLInputElement).name;
        setFieldErrors((current) => ({ ...current, [name]: '' }));
      }}>
        <fieldset disabled={saving}>
          <div className="admin-card-stack">

            <section className="admin-card" aria-labelledby="profile-identity-heading">
              <header className="admin-card__head">
                <h2 id="profile-identity-heading">{copy.profile.identity}</h2>
                <p>{copy.profile.identityHint}</p>
              </header>
              <div className="profile-identity">
                <span className={avatarUrl ? 'avatar-slot avatar-slot--filled' : 'avatar-slot'}>
                  {avatarUrl ? <img alt="" src={avatarUrl} /> : (
                    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" viewBox="0 0 24 24">
                      <circle cx="12" cy="8.5" r="3.75" />
                      <path d="M4.5 20.5c1.2-3.8 4-5.75 7.5-5.75s6.3 1.95 7.5 5.75" />
                    </svg>
                  )}
                </span>
                <div className="profile-identity__fields">
                  <div className="admin-field admin-field--name">
                    <label htmlFor="authorName">{copy.profile.authorName}</label>
                    <input className="admin-control" id="authorName" name="authorName" aria-invalid={Boolean(fieldErrors.authorName)} aria-describedby="authorName-error" maxLength={120} value={authorName} onChange={(event) => setAuthorName(event.target.value)} />
                    <p className="admin-field-error" id="authorName-error" aria-live="polite">{fieldErrors.authorName}</p>
                  </div>
                  <div className="admin-cover-actions">
                    <button aria-haspopup="dialog" className="admin-button admin-button--secondary" onClick={() => setAvatarPickerOpen(true)} ref={avatarButton} type="button">
                      {avatarUrl ? copy.profile.changeAvatar : copy.profile.chooseAvatar}
                    </button>
                    {avatarUrl && <button aria-label={copy.profile.removeAvatar} className="admin-button admin-button--ghost admin-button--icon profile-avatar-remove" onClick={() => { setAuthorAvatarMediaId(null); setAvatarUrl(null); setStatus(''); }} title={copy.profile.removeAvatar} type="button"><Icon name="trash" /></button>}
                  </div>
                  {!avatarUrl && <p className="admin-hint">{copy.profile.noAvatar}</p>}
                </div>
              </div>
              {avatarPickerOpen && <MediaPicker
                kind="image"
                onCancel={() => setAvatarPickerOpen(false)}
                onSelect={(asset) => {
                  setAuthorAvatarMediaId(asset.id);
                  setAvatarUrl(asset.publicUrl);
                  setAvatarPickerOpen(false);
                  setStatus('');
                }}
                ownerLocale={ownerLocale}
                returnFocus={avatarButton.current}
              />}
            </section>

            <section className="admin-card" aria-labelledby="profile-bio-heading">
              <header className="admin-card__head">
                <h2 id="profile-bio-heading">{copy.profile.bio}</h2>
                <p>{copy.profile.bioHint}</p>
              </header>
              <div className="profile-bios">
                <div className="admin-field">
                  <label htmlFor="authorBioEn">{copy.profile.bio}<span className="lang-chip">{copy.filters.english}</span></label>
                  <textarea className="admin-control admin-control--textarea" id="authorBioEn" name="authorBioEn" aria-invalid={Boolean(fieldErrors.authorBioEn)} aria-describedby="authorBioEn-error" lang="en" maxLength={1000} value={authorBioEn} onChange={(event) => setAuthorBioEn(event.target.value)} />
                  <p className="admin-field-error" id="authorBioEn-error" aria-live="polite">{fieldErrors.authorBioEn}</p>
                </div>
                <div className="admin-field">
                  <label htmlFor="authorBioTh">{copy.profile.bio}<span className="lang-chip">{copy.filters.thai}</span></label>
                  <textarea className="admin-control admin-control--textarea" id="authorBioTh" name="authorBioTh" aria-invalid={Boolean(fieldErrors.authorBioTh)} aria-describedby="authorBioTh-error" lang="th" maxLength={1000} value={authorBioTh} onChange={(event) => setAuthorBioTh(event.target.value)} />
                  <p className="admin-field-error" id="authorBioTh-error" aria-live="polite">{fieldErrors.authorBioTh}</p>
                </div>
              </div>
            </section>

            <section className="admin-card" aria-labelledby="profile-links-heading" aria-describedby="authorLinks-error">
              <header className="admin-card__head">
                <h2 id="profile-links-heading">{copy.profile.links}</h2>
                <p>{copy.profile.linksHint}</p>
              </header>
              <div className="profile-links">
                <p className="admin-field-error" id="authorLinks-error" aria-live="polite">{fieldErrors.authorLinks}</p>
                {!authorLinks.length && <p className="admin-empty-inline">{copy.profile.linksEmpty}</p>}
                {authorLinks.map((link, index) => (
                  <div className={`profile-link${linkChoices[index] === 'other' ? ' profile-link--named' : ''}`} key={index}>
                    <div className="admin-field">
                      <label htmlFor={`authorLinks.${index}.choice`}>{fill(copy.profile.linkLabel, { index: index + 1 })}</label>
                      <UiSelect
                        ariaDescribedBy={`authorLinks.${index}.label-error`}
                        className="admin-control"
                        id={`authorLinks.${index}.choice`}
                        invalid={Boolean(fieldErrors[`authorLinks.${index}.label`])}
                        onValueChange={(value) => chooseLinkName(index, value as LinkNameChoice)}
                        options={linkNameOptions}
                        value={linkChoices[index]}
                      />
                      {linkChoices[index] !== 'other' && <p className="admin-field-error" id={`authorLinks.${index}.label-error`} aria-live="polite">{fieldErrors[`authorLinks.${index}.label`]}</p>}
                    </div>
                    {linkChoices[index] === 'other' && (
                      <div className="admin-field">
                        <label htmlFor={`authorLinks.${index}.label`}>{fill(copy.profile.linkName, { index: index + 1 })}</label>
                        <input className="admin-control" id={`authorLinks.${index}.label`} name={`authorLinks.${index}.label`} aria-invalid={Boolean(fieldErrors[`authorLinks.${index}.label`])} aria-describedby={`authorLinks.${index}.label-error`} maxLength={80} required value={link.label} onChange={(event) => setAuthorLinks(authorLinks.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} />
                        <p className="admin-field-error" id={`authorLinks.${index}.label-error`} aria-live="polite">{fieldErrors[`authorLinks.${index}.label`]}</p>
                      </div>
                    )}
                    <div className="admin-field">
                      <label htmlFor={`authorLinks.${index}.url`}>{fill(copy.profile.linkUrl, { index: index + 1 })}</label>
                      <input className="admin-control" id={`authorLinks.${index}.url`} name={`authorLinks.${index}.url`} aria-invalid={Boolean(fieldErrors[`authorLinks.${index}.url`])} aria-describedby={`authorLinks.${index}.url-error`} type="url" pattern="https?://.*" required value={link.url} onChange={(event) => setAuthorLinks(authorLinks.map((item, i) => i === index ? { ...item, url: event.target.value } : item))} />
                      <p className="admin-field-error" id={`authorLinks.${index}.url-error`} aria-live="polite">{fieldErrors[`authorLinks.${index}.url`]}</p>
                    </div>
                    <button className="admin-button admin-button--danger" type="button" aria-label={fill(copy.profile.removeLink, { index: index + 1 })} onClick={() => { setAuthorLinks(authorLinks.filter((_, i) => i !== index)); setLinkChoices(linkChoices.filter((_, i) => i !== index)); setFieldErrors({}); setStatus(''); }}>{copy.profile.remove}</button>
                  </div>
                ))}
                <button className="admin-button" type="button" disabled={authorLinks.length >= 5} onClick={() => { setAuthorLinks([...authorLinks, { label: copy.profile.linkWebsite, url: '' }]); setLinkChoices([...linkChoices, 'website']); setStatus(''); }}>{copy.profile.addLink}</button>
              </div>
            </section>

          </div>
        </fieldset>
        <p className="admin-form-error" role="alert">{error}</p>
        <div className="admin-save-bar">
          <button aria-busy={saving} className="admin-button admin-button--primary" disabled={saving || !dirty} type="submit">{copy.settings.save}</button>
          <p role="status">{saving ? copy.settings.saving : dirty ? copy.profile.unsaved : status}</p>
        </div>
    </form>
  );
}
