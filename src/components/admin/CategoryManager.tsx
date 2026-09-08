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
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState('');
  const [error, setError] = useState('');
  const renameButtons = useRef(new Map<string, HTMLButtonElement>());

  const focusRename = (id: string) => requestAnimationFrame(() => renameButtons.current.get(id)?.focus());

  async function createCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = createName.trim();
    if (!name) return setError('Enter a Category name.');
    const actionId = 'create';
    setPendingActionId(actionId);
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
      setPendingActionId((current) => current === actionId ? null : current);
    }
  }

  async function renameCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit) return;
    const id = edit.id;
    const name = edit.name.trim();
    if (!name) return setError('Enter a Category name.');
    const actionId = `rename:${id}`;
    setPendingActionId(actionId);
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
      setEdit(null);
      setLiveStatus(`Category renamed to “${body.category.name}”.`);
      focusRename(id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The Category could not be updated.');
      setLiveStatus('');
    } finally {
      setPendingActionId((current) => current === actionId ? null : current);
    }
  }

  async function deleteCategory(category: PostCategorySummary) {
    const count = postCountLabel(category.postCount);
    const confirmed = await confirmUi({
      title: 'Delete Category?',
      message: `Delete “${category.name}”? ${count} will move to Uncategorized. This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;

    const actionId = `delete:${category.id}`;
    setPendingActionId(actionId);
    setError('');
    setLiveStatus(`Deleting “${category.name}”…`);
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
      setCategories((current) => current.filter(({ id }) => id !== category.id));
      setLiveStatus(`Category “${category.name}” deleted. ${postCountLabel(body.affectedPosts)} moved to Uncategorized.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The Category could not be deleted.');
      setLiveStatus('');
    } finally {
      setPendingActionId((current) => current === actionId ? null : current);
    }
  }

  return (
    <div className="category-manager" aria-busy={pendingActionId !== null}>
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
        <button className="admin-button admin-button--primary" disabled={pendingActionId === 'create'} type="submit">
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
                      disabled={pendingActionId === renameAction}
                      maxLength={80}
                      onChange={(event) => setEdit({ id: category.id, name: event.target.value })}
                      required
                      value={edit.name}
                    />
                  </label>
                  <div className="category-edit-actions">
                    <button className="admin-button admin-button--primary" disabled={pendingActionId === renameAction} type="submit" aria-label={`Save ${edit.name.trim() || 'Category'}`}>Save</button>
                    <button
                      className="admin-button"
                      disabled={pendingActionId === renameAction}
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
                        disabled={pendingActionId === deleteAction}
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
