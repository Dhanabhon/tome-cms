import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import {
  createMediaFolder,
  deleteMedia,
  deleteMediaFolder,
  listMedia,
  listMediaFolders,
  renameMediaFolder,
  saveMediaDraft,
  uploadFailureText,
  uploadFile,
  MediaRequestError,
  type MediaDraft,
} from '../../lib/media-client';
import { adminCopy, fill, type AdminCopy } from '../../lib/admin-i18n';
import {
  acceptAttribute,
  DOCUMENT_GROUPS,
  formatBytes,
  formatLabel,
  isImageAsset,
  typesForFilter,
  type MediaKind,
  type MediaTypeFilter,
} from '../../lib/media';
import { confirmUi } from '../../lib/ui-dialog';
import type { MediaAsset, MediaFolder, PostLocale } from '../../types/cms';
import Icon from '../Icon';
import UiSelect from './UiSelect';
import MediaTypes from './MediaTypes';
import { atLeast } from '../../lib/busy';

type MediaLibraryProps = { ownerLocale?: PostLocale | null } & (
  | { mode: 'manage' }
  | { kind: MediaKind; mode: 'select'; onCancel: () => void; onSelect: (asset: MediaAsset) => void }
);

type CategorySelection = 'all' | 'unsorted' | string;
type ReferencingPost = { id: string; title: string };
type ReferencingPage = { id: string; title: string };
type FailedRequest = { append: boolean; filter: MediaTypeFilter | null; page: number; selection: CategorySelection; term: string };

/** The library page filters by every kind; a file picker by documents alone. */
const LIBRARY_FILTERS: ReadonlyArray<MediaTypeFilter | null> = [null, 'image', ...DOCUMENT_GROUPS];
const FILE_FILTERS: ReadonlyArray<MediaTypeFilter | null> = ['file', ...DOCUMENT_GROUPS];
const FOLDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorMessage(error: unknown, copy: AdminCopy) {
  const known = uploadFailureText(error, copy);
  if (known) return known;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return copy.media.unavailable;
}

function folderId(selection: CategorySelection) {
  if (selection === 'all') return undefined;
  return selection === 'unsorted' ? null : selection;
}

/**
 * Where a library opens. The page takes its type and folder from its address, so a reload or a
 * shared link shows the same files; a picker starts from its kind and never reads the address.
 */
function initialView(props: MediaLibraryProps): { filter: MediaTypeFilter | null; selection: CategorySelection } {
  if (props.mode === 'select') return { filter: props.kind === 'image' ? 'image' : 'file', selection: 'all' };
  const query = new URLSearchParams(window.location.search);
  const type = query.get('type');
  const folder = query.get('folder') ?? '';
  return {
    filter: LIBRARY_FILTERS.find((filter) => filter !== null && filter === type) ?? null,
    selection: folder === 'unsorted' || FOLDER_ID.test(folder) ? folder : 'all',
  };
}

