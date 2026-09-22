import { documentExtension, type SupportedDocumentType } from '../../lib/media';

/** RFC 5987's attr-char leaves out four that encodeURIComponent lets through: ' ( ) *. */
function encodeFilename(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * How a document is handed to a reader: downloaded under its own name, or opened in the
 * browser if it is a PDF. `filename*` carries the name in UTF-8. `filename` is for the few
 * clients that read no other, and is the name itself only when it is printable ASCII that
 * needs no escaping.
 */
export function contentDisposition(name: string, type: SupportedDocumentType): string {
  const fallback = /^[ -~]+$/.test(name) && !/["\\]/.test(name) ? name : `file.${documentExtension(type)}`;
  return `${type === 'application/pdf' ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encodeFilename(name)}`;
}
