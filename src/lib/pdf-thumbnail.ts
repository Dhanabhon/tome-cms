/** The box a page is drawn to fit, in CSS pixels: both previews show it contained in a frame this size or smaller. */
const THUMBNAIL_BOX = 280;
const MAX_PIXEL_RATIO = 2;
/** What pdf.js reads per request: the first page of a PDF is a few chunks, not the file. */
const RANGE_CHUNK_BYTES = 65_536;
const CONCURRENT_RENDERS = 2;

/** Draws a PDF's first page, from the admin's own copy of it, and answers a blob address. Null when it cannot. */
async function renderFirstPage(id: string): Promise<string | null> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  // Ranges only (no stream): the first page is a few chunks of the file, and a stream would start
  // the whole of a 25 MB document towards every card. pdf.js 6 has no eval and no scripting unless asked.
  const task = pdfjs.getDocument({
    disableAutoFetch: true,
    disableStream: true,
    rangeChunkSize: RANGE_CHUNK_BYTES,
    url: `/api/admin/media/${id}/content`,
    withCredentials: true,
  });
  try {
    const page = await (await task.promise).getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const viewport = page.getViewport({ scale: (Math.min(THUMBNAIL_BOX / natural.width, THUMBNAIL_BOX / natural.height) * ratio) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    return blob ? URL.createObjectURL(blob) : null;
  } finally {
    await task.destroy();
  }
}

/**
 * One render per file, however many places ask for it, and a few at a time: a page of cards must
 * not start forty pdf.js workers. A render that fails is null for good: it is a label, not an
 * error, and trying again would only fail again for every card that shows it.
 */
export function thumbnailLoader(
  render: (id: string) => Promise<string | null>,
  concurrency = CONCURRENT_RENDERS,
  revoke: (url: string) => void = (url) => URL.revokeObjectURL(url),
) {
  let known = new Map<string, Promise<string | null>>();
  let made = new Set<string>();
  let running = 0;
  const waiting: Array<() => void> = [];

  async function turn<T>(work: () => Promise<T>): Promise<T> {
    if (running >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    running += 1;
    try {
      return await work();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  }

  return {
    load(id: string): Promise<string | null> {
      const current = known;
      const existing = current.get(id);
      if (existing) return existing;
      const pending = turn(() => render(id)).catch(() => null).then((url) => {
        if (!url) return null;
        // Cleared while it drew: nobody is left to show it, and nobody would revoke it.
        if (known !== current) { revoke(url); return null; }
        made.add(url);
        return url;
      });
      current.set(id, pending);
      return pending;
    },
    /** The library is gone: its addresses are revoked and the next one to look starts over. */
    clear() {
      known = new Map();
      for (const url of made) revoke(url);
      made = new Set();
    },
  };
}

export const pdfThumbnails = thumbnailLoader(renderFirstPage);