export default function MediaLibrary(props: MediaLibraryProps) {
  const copy = adminCopy(props.ownerLocale);
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [view] = useState(() => initialView(props));
  const [selection, setSelection] = useState<CategorySelection>(view.selection);
  const [filter, setFilter] = useState<MediaTypeFilter | null>(view.filter);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedRequest, setFailedRequest] = useState<FailedRequest | null>(null);
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
  // Which of the dialog's and the folders' actions is running, so only its button spins.
  const [working, setWorking] = useState<string | null>(null);
  const pressed = (action: string) => working === action;
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [referencingPosts, setReferencingPosts] = useState<ReferencingPost[]>([]);
  const [referencingPages, setReferencingPages] = useState<ReferencingPage[]>([]);
  const [profileReference, setProfileReference] = useState(false);
  const currentQuery = useRef('');
  const currentSelection = useRef<CategorySelection>(view.selection);
  const currentFilter = useRef<MediaTypeFilter | null>(view.filter);
  const requestId = useRef(0);
  /** Bumped by every folder list asked for and every folder made, renamed or deleted. */
  const foldersRequest = useRef(0);
  const selectedId = useRef<string | null>(null);
  const urlInput = useRef<HTMLInputElement>(null);
  const detailsDialog = useRef<HTMLDialogElement>(null);
  const detailsClose = useRef<HTMLButtonElement>(null);
  const detailsOpener = useRef<HTMLButtonElement | null>(null);
  const mediaHeading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async (nextPage: number, append: boolean, term: string, nextSelection: CategorySelection, nextFilter: MediaTypeFilter | null) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    setFailedRequest(null);
    try {
      const result = await listMedia({ folderId: folderId(nextSelection), page: nextPage, search: term, type: nextFilter ?? undefined });
      if (id !== requestId.current) return;
      setItems((current) => (append ? [...current, ...result.items] : result.items));
      setHasMore(result.hasMore);
      setPage(nextPage);
    } catch (loadError) {
      if (id === requestId.current) {
        setError(errorMessage(loadError, copy));
        setFailedRequest({ append, filter: nextFilter, page: nextPage, selection: nextSelection, term });
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  const loadFolders = useCallback(async () => {
    const request = ++foldersRequest.current;
    setFolderLoadError(null);
    try {
      const loaded = await listMediaFolders();
      // A list that answers after a folder was made, renamed or deleted is older than the view.
      if (request !== foldersRequest.current) return;
      setFolders(loaded);
      // A folder the address names that is gone would show an empty view titled as a folder.
      const current = currentSelection.current;
      if (FOLDER_ID.test(current) && !loaded.some((folder) => folder.id === current)) selectCategory('all');
    } catch (folderError) {
      if (request === foldersRequest.current) setFolderLoadError(errorMessage(folderError, copy));
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
    void load(1, false, debouncedSearch, selection, filter);
  }, [debouncedSearch, filter, load, selection]);

  // The library page's address says which files it shows, and a change of view is not a step to
  // go back through. A picker's view is its own.
  useEffect(() => {
    if (props.mode !== 'manage') return;
    const url = new URL(window.location.href);
    if (filter) url.searchParams.set('type', filter);
    else url.searchParams.delete('type');
    if (selection === 'all') url.searchParams.delete('folder');
    else url.searchParams.set('folder', selection);
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);
  }, [filter, props.mode, selection]);

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

  function selectType(nextFilter: MediaTypeFilter | null) {
    currentFilter.current = nextFilter;
    setPage(1);
    setFilter(nextFilter);
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const uploadSelection = currentSelection.current;
    const uploadQuery = currentQuery.current;
    const uploadFilter = currentFilter.current;
    setUploading(true);
    setUploadProgress(0);
    setError(null);
    try {
      const asset = await atLeast(uploadFile(file, {
        accept: props.mode === 'select' ? props.kind : 'any',
        folderId: folderId(uploadSelection) ?? null,
        onProgress: setUploadProgress,
      }));
      if (props.mode === 'select') {
        props.onSelect(asset);
        return;
      }
      if (currentSelection.current === uploadSelection && currentQuery.current === uploadQuery && currentFilter.current === uploadFilter) {
        // A file the chosen type hides would look as if it had not landed, and be uploaded again.
        if (uploadFilter && !typesForFilter(uploadFilter).includes(asset.mime_type)) selectType(null);
        else await load(1, false, uploadQuery, uploadSelection, uploadFilter);
      }
    } catch (uploadError) {
      setError(errorMessage(uploadError, copy));
      setFailedRequest(null);
    } finally {
      input.value = '';
      setUploading(false);
      setUploadProgress(null);
    }
  }

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    setWorking('create-folder');
    setCategoryError(null);
    try {
      const folder = await atLeast(createMediaFolder(categoryName));
      foldersRequest.current += 1;
      setFolders((current) => [...current, folder].sort((left, right) => left.name.localeCompare(right.name)));
      setCategoryName('');
    } catch (createError) {
      setCategoryError(errorMessage(createError, copy));
    } finally {
      setWorking(null);
    }
  }

  async function handleRenameCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renaming || working) return;
    setWorking('rename-folder');
    setCategoryError(null);
    try {
      const folder = await atLeast(renameMediaFolder(renaming.id, renameName));
      foldersRequest.current += 1;
      setFolders((current) => current.map((currentFolder) => (currentFolder.id === folder.id ? folder : currentFolder)).sort((left, right) => left.name.localeCompare(right.name)));
      setRenaming(null);
    } catch (renameError) {
      setCategoryError(errorMessage(renameError, copy));
    } finally {
      setWorking(null);
    }
  }

  async function handleDeleteCategory(folder: MediaFolder) {
    const confirmed = await confirmUi({
      title: copy.media.deleteFolderTitle,
      message: fill(copy.media.deleteFolderMessage, { name: folder.name }),
      confirmLabel: copy.media.deleteFolder,
      tone: 'danger',
    });
    if (!confirmed) return;
    setCategoryError(null);
    try {
      await deleteMediaFolder(folder.id);
      foldersRequest.current += 1;
      setFolders((current) => current.filter((currentFolder) => currentFolder.id !== folder.id));
      setItems((current) => current.map((item) => (item.folder_id === folder.id ? { ...item, folder_id: null } : item)));
      if (selected?.folder_id === folder.id) setSelected((current) => (current ? { ...current, folder_id: null } : current));
      if (draft.folderId === folder.id) setDraft((current) => ({ ...current, folderId: '' }));
      if (currentSelection.current === folder.id) selectCategory('unsorted');
    } catch (deleteError) {
      setCategoryError(errorMessage(deleteError, copy));
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
    setReferencingPages([]);
    setProfileReference(false);
  }

  async function saveDetails() {
    if (!selected || working) return;
    setWorking('save-details');
    setDetailsStatus(null);
    try {
      const updated = await atLeast(saveMediaDraft(selected.id, draft));
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      if (selectedId.current === updated.id) {
        setSelected(updated);
        setDetailsStatus(copy.media.saved);
      }
      await load(1, false, currentQuery.current, currentSelection.current, currentFilter.current);
    } catch (saveError) {
      setDetailsStatus(errorMessage(saveError, copy));
    } finally {
      setWorking(null);
    }
  }

  async function copyUrl() {
    if (!selected) return;
    try {
      if (!navigator.clipboard) throw new Error(copy.media.clipboardUnavailable);
      await navigator.clipboard.writeText(selected.publicUrl);
      setDetailsStatus(copy.media.urlCopied);
    } catch {
      urlInput.current?.select();
      setDetailsStatus(copy.media.urlSelected);
    }
  }

  async function deleteSelected(confirmDeletion: boolean) {
    if (!selected) return;
    if (confirmDeletion) {
      const confirmed = await confirmUi({
        title: copy.media.deleteFileTitle,
        message: fill(copy.media.deleteFileMessage, { name: selected.original_name }),
        confirmLabel: copy.media.deleteFile,
        tone: 'danger',
      });
      if (!confirmed) return;
    }
    const item = selected;
    setDeleting(true);
    setDetailsStatus(null);
    setDeleteError(null);
    setReferencingPosts([]);
    setReferencingPages([]);
    setProfileReference(false);
    try {
      await atLeast(deleteMedia(item.id));
      await load(1, false, currentQuery.current, currentSelection.current, currentFilter.current);
      if (selectedId.current === item.id) closeDetails();
    } catch (deleteFailure) {
      if (selectedId.current === item.id) {
        setDeleteError(errorMessage(deleteFailure, copy));
        if (deleteFailure instanceof MediaRequestError && deleteFailure.references) {
          setReferencingPosts(deleteFailure.references.posts);
          setReferencingPages(deleteFailure.references.pages);
          setProfileReference(deleteFailure.references.profile);
        }
      }
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
      <button aria-label={fill(copy.media.renameFolderLabel, { name: folder.name })} className="media-category-action" onClick={() => { setRenaming(folder); setRenameName(folder.name); }} type="button">{copy.categories.rename} {folder.name}</button>
      <button aria-label={fill(copy.media.deleteFolderLabel, { name: folder.name })} className="media-category-action" onClick={() => void handleDeleteCategory(folder)} type="button">{copy.media.delete} {folder.name}</button>
    </>;
  }

  const selectedFolder = folders.find((folder) => folder.id === selection);
  const categoryOptions = [
    { label: copy.media.allFiles, value: 'all' },
    { label: copy.media.unsorted, value: 'unsorted' },
    ...folders.map((folder) => ({ label: folder.name, value: folder.id })),
  ];
  const detailCategoryOptions = [
    { label: copy.media.unsorted, value: '' },
    ...folders.map((folder) => ({ label: folder.name, value: folder.id })),
  ];

  const categoryButtons = (
    <>
      <button aria-pressed={selection === 'all'} className="media-category" onClick={() => selectCategory('all')} type="button">{copy.media.allFiles}</button>
      <button aria-pressed={selection === 'unsorted'} className="media-category" onClick={() => selectCategory('unsorted')} type="button">{copy.media.unsorted}</button>
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
      {props.mode === 'manage' && (
        <div className="admin-page__head">
          <div>
            <h1 ref={mediaHeading} tabIndex={-1}>{copy.media.heading}</h1>
            <p>{copy.media.subheading}</p>
          </div>
        </div>
      )}
      <div className="media-toolbar">
        <label className="admin-search media-search">
          <span className="sr-only">{copy.media.searchFiles}</span>
          <Icon name="search" />
          <input className="admin-control" onChange={(event) => setSearch(event.target.value)} placeholder={copy.media.searchFiles} type="search" value={search} />
        </label>
        {!(props.mode === 'select' && props.kind === 'image') && (
          <MediaTypes copy={copy} filters={props.mode === 'select' ? FILE_FILTERS : LIBRARY_FILTERS} onChange={selectType} value={filter} />
        )}
        <div className="media-toolbar__end">
          <label aria-busy={uploading} className="admin-button admin-button--primary media-upload">
            <span>{props.mode === 'select' && props.kind === 'image' ? copy.media.uploadImage : copy.media.uploadFile}</span>
            <input accept={acceptAttribute(props.mode === 'select' ? props.kind : 'any')} className="sr-only" disabled={uploading} onChange={handleUpload} type="file" />
          </label>
          {props.mode === 'select' && <button autoFocus aria-label={copy.media.cancel} className="admin-button admin-button--ghost admin-button--icon" onClick={props.onCancel} title={copy.media.cancel} type="button"><Icon name="close" /></button>}
        </div>
      </div>

      <div className="media-library-layout">
        <aside className="media-categories">
          <nav aria-label={copy.media.folders}>{categoryButtons}</nav>
          <div className="media-category-select"><span aria-hidden="true" className="media-select-label">{copy.media.folders}</span><UiSelect ariaLabel={copy.media.folders} className="admin-control" id="media-category" onValueChange={(next) => selectCategory(next)} options={categoryOptions} value={selection} /></div>
          {props.mode === 'manage' && selectedFolder && <div className="media-category-mobile-actions">{categoryActions(selectedFolder)}</div>}
          {props.mode === 'manage' && <form className="media-category-form" noValidate onSubmit={handleCreateCategory}><label><span className="sr-only">{copy.media.folderName}</span><input aria-label={copy.media.folderName} className="admin-control" maxLength={80} onChange={(event) => setCategoryName(event.target.value)} placeholder={copy.media.folderName} required value={categoryName} /></label><button aria-busy={pressed('create-folder')} className="admin-button" disabled={working !== null} type="submit">{copy.media.createFolder}</button></form>}
          {props.mode === 'manage' && renaming && <form className="media-category-form" noValidate onSubmit={handleRenameCategory}><label><span className="sr-only">{fill(copy.media.renameFolderLabel, { name: renaming.name })}</span><input aria-label={fill(copy.media.renameFolderLabel, { name: renaming.name })} className="admin-control" maxLength={80} onChange={(event) => setRenameName(event.target.value)} required value={renameName} /></label><button aria-busy={pressed('rename-folder')} className="admin-button" disabled={working !== null} type="submit">{copy.media.saveFolderName}</button><button className="admin-button" onClick={() => setRenaming(null)} type="button">{copy.media.cancelRename}</button></form>}
          {folderLoadError && <p className="media-category-error" role="alert">{folderLoadError} <button className="admin-button admin-button--ghost" onClick={() => void loadFolders()} type="button">{copy.media.retryFolders}</button></p>}
          {props.mode === 'manage' && categoryError && <p className="media-category-error" role="alert">{categoryError}</p>}
        </aside>

        <div className="min-w-0">
          {uploading && <p className="media-status" role="status">{copy.media.uploadingProgress} {uploadProgress ?? 0}%</p>}
          {error && <div className="media-status" role="alert"><span>{error}</span>{failedRequest && <button className="admin-button admin-button--ghost" onClick={() => void load(failedRequest.page, failedRequest.append, failedRequest.term, failedRequest.selection, failedRequest.filter)} type="button">{copy.media.retry}</button>}</div>}
          {loading && !items.length && <p className="media-status" role="status">{copy.media.loadingFiles}</p>}
          {!loading && !error && !items.length && (
            <div className="admin-empty media-empty">
              <span className="admin-empty__mark" aria-hidden="true"><Icon name="media" /></span>
              <div><h2>{copy.media.emptyTitle}</h2><p>{copy.media.emptyBody}</p></div>
            </div>
          )}
          {items.length > 0 && <><div className="media-grid">{items.map((item) => {
            const image = isImageAsset(item) ? item : null;
            const format = formatLabel(item.mime_type);
            const size = formatBytes(item.size_bytes);
            const label = image
              ? fill(props.mode === 'select' ? copy.media.selectLabel : copy.media.itemLabel, { format, height: image.height, name: item.original_name, size, width: image.width })
              : fill(props.mode === 'select' ? copy.media.selectFileLabel : copy.media.fileLabel, { format, name: item.original_name, size });
            return <button aria-label={label} className="media-card" key={item.id} onClick={(event) => props.mode === 'select' ? props.onSelect(item) : openDetails(item, event.currentTarget)} type="button">
              {image
                ? <img alt="" className="aspect-square w-full object-cover" height={image.height} loading="lazy" src={item.publicUrl} width={image.width} />
                : <span aria-hidden="true" className="media-card__file">{format}</span>}
              <strong className="block truncate text-sm">{item.original_name}</strong>
              <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">{image && <span>{image.width} × {image.height}</span>}<span>{format}</span><span>{size}</span></span>
              {props.mode === 'select' && <span className="media-card-select">{copy.media.select}</span>}
            </button>;
          })}</div>{hasMore && <div className="media-status"><button aria-busy={loading} className="admin-button" disabled={loading} onClick={() => void load(page + 1, true, currentQuery.current, selection, filter)} type="button">{copy.media.loadMore}</button></div>}</>}
        </div>
      </div>

      {props.mode === 'manage' && <dialog aria-label={copy.media.fileDetails} className="media-details" onCancel={(event) => { event.preventDefault(); closeDetails(); }} ref={detailsDialog}>{selected && <div><button aria-label={copy.media.closeDetails} className="admin-button admin-button--ghost admin-button--icon media-details-close" onClick={closeDetails} ref={detailsClose} type="button"><Icon name="close" /></button>{isImageAsset(selected)
          ? <img alt="" height={selected.height} src={selected.publicUrl} width={selected.width} />
          : <span aria-hidden="true" className="media-card__file media-details__file">{formatLabel(selected.mime_type)}</span>}
        <p className="break-all font-medium">{selected.original_name}</p>
        <p className="text-sm text-muted">{isImageAsset(selected) ? `${selected.width} × ${selected.height} · ` : ''}{formatLabel(selected.mime_type)} · {formatBytes(selected.size_bytes)}</p><label htmlFor="media-details-category">{copy.media.folder}</label><UiSelect ariaLabel={copy.media.folder} className="admin-control" id="media-details-category" onValueChange={(next) => setDraft((current) => ({ ...current, folderId: next }))} options={detailCategoryOptions} value={draft.folderId} />{isImageAsset(selected) && <label>{copy.media.altText}<textarea aria-label={copy.media.altText} className="admin-control admin-control--textarea" maxLength={300} onChange={(event) => setDraft((current) => ({ ...current, altText: event.target.value }))} value={draft.altText} /></label>}<label>{copy.media.fileUrl}<input aria-label={copy.media.fileUrl} className="admin-control" readOnly ref={urlInput} value={selected.publicUrl} /></label><div className="media-details-actions"><button aria-busy={pressed('save-details')} className="admin-button admin-button--primary" disabled={working !== null || deleting} onClick={() => void saveDetails()} type="button">{copy.media.save}</button><button className="admin-button" onClick={() => void copyUrl()} type="button">{copy.media.copyUrl}</button><button aria-busy={deleting} className="admin-button admin-button--danger" disabled={deleting || working !== null} onClick={() => void deleteSelected(true)} type="button">{copy.media.delete}</button></div>{(deleting || detailsStatus) && <p role="status">{deleting ? copy.media.deleting : detailsStatus}</p>}{deleteError && <div role="alert"><p>{deleteError}</p>{referencingPosts.length > 0 && <ul>{referencingPosts.map((post) => <li key={post.id}><a href={`/admin/edit/${post.id}`}>{post.title}</a></li>)}</ul>}{referencingPages.length > 0 && <ul>{referencingPages.map((page) => <li key={page.id}><a href={`/admin/pages/edit/${page.id}`}>{page.title}</a></li>)}</ul>}{profileReference && <p>{copy.media.profileAvatar}</p>}{!referencingPosts.length && !referencingPages.length && !profileReference && <button className="admin-button" disabled={deleting} onClick={() => void deleteSelected(false)} type="button">{copy.media.retry}</button>}</div>}</div>}</dialog>}
    </section>
  );
}
