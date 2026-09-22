import { createHash } from 'node:crypto';

import type { SupportedDocumentType } from '../../lib/media';

/** How much of a document's start a read keeps: more than any signature it is held to. */
export const HEAD_BYTES = 1024;
/** A ZIP's end record is 22 bytes, and a comment of up to 65,535 may follow it. */
export const ZIP_TAIL_BYTES = 22 + 0xffff;
/** An Office file's directory runs to kilobytes; one past a megabyte is not one. */
export const MAX_CENTRAL_DIRECTORY_BYTES = 1024 * 1024;

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;

/** The part every producer of each Office type writes. */
const MAIN_PART: Partial<Record<SupportedDocumentType, string>> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word/document.xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xl/workbook.xml',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'ppt/presentation.xml',
};

/** Why a document is refused, as the code the admin finds its words by. */
export type DocumentRefusal = 'media_macros' | 'media_text_encoding' | 'media_type_mismatch';

export interface DocumentRead {
  checksum: string;
  head: Buffer;
  size: number;
  /** Whether every byte was UTF-8 and none was zero. Only asked of text. */
  utf8: boolean;
}

export interface CentralDirectory {
  entries: number;
  offset: number;
  size: number;
}

export function isTextDocument(type: SupportedDocumentType): boolean {
  return type === 'text/csv' || type === 'text/plain';
}

/**
 * One pass over a document as the store sends it: the hash of all of it, its first kilobyte,
 * and, for text, whether it is UTF-8 without a zero byte. Nothing else is kept, so a 25 MB file
 * costs what a kilobyte does. Null when it runs past `maximum`.
 */
export async function readDocument(body: AsyncIterable<Uint8Array>, maximum: number, text: boolean): Promise<DocumentRead | null> {
  const hash = createHash('sha256');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const head: Buffer[] = [];
  let kept = 0;
  let size = 0;
  let utf8 = text;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > maximum) return null;
    hash.update(chunk);
    if (kept < HEAD_BYTES) {
      const part = Buffer.from(chunk.subarray(0, HEAD_BYTES - kept));
      head.push(part);
      kept += part.length;
    }
    if (utf8 && chunk.includes(0)) utf8 = false;
    if (utf8) {
      try {
        decoder.decode(chunk, { stream: true });
      } catch {
        utf8 = false;
      }
    }
  }
  if (utf8) {
    try {
      decoder.decode();
    } catch {
      utf8 = false;
    }
  }
  return { checksum: hash.digest('base64'), head: Buffer.concat(head), size, utf8 };
}

/**
 * The central directory an end record in `tail` points at, if `tail` really ends a ZIP of
 * `fileSize` bytes: the record's comment has to run exactly to the end, and the directory has
 * to lie before the record. A ZIP64 archive, whose record points nowhere, is not one here.
 */
export function findCentralDirectory(tail: Buffer, fileSize: number): CentralDirectory | null {
  for (let at = tail.length - 22; at >= 0; at -= 1) {
    if (tail.readUInt32LE(at) !== END_OF_DIRECTORY) continue;
    if (at + 22 + tail.readUInt16LE(at + 20) !== tail.length) continue;
    const directory = { entries: tail.readUInt16LE(at + 10), offset: tail.readUInt32LE(at + 16), size: tail.readUInt32LE(at + 12) };
    return directory.offset + directory.size <= fileSize - tail.length + at ? directory : null;
  }
  return null;
}

/** The names in a central directory, or null when it is not one. */
export function centralDirectoryNames(directory: Buffer, entries: number): string[] | null {
  const names: string[] = [];
  let at = 0;
  for (let index = 0; index < entries; index += 1) {
    if (at + 46 > directory.length || directory.readUInt32LE(at) !== CENTRAL_HEADER) return null;
    const nameLength = directory.readUInt16LE(at + 28);
    const next = at + 46 + nameLength + directory.readUInt16LE(at + 30) + directory.readUInt16LE(at + 32);
    if (next > directory.length) return null;
    names.push(directory.subarray(at + 46, at + 46 + nameLength).toString('utf8'));
    at = next;
  }
  return at === directory.length ? names : null;
}

/**
 * Why a document's bytes are not what its type says, or null when they are. Text and a PDF are
 * judged by the read alone. A ZIP, and the three Office types built on one, by what its end
 * says of its directory: `range` fetches that from the store, and nothing else is fetched.
 */
export async function documentRefusal(
  type: SupportedDocumentType,
  read: DocumentRead,
  range: (start: number, end: number) => Promise<Buffer>,
): Promise<DocumentRefusal | null> {
  if (isTextDocument(type)) return read.utf8 ? null : 'media_text_encoding';
  if (type === 'application/pdf') return read.head.subarray(0, 5).toString('latin1') === '%PDF-' ? null : 'media_type_mismatch';

  const signature = read.head.length >= 4 ? read.head.readUInt32LE(0) : 0;
  const emptyArchive = type === 'application/zip' && read.size === 22 && signature === END_OF_DIRECTORY;
  if (signature !== LOCAL_HEADER && !emptyArchive) return 'media_type_mismatch';
  const directory = findCentralDirectory(await range(Math.max(0, read.size - ZIP_TAIL_BYTES), read.size - 1), read.size);
  if (!directory) return 'media_type_mismatch';
  const main = MAIN_PART[type];
  if (!main) return null;

  if (!directory.size || directory.size > MAX_CENTRAL_DIRECTORY_BYTES) return 'media_type_mismatch';
  const names = centralDirectoryNames(await range(directory.offset, directory.offset + directory.size - 1), directory.entries);
  if (!names) return 'media_type_mismatch';
  if (names.some((name) => /(^|\/)vbaProject\.bin$/i.test(name))) return 'media_macros';
  return names.includes('[Content_Types].xml') && names.includes(main) ? null : 'media_type_mismatch';
}
