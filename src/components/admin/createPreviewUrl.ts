export type PreviewContentType = 'post' | 'page';

function errorMessage(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return null;
  return typeof payload.error === 'string' ? payload.error : null;
}

export default async function createPreviewUrl(contentType: PreviewContentType, contentId: string): Promise<string> {
  const response = await fetch('/api/admin/previews', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contentId, contentType }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(payload) ?? 'The Preview link could not be created.');
  if (typeof payload !== 'object' || payload === null || !('url' in payload) || typeof payload.url !== 'string') {
    throw new Error('The server returned an invalid Preview link.');
  }
  const url = new URL(payload.url, window.location.origin);
  if (url.origin !== window.location.origin
    || !/^\/api\/v1\/content\/preview\/[A-Za-z0-9_-]{43}$/.test(url.pathname)
    || url.search || url.hash) {
    throw new Error('The server returned an invalid Preview link.');
  }
  return url.href;
}
