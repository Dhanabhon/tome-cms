import { useRef, useState } from 'react';

import { adminCopy, fill, type AdminCopy } from '../../lib/admin-i18n';
import { confirmUi } from '../../lib/ui-dialog';
import type { PostCategorySummary, PostLocale } from '../../types/cms';

interface CategoryManagerProps {
  initialCategories: PostCategorySummary[];
  ownerLocale?: PostLocale | null;
}

function sortCategories(categories: PostCategorySummary[]) {
  return [...categories].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
}

/** Thai has no plural form, so the choice lives in the catalogue rather than in the code. */
function postCountLabel(copy: AdminCopy, count: number) {
  return fill(count === 1 ? copy.categories.postCountOne : copy.categories.postCountMany, { count });
}

export default function CategoryManager({ initialCategories, ownerLocale }: CategoryManagerProps) {
  const copy = adminCopy(ownerLocale);
  const [categories, setCategories] = useState(() => sortCategories(initialCategories));
  const [createName, setCreateName] = useState('');
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  const [pendingActionIds, setPendingActionIds] = useState<Set<string>>(() => new Set());
  const [liveStatus, setLiveStatus] = useState('');
  const [error, setError] = useState('');
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
    if (!name) return setError(copy.categories.nameRequired);
    const actionId = 'create';
    startAction(actionId);
    setError('');
    setLiveStatus(`Creating “${name}”…`);
    try {
      const response = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await response.json().catch(() => null) as { category?: PostCategorySummary; error?: string } | null;
      if (!response.ok || !body?.category) throw new Error(body?.error || copy.categories.createFailed);
      categoryRevision.current += 1;
      setCategories((current) => sortCategories([...current, body.category!]));
      setCreateName((current) => current === createName ? '' : current);
      setLiveStatus(`Category “${body.category.name}” created.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.categories.createFailed);
      setLiveStatus('');
    } finally {
      finishAction(actionId);
    }
  }

  async function renameCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit) return;
    const id = edit.id;
    const name = edit.name.trim();
    if (!name) return setError(copy.categories.nameRequired);
    const actionId = `rename:${id}`;
    startAction(actionId);
    setError('');
    setLiveStatus(`Renaming Category to “${name}”…`);
    try {
      const response = await fetch('/api/admin/categories', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, name }),
      });
      const body = await response.json().catch(() => null) as { category?: PostCategorySummary; error?: string } | null;
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
      setLiveStatus(`Category renamed to “${body.category.name}”.`);
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
      message: fill(category.postCount === 1 ? copy.categories.deleteOne : copy.categories.deleteMany,
        { count: category.postCount, name: category.name }),
      confirmLabel: copy.categories.delete,
      tone: 'danger',
    });
    if (!confirmed) return;

    const actionId = `delete:${category.id}`;
    startAction(actionId);
    setError('');
    setLiveStatus(fill(copy.categories.deleting, { name: category.name }));
    let affectedPosts: number | null = null;
    try {
      const response = await fetch('/api/admin/categories', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: category.id }),
      });
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
      <form className="category-create" onSubmit={createCategory}>
        <label className="admin-field" htmlFor="category-name">
          <span>{copy.categories.nameLabel} <small>{copy.categories.nameHint}</small></span>
          <input
            aria-label={copy.categories.nameLabel}
            className="admin-control"
            id="category-name"
            maxLength={80}
            onChange={(event) => setCreateName(event.target.value)}
            required
            type="text"
            value={createName}
          />
        </label>
        <button className="admin-button admin-button--primary" disabled={pendingActionIds.has('create')} type="submit">
          {copy.categories.create}
        </button>
      </form>

      <p className="category-status" role="status" aria-live="polite">{liveStatus}</p>
      {error && <p className="admin-alert" role="alert">{error}</p>}

      <ul className="category-list" aria-label={copy.categories.listLabel}>
        {categories.map((category) => {
          const renameAction = `rename:${category.id}`;
          const deleteAction = `delete:${category.id}`;
          return (
            <li className="category-row" key={category.id}>
              {edit?.id === category.id ? (
                <form className="category-edit" onSubmit={renameCategory}>
                  <label className="admin-field">
                    <span>{fill(copy.categories.renameNameLabel, { name: category.name })}</span>
                    <input
                      autoFocus
                      className="admin-control"
                      disabled={pendingActionIds.has(renameAction)}
                      maxLength={80}
                      onChange={(event) => setEdit({ id: category.id, name: event.target.value })}
                      required
                      value={edit.name}
                    />
                  </label>
                  <div className="category-edit-actions">
                    <button className="admin-button admin-button--primary" disabled={pendingActionIds.has(renameAction)} type="submit" aria-label={fill(copy.categories.saveLabelFor, { name: edit.name.trim() || copy.categories.fallbackName })}>{copy.categories.save}</button>
                    <button
                      className="admin-button"
                      disabled={pendingActionIds.has(renameAction)}
                      onClick={() => { setEdit(null); setError(''); focusRename(category.id); }}
                      type="button"
                    >
                      {copy.categories.cancelRename}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="category-row__content">
                    <div className="category-row__name">
                      <h2>{category.name}</h2>
                      {category.is_default && <span className="category-default">{copy.categories.defaultTag}</span>}
                    </div>
                    <p>{postCountLabel(copy, category.postCount)}</p>
                  </div>
                  {!category.is_default && (
                    <div className="category-actions">
                      <button
                        aria-label={fill(copy.categories.renameLabelFor, { name: category.name })}
                        className="admin-button"
                        onClick={() => { setEdit({ id: category.id, name: category.name }); setError(''); setLiveStatus(''); }}
                        ref={(button) => { if (button) renameButtons.current.set(category.id, button); }}
                        type="button"
                      >
                        {copy.categories.rename}
                      </button>
                      <button
                        aria-label={fill(copy.categories.deleteLabelFor, { name: category.name })}
                        className="admin-button"
                        disabled={pendingActionIds.has(deleteAction)}
                        onClick={() => void deleteCategory(category)}
                        type="button"
                      >
                        {copy.categories.delete}
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
