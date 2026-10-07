import { useRef, useState } from 'react';

import { adminCopy, fill, type AdminCopy } from '../../lib/admin-i18n';
import { confirmUi } from '../../lib/ui-dialog';
import type { PostCategorySummary, PostLocale } from '../../types/cms';
import Icon from '../Icon';
import { atLeast } from '../../lib/busy';

interface CategoryManagerProps {
  initialCategories: PostCategorySummary[];
  ownerLocale?: PostLocale | null;
}

function sortCategories(categories: PostCategorySummary[]) {
  return [...categories].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
}

/** A category as its edit form holds it: the name, the address and both descriptions. The default has the name alone. */
interface CategoryEdit {
  id: string;
  isDefault: boolean;
  name: string;
  slug: string;
  descriptionTh: string;
  descriptionEn: string;
}

/** Each description's limit, as the server holds it. */
const DESCRIPTION_LENGTH = 160;

const editOf = (category: PostCategorySummary): CategoryEdit => ({
  id: category.id,
  isDefault: category.is_default,
  name: category.name,
  slug: category.slug,
  descriptionTh: category.description_th,
  descriptionEn: category.description_en,
});

/** Thai has no plural form, so the choice lives in the catalogue rather than in the code. */
function postCountLabel(copy: AdminCopy, count: number) {
  return fill(count === 1 ? copy.categories.postCountOne : copy.categories.postCountMany, { count });
}

