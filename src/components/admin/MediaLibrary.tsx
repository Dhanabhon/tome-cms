import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import {
  createMediaFolder,
  deleteMediaFolder,
  listMedia,
  listMediaFolders,
  renameMediaFolder,
  saveMediaDraft,
  uploadImage,
  type MediaDraft,
} from '../../lib/media-client';
import { ACCEPTED_IMAGE_TYPES } from '../../lib/media';
import type { MediaAsset, MediaFolder } from '../../types/cms';

type MediaLibraryProps =
  | { mode: 'manage' }
  | { mode: 'select'; onCancel: () => void; onSelect: (asset: MediaAsset) => void };

type CategorySelection = 'all' | 'unsorted' | string;
type ReferencingPost = { id: string; title: string };

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'The media library is temporarily unavailable.';
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

function folderId(selection: CategorySelection) {
  if (selection === 'all') return undefined;
  return selection === 'unsorted' ? null : selection;
}

export default function MediaLibrary(props: MediaLibraryProps) {
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [selection, setSelection] = useState<CategorySelection>('all');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedRequest, setFailedRequest] = useState<{ append: boolean; page: number; selection: CategorySelection; term: string } | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [folderLoadError, setFolderLoadError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<MediaFolder | null>(null);
  const [renameName, setRenameName] = useState('');
  const [selected, setSelected] = useState<MediaAsset | null>(null);
  const [draft, setDraft] = useState<MediaDraft>({ altText: '', folderId: '' });
  const [detailsStatus, setDetailsStatus] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [referencingPosts, setReferencingPosts] = useState<ReferencingPost[]>([]);
  const currentQuery = useRef('');
  const currentSelection = useRef<CategorySelection>('all');
  const requestId = useRef(0);
  const selectedId = useRef<string | null>(null);
  const urlInput = useRef<HTMLInputElement>(null);
  const detailsDialog = useRef<HTMLDialogElement>(null);
  const detailsClose = useRef<HTMLButtonElement>(null);
  const detailsOpener = useRef<HTMLButtonElement | null>(null);
  const mediaHeading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async (nextPage: number, append: boolean, term: string, nextSelection: CategorySelection) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    setFailedRequest(null);
    try {
      const result = await listMedia({ folderId: folderId(nextSelection), page: nextPage, search: term });
      if (id !== requestId.current) return;
      setItems((current) => (append ? [...current, ...result.items] : result.items));
      setHasMore(result.hasMore);
      setPage(nextPage);
    } catch (loadError) {
      if (id === requestId.current) {
        setError(errorMessage(loadError));
        setFailedRequest({ append, page: nextPage, selection: nextSelection, term });
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  const loadFolders = useCallback(async () => {
    setFolderLoadError(null);
    try {
      setFolders(await listMediaFolders());
    } catch (folderError) {
      setFolderLoadError(errorMessage(folderError));
    }
  }, []);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      currentQuery.current = search;
      setDebouncedSearch(search);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void load(1, false, debouncedSearch, selection);
  }, [debouncedSearch, load, selection]);

  useEffect(() => {
    const dialog = detailsDialog.current;
    if (!dialog) return;
    if (selected) {
      if (!dialog.open) dialog.showModal();
      detailsClose.current?.focus();
    } else if (dialog.open) {
      dialog.close();
      if (detailsOpener.current?.isConnected) detailsOpener.current.focus();
      else mediaHeading.current?.focus();
    }
  }, [selected]);

  function selectCategory(nextSelection: CategorySelection) {
    currentSelection.current = nextSelection;
    setPage(1);
    setSelection(nextSelection);
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const uploadSelection = currentSelection.current;
    const uploadQuery = currentQuery.current;
    setUploading(true);
    setError(null);
    try {
      const asset = await uploadImage(file, { folderId: folderId(uploadSelection) ?? null });
      if (props.mode === 'select') {
        props.onSelect(asset);
        return;
      }
      if (currentSelection.current === uploadSelection && currentQuery.current === uploadQuery) {
        await load(1, false, uploadQuery, uploadSelection);
      }
    } catch (uploadError) {
      setError(errorMessage(uploadError));
      setFailedRequest(null);
    } finally {
      input.value = '';
      setUploading(false);
    }
  }

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCategoryError(null);
    try {
      const folder = await createMediaFolder(categoryName);
      setFolders((current) => [...current, folder].sort((left, right) => left.name.localeCompare(right.name)));
      setCategoryName('');
    } catch (createError) {
      setCategoryError(errorMessage(createError));
    }
  }

  async function handleRenameCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renaming) return;
    setCategoryError(null);
    try {
      const folder = await renameMediaFolder(renaming.id, renameName);
      setFolders((current) => current.map((currentFolder) => (currentFolder.id === folder.id ? folder : currentFolder)).sort((left, right) => left.name.localeCompare(right.name)));
      setRenaming(null);
    } catch (renameError) {
      setCategoryError(errorMessage(renameError));
    }
  }

  async function handleDeleteCategory(folder: MediaFolder) {
    if (!window.confirm(`Delete ${folder.name}? Images in this category will move to Unsorted.`)) return;
    setCategoryError(null);
    try {
      await deleteMediaFolder(folder.id);
      setFolders((current) => current.filter((currentFolder) => currentFolder.id !== folder.id));
      setItems((current) => current.map((item) => (item.folder_id === folder.id ? { ...item, folder_id: null } : item)));
      if (selected?.folder_id === folder.id) setSelected((current) => (current ? { ...current, folder_id: null } : current));
      if (draft.folderId === folder.id) setDraft((current) => ({ ...current, folderId: '' }));
      if (currentSelection.current === folder.id) selectCategory('unsorted');
    } catch (deleteError) {
      setCategoryError(errorMessage(deleteError));
    }
  }

  function openDetails(item: MediaAsset, opener: HTMLButtonElement) {
    detailsOpener.current = opener;
    selectedId.current = item.id;
    setSelected(item);
    setDraft({ altText: item.alt_text ?? '', folderId: item.folder_id ?? '' });
    setDetailsStatus(null);
    setDeleteError(null);
    setReferencingPosts([]);
  }

  async function saveDetails() {
    if (!selected) return;
    setDetailsStatus(null);
    try {
      const updated = await saveMediaDraft(selected.id, draft);
      const asset = { ...updated, publicUrl: selected.publicUrl };
      setItems((current) => current.map((item) => (item.id === asset.id ? asset : item)));
      if (selectedId.current === asset.id) {
        setSelected(asset);
        setDetailsStatus('Saved.');
      }
      await load(1, false, currentQuery.current, currentSelection.current);
    } catch (saveError) {
      setDetailsStatus(errorMessage(saveError));
    }
  }

  async function copyUrl() {
    if (!selected) return;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable.');
      await navigator.clipboard.writeText(selected.publicUrl);
      setDetailsStatus('URL copied.');
    } catch {
      urlInput.current?.select();
      setDetailsStatus('URL selected. Copy it with your keyboard shortcut.');
    }
  }

  async function deleteSelected(confirmDeletion: boolean) {
    if (!selected || (confirmDeletion && !window.confirm(`Delete ${selected.original_name}? This cannot be undone.`))) return;
    const item = selected;
    setDeleting(true);
    setDetailsStatus(null);
    setDeleteError(null);
    setReferencingPosts([]);
    try {
      const response = await fetch(`/api/media/${item.id}`, { method: 'DELETE' });
      const result = await response.json() as { deleted?: boolean; error?: string; posts?: ReferencingPost[] };
      if (response.status === 409) {
        if (selectedId.current !== item.id) return;
        setDeleteError(result.error ?? 'This image is still in use.');
        setReferencingPosts(result.posts ?? []);
        return;
      }
      if (!response.ok || !result.deleted) throw new Error(result.error ?? 'The image could not be deleted.');

      await load(1, false, currentQuery.current, currentSelection.current);
      if (selectedId.current === item.id) closeDetails();
    } catch (deleteFailure) {
      if (selectedId.current === item.id) setDeleteError(errorMessage(deleteFailure));
    } finally {
      setDeleting(false);
    }
  }

  function closeDetails() {
    selectedId.current = null;
    setSelected(null);
  }

  function categoryActions(folder: MediaFolder) {
    return <>
      <button aria-label={`Rename ${folder.name}`} className="media-category-action" onClick={() => { setRenaming(folder); setRenameName(folder.name); }} type="button">Rename {folder.name}</button>
      <button aria-label={`Delete ${folder.name}`} className="media-category-action" onClick={() => void handleDeleteCategory(folder)} type="button">Delete {folder.name}</button>
    </>;
  }

  const selectedFolder = folders.find((folder) => folder.id === selection);

  const categoryButtons = (
    <>
      <button aria-pressed={selection === 'all'} className="media-category" onClick={() => selectCategory('all')} type="button">All media</button>
      <button aria-pressed={selection === 'unsorted'} className="media-category" onClick={() => selectCategory('unsorted')} type="button">Unsorted</button>
      {folders.map((folder) => (
        <div className="media-category-row" key={folder.id}>
          <button aria-pressed={selection === folder.id} className="media-category" onClick={() => selectCategory(folder.id)} type="button">{folder.name}</button>
          {props.mode === 'manage' && categoryActions(folder)}
        </div>
      ))}
    </>
  );

  return (
    <section className="media-shell" data-mode={props.mode}>
      <div className="media-toolbar">
        <div>
          <h1 className="font-display text-[54px] font-bold leading-[56px] tracking-[-1.875px] sm:text-[64px] sm:leading-[64px]" ref={mediaHeading} tabIndex={-1}>Media</h1>
          <p className="mt-2 text-sm text-muted">Upload and find images for your posts.</p>
        </div>
        <div className="media-toolbar__actions">
          <label className="min-w-0"><span className="sr-only">Search media</span><input className="admin-control" onChange={(event) => setSearch(event.target.value)} placeholder="Search media" type="search" value={search} /></label>
          <label className="admin-button admin-button--primary media-upload"><span>{uploading ? 'Uploading…' : 'Upload image'}</span><input accept={ACCEPTED_IMAGE_TYPES.join(',')} className="sr-only" disabled={uploading} onChange={handleUpload} type="file" /></label>
        </div>
      </div>

      <div className="media-library-layout">
        <aside className="media-categories">
          <nav aria-label="Media categories">{categoryButtons}</nav>
          <label className="media-category-select"><span className="sr-only">Media category</span><select aria-label="Media category" onChange={(event) => selectCategory(event.target.value)} value={selection}><option value="all">All media</option><option value="unsorted">Unsorted</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
          {props.mode === 'manage' && selectedFolder && <div className="media-category-mobile-actions">{categoryActions(selectedFolder)}</div>}
          {props.mode === 'manage' && <form className="media-category-form" onSubmit={handleCreateCategory}><label><span className="sr-only">Category name</span><input aria-label="Category name" maxLength={80} onChange={(event) => setCategoryName(event.target.value)} required value={categoryName} /></label><button type="submit">Create category</button></form>}
          {props.mode === 'manage' && renaming && <form className="media-category-form" onSubmit={handleRenameCategory}><label><span className="sr-only">Rename {renaming.name}</span><input aria-label={`Rename ${renaming.name}`} maxLength={80} onChange={(event) => setRenameName(event.target.value)} required value={renameName} /></label><button type="submit">Save category name</button><button onClick={() => setRenaming(null)} type="button">Cancel rename</button></form>}
          {folderLoadError && <p className="media-category-error" role="alert">{folderLoadError} <button className="font-medium text-accent underline" onClick={() => void loadFolders()} type="button">Retry categories</button></p>}
          {props.mode === 'manage' && categoryError && <p className="media-category-error" role="alert">{categoryError}</p>}
        </aside>

        <div className="min-w-0">
          {uploading && <p className="media-status" role="status">Uploading image…</p>}
          {error && <div className="media-status" role="alert"><span>{error}</span>{failedRequest && <button className="font-medium text-accent underline" onClick={() => void load(failedRequest.page, failedRequest.append, failedRequest.term, failedRequest.selection)} type="button">Retry</button>}</div>}
          {loading && !items.length && <p className="media-status" role="status">Loading media…</p>}
          {!loading && !error && !items.length && <div className="media-empty"><h2 className="font-display text-[22px] font-bold leading-7 tracking-[-0.25px]">No media yet</h2><p className="mt-2 text-sm text-muted">Upload an image to start your library.</p></div>}
          {items.length > 0 && <><div className="media-grid">{items.map((item) => {
            const format = item.mime_type.replace('image/', '').toUpperCase();
            return <button aria-label={props.mode === 'select' ? `Select ${item.original_name}, ${item.width} × ${item.height}, ${format}, ${formatSize(item.size_bytes)}` : `${item.original_name}, ${item.width} × ${item.height}, ${format}, ${formatSize(item.size_bytes)}`} className="media-card" key={item.id} onClick={(event) => props.mode === 'select' ? props.onSelect(item) : openDetails(item, event.currentTarget)} type="button"><img alt="" className="aspect-square w-full object-cover" height={item.height} loading="lazy" src={item.publicUrl} width={item.width} /><strong className="block truncate text-sm" title={item.original_name}>{item.original_name}</strong><span className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted"><span>{item.width} × {item.height}</span><span>{format}</span><span>{formatSize(item.size_bytes)}</span></span>{props.mode === 'select' && <span className="media-card-select">Select</span>}</button>;
          })}</div>{hasMore && <div className="media-status"><button className="rounded-md border border-line px-5 py-2.5 text-sm font-medium hover:border-accent hover:text-accent" disabled={loading} onClick={() => void load(page + 1, true, currentQuery.current, selection)} type="button">{loading ? 'Loading…' : 'Load more'}</button></div>}</>}
        </div>
      </div>

      {props.mode === 'manage' && <dialog aria-label="Image details" className="media-details" onCancel={(event) => { event.preventDefault(); closeDetails(); }} ref={detailsDialog}>{selected && <div><button aria-label="Close details" className="media-details-close" onClick={closeDetails} ref={detailsClose} type="button">Close</button><img alt="" height={selected.height} src={selected.publicUrl} width={selected.width} /><p className="break-all font-medium">{selected.original_name}</p><p className="text-sm text-muted">{selected.width} × {selected.height} · {selected.mime_type} · {formatSize(selected.size_bytes)}</p><label>Category<select aria-label="Category" onChange={(event) => setDraft((current) => ({ ...current, folderId: event.target.value }))} value={draft.folderId}><option value="">Unsorted</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label><label>Alt text<textarea aria-label="Alt text" maxLength={300} onChange={(event) => setDraft((current) => ({ ...current, altText: event.target.value }))} value={draft.altText} /></label><label>Image URL<input aria-label="Image URL" readOnly ref={urlInput} value={selected.publicUrl} /></label><div className="media-details-actions"><button onClick={() => void saveDetails()} type="button">Save</button><button onClick={() => void copyUrl()} type="button">Copy URL</button><button disabled={deleting} onClick={() => void deleteSelected(true)} type="button">{deleting ? 'Deleting…' : 'Delete'}</button></div>{detailsStatus && <p role="status">{detailsStatus}</p>}{deleteError && <div role="alert"><p>{deleteError}</p>{referencingPosts.length > 0 ? <ul>{referencingPosts.map((post) => <li key={post.id}><a href={`/admin/edit/${post.id}`}>{post.title}</a></li>)}</ul> : <button disabled={deleting} onClick={() => void deleteSelected(false)} type="button">Retry</button>}</div>}</div>}</dialog>}
    </section>
  );
}
