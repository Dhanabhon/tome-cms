import { useRef, useState } from 'react';

import { confirmUi } from '../../lib/ui-dialog';
import type { PostCategorySummary } from '../../types/cms';

interface CategoryManagerProps {
  initialCategories: PostCategorySummary[];
}

function sortCategories(categories: PostCategorySummary[]) {
  return [...categories].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
}

function postCountLabel(count: number) {
  return `${count} ${count === 1 ? 'Post' : 'Posts'}`;
}

export default function CategoryManager({ initialCategories }: CategoryManagerProps) {
  const [categories, setCategories] = useState(() => sortCategories(initialCategories));
  const [createName, setCreateName] = useState('');
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  const [pendingActionIds, setPendingActionIds] = useState<Set<string>>(() => new Set());
  const [liveStatus, setLiveStatus] = useState('');
  const [error, setError] = useState('');
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
    if (!name) return setError('Enter a Category name.');
    const actionId = 'create';
    startAction(actionId);
    setError('');
    setLiveStatus(`Creating “${name}”…`);
    try {
      const response = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await response.json().catch(() => null) as { category?: PostCategorySummary; error?: string } | null;
      if (!response.ok || !body?.category) throw new Error(body?.error || 'The Category could not be created.');
      setCategories((current) => sortCategories([...current, body.category!]));
      setCreateName((current) => current === createName ? '' : current);
      setLiveStatus(`Category “${body.category.name}” created.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The Category could not be created.');
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
    if (!name) return setError('Enter a Category name.');
    const actionId = `rename:${id}`;
    startAction(actionId);
    setError('');
    setLiveStatus(`Renaming Category to “${name}”…`);
    try {
      const response = await fetch('/api/categories', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, name }),
      });
      const body = await response.json().catch(() => null) as { category?: PostCategorySummary; error?: string } | null;
      if (!response.ok || !body?.category) throw new Error(body?.error || 'The Category could not be updated.');
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
      setError(caught instanceof Error ? caught.message : 'The Category could not be updated.');
      setLiveStatus('');
    } finally {
      finishAction(actionId);
    }
  }

  async function deleteCategory(category: PostCategorySummary) {
    const count = postCountLabel(category.postCount);
    const confirmed = await confirmUi({
      title: 'Delete Category?',
      message: `Delete “${category.name}”? This affects ${count}. Posts without another Category will use Uncategorized. This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;

    const actionId = `delete:${category.id}`;
    startAction(actionId);
    setError('');
    setLiveStatus(`Deleting “${category.name}”…`);
    let affectedPosts: number | null = null;
    try {
      const response = await fetch('/api/categories', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: category.id }),
      });
      const body = await response.json().catch(() => null) as { affectedPosts?: number; error?: string } | null;
      if (!response.ok || typeof body?.affectedPosts !== 'number') {
        throw new Error(body?.error || 'The Category could not be deleted.');
      }
      affectedPosts = body.affectedPosts;
      setCategories((current) => current.filter(({ id }) => id !== category.id));
      const refreshResponse = await fetch('/api/categories');
      const refreshBody = await refreshResponse.json().catch(() => null) as { categories?: PostCategorySummary[]; error?: string } | null;
      if (!refreshResponse.ok || !refreshBody?.categories) {
        throw new Error(refreshBody?.error || 'Category counts could not be refreshed. Reload this page.');
      }
      setCategories(sortCategories(refreshBody.categories));
      setLiveStatus(`Category “${category.name}” deleted. ${postCountLabel(affectedPosts)} ${affectedPosts === 1 ? 'was' : 'were'} affected.`);
    } catch (caught) {
      if (affectedPosts === null) {
        setError(caught instanceof Error ? caught.message : 'The Category could not be deleted.');
        setLiveStatus('');
      } else {
        setError(caught instanceof Error ? caught.message : 'Category counts could not be refreshed. Reload this page.');
        setLiveStatus(`Category “${category.name}” deleted. ${postCountLabel(affectedPosts)} ${affectedPosts === 1 ? 'was' : 'were'} affected.`);
      }
    } finally {
      finishAction(actionId);
    }
  }

  return (
    <div className="category-manager" aria-busy={pendingActionIds.size > 0}>
      <form className="category-create" onSubmit={createCategory}>
        <label className="admin-field" htmlFor="category-name">
          <span>Category name <small>80 characters maximum</small></span>
          <input
            aria-label="Category name"
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
          Create category
        </button>
      </form>

      <p className="category-status" role="status" aria-live="polite">{liveStatus}</p>
      {error && <p className="admin-alert" role="alert">{error}</p>}

      <ul className="category-list" aria-label="Categories">
        {categories.map((category) => {
          const renameAction = `rename:${category.id}`;
          const deleteAction = `delete:${category.id}`;
          return (
            <li className="category-row" key={category.id}>
              {edit?.id === category.id ? (
                <form className="category-edit" onSubmit={renameCategory}>
                  <label className="admin-field">
                    <span>Category name for {category.name}</span>
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
                    <button className="admin-button admin-button--primary" disabled={pendingActionIds.has(renameAction)} type="submit" aria-label={`Save ${edit.name.trim() || 'Category'}`}>Save</button>
                    <button
                      className="admin-button"
                      disabled={pendingActionIds.has(renameAction)}
                      onClick={() => { setEdit(null); setError(''); focusRename(category.id); }}
                      type="button"
                    >
                      Cancel rename
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="category-row__content">
                    <div className="category-row__name">
                      <h2>{category.name}</h2>
                      {category.is_default && <span className="category-default">Default</span>}
                    </div>
                    <p>{postCountLabel(category.postCount)}</p>
                  </div>
                  {!category.is_default && (
                    <div className="category-actions">
                      <button
                        aria-label={`Rename ${category.name}`}
                        className="admin-button"
                        onClick={() => { setEdit({ id: category.id, name: category.name }); setError(''); setLiveStatus(''); }}
                        ref={(button) => { if (button) renameButtons.current.set(category.id, button); }}
                        type="button"
                      >
                        Rename
                      </button>
                      <button
                        aria-label={`Delete ${category.name}`}
                        className="admin-button"
                        disabled={pendingActionIds.has(deleteAction)}
                        onClick={() => void deleteCategory(category)}
                        type="button"
                      >
                        Delete
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
