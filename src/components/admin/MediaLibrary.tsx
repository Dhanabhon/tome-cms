import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

import { listMedia, uploadImage } from '../../lib/media-client';
import { ACCEPTED_IMAGE_TYPES } from '../../lib/media';
import type { MediaAsset } from '../../types/cms';

interface Props {
  mode: 'manage' | 'select';
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'The media library is temporarily unavailable.';
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

export default function MediaLibrary({ mode }: Props) {
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedRequest, setFailedRequest] = useState<{ append: boolean; page: number } | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const requestId = useRef(0);

  const load = useCallback(async (nextPage: number, append = false, term = debouncedSearch) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    setFailedRequest(null);
    try {
      const result = await listMedia({ folderId: null, page: nextPage, search: term });
      if (id !== requestId.current) return;
      setItems((current) => (append ? [...current, ...result.items] : result.items));
      setHasMore(result.hasMore);
      setPage(nextPage);
    } catch (loadError) {
      if (id === requestId.current) {
        setError(errorMessage(loadError));
        setFailedRequest({ append, page: nextPage });
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void load(1, false, debouncedSearch);
  }, [debouncedSearch, load]);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadImage(file);
      await load(1);
    } catch (uploadError) {
      setError(errorMessage(uploadError));
      setFailedRequest(null);
    } finally {
      input.value = '';
      setUploading(false);
    }
  }

  return (
    <section className="media-shell" data-mode={mode}>
      <div className="media-toolbar">
        <div>
          <h1 className="font-display text-5xl font-semibold tracking-tight sm:text-6xl">Media</h1>
          <p className="mt-2 text-sm text-muted">Upload and find images for your posts.</p>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-3">
          <label className="min-w-0 flex-1 sm:max-w-sm">
            <span className="sr-only">Search media</span>
            <input
              className="w-full rounded-md border border-line px-3 py-2 text-sm"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search media"
              type="search"
              value={search}
            />
          </label>
          <label className="cursor-pointer whitespace-nowrap rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800">
            <span>{uploading ? 'Uploading…' : 'Upload image'}</span>
            <input
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              className="sr-only"
              disabled={uploading}
              onChange={handleUpload}
              type="file"
            />
          </label>
        </div>
      </div>

      {uploading && <p className="media-status" role="status">Uploading image…</p>}
      {error && (
        <div className="media-status" role="alert">
          <span>{error}</span>
          {failedRequest && (
            <button
              className="font-medium text-accent underline"
              onClick={() => void load(failedRequest.page, failedRequest.append)}
              type="button"
            >Retry</button>
          )}
        </div>
      )}
      {loading && !items.length && <p className="media-status" role="status">Loading media…</p>}
      {!loading && !error && !items.length && (
        <div className="media-empty">
          <h2 className="font-display text-3xl font-semibold">No media yet</h2>
          <p className="mt-2 text-sm text-muted">Upload an image to start your library.</p>
        </div>
      )}
      {items.length > 0 && (
        <>
          <div className="media-grid">
            {items.map((item) => {
              const format = item.mime_type.replace('image/', '').toUpperCase();
              return (
                <button
                  aria-label={`${item.original_name}, ${item.width} × ${item.height}, ${format}, ${formatSize(item.size_bytes)}`}
                  className="media-card"
                  key={item.id}
                  type="button"
                >
                  <img alt="" className="aspect-square w-full object-cover" height={item.height} loading="lazy" src={item.publicUrl} width={item.width} />
                  <strong className="block truncate text-sm" title={item.original_name}>{item.original_name}</strong>
                  <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
                    <span>{item.width} × {item.height}</span>
                    <span>{format}</span>
                    <span>{formatSize(item.size_bytes)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {hasMore && (
            <div className="media-status">
              <button
                className="rounded-md border border-line px-5 py-2.5 text-sm font-medium hover:border-accent hover:text-accent"
                disabled={loading}
                onClick={() => void load(page + 1, true)}
                type="button"
              >
                {loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