export default function CategoryManager({ initialCategories, ownerLocale }: CategoryManagerProps) {
  const copy = adminCopy(ownerLocale);
  const [categories, setCategories] = useState(() => sortCategories(initialCategories));
  const [createName, setCreateName] = useState('');
  const [edit, setEdit] = useState<CategoryEdit | null>(null);
  const [pendingActionIds, setPendingActionIds] = useState<Set<string>>(() => new Set());
  const [liveStatus, setLiveStatus] = useState('');
  const [error, setError] = useState('');
  // Which field an error was about: it is marked, focused, and released as the owner types.
  const [nameMissing, setNameMissing] = useState<'create' | 'rename' | 'slug' | null>(null);
  const createField = useRef<HTMLInputElement>(null);
  const renameField = useRef<HTMLInputElement>(null);
  const slugField = useRef<HTMLInputElement>(null);
  const categoryRevision = useRef(0);
  const renameButtons = useRef(new Map<string, HTMLButtonElement>());

  const focusRename = (id: string) => requestAnimationFrame(() => renameButtons.current.get(id)?.focus());
  const startAction = (id: string) => setPendingActionIds((current) => new Set(current).add(id));
  const finishAction = (id: string) => setPendingActionIds((current) => {
    const next = new Set(current);
    next.delete(id);
    return next;
  });

  async function createCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = createName.trim();
    if (!name) {
      setNameMissing('create');
      setError(copy.categories.nameRequired);
      createField.current?.focus();
      return;
    }
    const actionId = 'create';
    startAction(actionId);
    setError('');
    setNameMissing(null);
    setLiveStatus(fill(copy.categories.creating, { name }));
    try {
      const response = await atLeast(fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }));
      const body = await response.json().catch(() => null) as { category?: PostCategorySummary; code?: string; error?: string } | null;
      if (body?.code === 'name_taken') throw new Error(copy.categories.nameTaken);
      if (body?.code === 'name_reserved') throw new Error(copy.categories.nameReserved);
      if (!response.ok || !body?.category) throw new Error(body?.error || copy.categories.createFailed);
      categoryRevision.current += 1;
      setCategories((current) => sortCategories([...current, body.category!]));
      setCreateName((current) => current === createName ? '' : current);
      setLiveStatus(fill(copy.categories.created, { name: body.category.name }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.categories.createFailed);
      setLiveStatus('');
    } finally {
      finishAction(actionId);
    }
  }

  /** A change to one field of the open form; a field marked for an error is released as the owner types. */
  function changeEdit(change: Partial<CategoryEdit>, field?: 'rename' | 'slug') {
    setEdit((current) => current && { ...current, ...change });
    if (field && nameMissing === field) { setNameMissing(null); setError(''); }
  }

  async function saveCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit) return;
    const id = edit.id;
    const name = edit.name.trim();
    if (!name) {
      setNameMissing('rename');
      setError(copy.categories.nameRequired);
      renameField.current?.focus();
      return;
    }
    const actionId = `rename:${id}`;
    startAction(actionId);
    setError('');
    setNameMissing(null);
    setLiveStatus(fill(copy.categories.saving, { name }));
    try {
      const response = await atLeast(fetch('/api/admin/categories', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(edit.isDefault
          ? { id, name }
          : { id, name, slug: edit.slug, descriptionTh: edit.descriptionTh, descriptionEn: edit.descriptionEn }),
      }));
      const body = await response.json().catch(() => null) as { category?: PostCategorySummary; code?: string; error?: string } | null;
      if (body?.code === 'slug_taken' || body?.code === 'slug_invalid') {
        setNameMissing('slug');
        setError(body.code === 'slug_taken' ? copy.categories.slugTaken : copy.categories.slugInvalid);
        setLiveStatus('');
        // After the form is enabled again: a disabled field takes no focus.
        requestAnimationFrame(() => slugField.current?.focus());
        return;
      }
      if (body?.code === 'name_taken') throw new Error(copy.categories.nameTaken);
      if (body?.code === 'name_reserved') throw new Error(copy.categories.nameReserved);
      if (!response.ok || !body?.category) throw new Error(body?.error || copy.categories.updateFailed);
      categoryRevision.current += 1;
      setCategories((current) => sortCategories(current.map((category) => (
        category.id === id ? { ...category, ...body.category } : category
      ))));
      setEdit((current) => {
        if (current?.id !== id) return current;
        focusRename(id);
        return null;
      });
      setLiveStatus(fill(copy.categories.saved, { name: body.category.name }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.categories.updateFailed);
      setLiveStatus('');
    } finally {
      finishAction(actionId);
    }
  }

  async function deleteCategory(category: PostCategorySummary) {
    const confirmed = await confirmUi({
      title: copy.categories.deleteTitle,
      message: fill(category.postCount === 1 ? copy.categories.deleteOne : copy.categories.deleteMany, {
        count: category.postCount,
        fallback: categories.find(({ is_default }) => is_default)?.name ?? copy.categories.fallbackName,
        name: category.name,
      }),
      confirmLabel: copy.categories.delete,
      cancelLabel: copy.shell.cancel,
      tone: 'danger',
    });
    if (!confirmed) return;

    const actionId = `delete:${category.id}`;
    startAction(actionId);
    setError('');
    setLiveStatus(fill(copy.categories.deleting, { name: category.name }));
    let affectedPosts: number | null = null;
    try {
      const response = await atLeast(fetch('/api/admin/categories', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: category.id }),
      }));
      const body = await response.json().catch(() => null) as { affectedPosts?: number; error?: string } | null;
      if (!response.ok || typeof body?.affectedPosts !== 'number') {
        throw new Error(body?.error || copy.categories.deleteFailed);
      }
      affectedPosts = body.affectedPosts;
      categoryRevision.current += 1;
      setCategories((current) => current.filter(({ id }) => id !== category.id));
      while (true) {
        const refreshRevision = categoryRevision.current;
        const refreshResponse = await fetch('/api/admin/categories');
        const refreshBody = await refreshResponse.json().catch(() => null) as { categories?: PostCategorySummary[]; error?: string } | null;
        if (refreshRevision !== categoryRevision.current) continue;
        if (!refreshResponse.ok || !refreshBody?.categories) {
          throw new Error(refreshBody?.error || copy.categories.refreshFailed);
        }
        setCategories(sortCategories(refreshBody.categories));
        break;
      }
      setLiveStatus(fill(affectedPosts === 1 ? copy.categories.deletedOne : copy.categories.deletedMany,
        { count: affectedPosts, name: category.name }));
    } catch (caught) {
      if (affectedPosts === null) {
        setError(caught instanceof Error ? caught.message : copy.categories.deleteFailed);
        setLiveStatus('');
      } else {
        setError(caught instanceof Error ? caught.message : copy.categories.refreshFailed);
        setLiveStatus(fill(affectedPosts === 1 ? copy.categories.deletedOne : copy.categories.deletedMany,
        { count: affectedPosts, name: category.name }));
      }
    } finally {
      finishAction(actionId);
    }
  }

  return (
    <div className="category-manager" aria-busy={pendingActionIds.size > 0}>
      <p className="category-status" role="status" aria-live="polite">{liveStatus}</p>
      {error && <p className="admin-alert" id="category-error" role="alert">{error}</p>}

      <div className="category-frame">
        <form className="category-create" noValidate onSubmit={createCategory}>
          <label className="admin-field" htmlFor="category-name">
            <span>{copy.categories.nameLabel} <small>{copy.categories.nameHint}</small></span>
            <input
              aria-invalid={nameMissing === 'create' || undefined}
              aria-label={copy.categories.nameLabel}
              className="admin-control"
              id="category-name"
              maxLength={80}
              onChange={(event) => { setCreateName(event.target.value); if (nameMissing === 'create') { setNameMissing(null); setError(''); } }}
              ref={createField}
              required
              type="text"
              value={createName}
            />
          </label>
          <button aria-busy={pendingActionIds.has('create')} className="admin-button admin-button--primary" disabled={pendingActionIds.has('create')} type="submit">
            {copy.categories.create}
          </button>
        </form>

        <ul className="category-list" aria-label={copy.categories.listLabel}>
          {categories.map((category) => {
            const renameAction = `rename:${category.id}`;
            const deleteAction = `delete:${category.id}`;
            return (
              <li className="category-row" key={category.id}>
                {edit?.id === category.id ? (
                  <form className="category-edit" noValidate onSubmit={saveCategory}>
                    <div className="category-edit__fields">
                      <label className="admin-field">
                        <span>{fill(copy.categories.renameNameLabel, { name: category.name })}</span>
                        <input
                          aria-invalid={nameMissing === 'rename' || undefined}
                          autoFocus
                          className="admin-control"
                          disabled={pendingActionIds.has(renameAction)}
                          maxLength={80}
                          onChange={(event) => changeEdit({ name: event.target.value }, 'rename')}
                          ref={renameField}
                          required
                          value={edit.name}
                        />
                      </label>
                      {/* Hints sit outside the labels, so a field is named by its label alone and described by its hint. */}
                      {/* The default category has no page, so it has no address or description to edit. */}
                      {!edit.isDefault && (<>
                      <div className="admin-field">
                        <label className="admin-field">
                          <span>{copy.categories.slugLabel}</span>
                          <input
                            aria-describedby={nameMissing === 'slug' ? 'category-slug-hint category-error' : 'category-slug-hint'}
                            aria-invalid={nameMissing === 'slug' || undefined}
                            autoCapitalize="none"
                            className="admin-control"
                            disabled={pendingActionIds.has(renameAction)}
                            maxLength={160}
                            onChange={(event) => changeEdit({ slug: event.target.value }, 'slug')}
                            ref={slugField}
                            spellCheck={false}
                            value={edit.slug}
                          />
                        </label>
                        <small id="category-slug-hint">{copy.categories.slugHint}</small>
                      </div>
                      <label className="admin-field">
                        <span>{copy.categories.descriptionTh} <small>{edit.descriptionTh.length}/{DESCRIPTION_LENGTH}</small></span>
                        <textarea
                          aria-describedby="category-description-hint"
                          className="admin-control admin-control--textarea"
                          disabled={pendingActionIds.has(renameAction)}
                          lang="th"
                          maxLength={DESCRIPTION_LENGTH}
                          onChange={(event) => changeEdit({ descriptionTh: event.target.value })}
                          value={edit.descriptionTh}
                        />
                      </label>
                      <div className="admin-field">
                        <label className="admin-field">
                          <span>{copy.categories.descriptionEn} <small>{edit.descriptionEn.length}/{DESCRIPTION_LENGTH}</small></span>
                          <textarea
                            aria-describedby="category-description-hint"
                            className="admin-control admin-control--textarea"
                            disabled={pendingActionIds.has(renameAction)}
                            lang="en"
                            maxLength={DESCRIPTION_LENGTH}
                            onChange={(event) => changeEdit({ descriptionEn: event.target.value })}
                            value={edit.descriptionEn}
                          />
                        </label>
                        <small id="category-description-hint">{copy.categories.descriptionHint}</small>
                      </div>
                      </>)}
                    </div>
                    <div className="category-edit-actions">
                      <button aria-busy={pendingActionIds.has(renameAction)} className="admin-button admin-button--secondary" disabled={pendingActionIds.has(renameAction)} type="submit" aria-label={fill(copy.categories.saveLabelFor, { name: edit.name.trim() || copy.categories.fallbackName })}>{copy.categories.save}</button>
                      <button
                        className="admin-button"
                        disabled={pendingActionIds.has(renameAction)}
                        onClick={() => { setEdit(null); setError(''); setNameMissing(null); focusRename(category.id); }}
                        type="button"
                      >
                        {copy.categories.cancelEdit}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="category-row__name">
                      <h2>{category.name}</h2>
                      {category.is_default && <span className="category-default">{copy.categories.defaultTag}</span>}
                    </div>
                    <div className="category-row__meta">
                      <span aria-label={postCountLabel(copy, category.postCount)} className="admin-count">{category.postCount}</span>
                      <div className="category-actions">
                        <button
                          aria-label={fill(copy.categories.editLabelFor, { name: category.name })}
                          className="admin-button admin-button--ghost admin-button--icon"
                          onClick={() => { setEdit(editOf(category)); setError(''); setNameMissing(null); setLiveStatus(''); }}
                          ref={(button) => { if (button) renameButtons.current.set(category.id, button); }}
                          title={fill(copy.categories.editLabelFor, { name: category.name })}
                          type="button"
                        >
                          <Icon name="pencil" />
                        </button>
                        {/* The default category is where posts go when theirs is deleted, so it stays. */}
                        {!category.is_default && (
                          <button
                            aria-busy={pendingActionIds.has(deleteAction)}
                            aria-label={fill(copy.categories.deleteLabelFor, { name: category.name })}
                            className="admin-button admin-button--ghost admin-button--icon category-delete"
                            disabled={pendingActionIds.has(deleteAction)}
                            onClick={() => void deleteCategory(category)}
                            title={fill(copy.categories.deleteLabelFor, { name: category.name })}
                            type="button"
                          >
                            <Icon name="trash" />
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
