import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { fill, type AdminCopy } from '../../lib/admin-i18n';
import {
  MAX_MARKDOWN_BYTES,
  MISSING_IMAGE,
  matchFiles,
  needsFile,
  pictureLabel,
  type ImportPicture,
  type ImportWarning,
} from '../../lib/markdown-import';
import { refusalText, warningText, type ImportRefusal } from '../../lib/markdown-import-text';
import { uploadImage } from '../../lib/media-client';
import { runQueue } from '../../lib/upload-queue';
import type { Post } from '../../types/cms';
import Icon from '../Icon';
import SaveButton from './SaveButton';
import { useDrawer } from './useDrawer';

type Text = AdminCopy['markdownImport'];
interface Preview { title: string; slug: string; locale: 'th' | 'en'; categories: string[]; pictures: ImportPicture[]; warnings: ImportWarning[] }
interface Source { fileName: string; text: string }

/** A request the server refused, with what it said: the warning of a file it would not read. */
class ImportRefused extends Error {
  constructor(readonly refusal: ImportRefusal) {
    super('refused');
  }
}

async function send<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  const payload: { warning?: ImportWarning } | null = await response.json().catch(() => null);
  if (!response.ok) throw new ImportRefused({ status: response.status, warning: payload?.warning });
  return payload as T;
}

const without = <K, V>(map: ReadonlyMap<K, V>, key: K): Map<K, V> => {
  const next = new Map(map);
  next.delete(key);
  return next;
};

/**
 * "Import Markdown" on the post list: choose a file, match its pictures to files, and make a draft.
 * The server reads the file twice, once to show what it holds and once to import it, so nothing
 * lives between the steps but the sheet's state. The sheet is mounted only while it is open, so
 * closing it is also how it forgets and how it stops what it has in flight.
 */
export default function MarkdownImport({ text, editHref }: { text: Text; editHref: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button aria-haspopup="dialog" className="admin-button admin-button--secondary" onClick={() => setOpen(true)} type="button">{text.open}</button>
      {open && <ImportSheet editHref={editHref} onClose={() => setOpen(false)} text={text} />}
    </>
  );
}

function ImportSheet({ editHref, onClose, text }: { editHref: string; onClose: () => void; text: Text }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const { cancel, close, dialog } = useDrawer({ focus: closeButton, onClose });
  // Closing ends an import that is still on the wire; a draft whose request had already landed is in the list.
  const controller = useRef(new AbortController());
  // A picture file is uploaded once however often it is tried, so a retry never doubles the File Manager.
  const uploaded = useRef(new Map<File, string>());
  const [source, setSource] = useState<Source | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [files, setFiles] = useState<Map<string, File>>(new Map());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<Map<File, 'uploading' | 'done'>>(new Map());
  const [rowErrors, setRowErrors] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ post: Post; report: string[] } | null>(null);

  useEffect(() => () => controller.current.abort(), []);
  const step = result ? 'done' : preview ? 'pictures' : 'choose';
  // The first step keeps the focus on the close button, where the sheet put it.
  useEffect(() => { if (step !== 'choose') heading.current?.focus(); }, [step]);

  const pictures = preview?.pictures ?? [];
  const waiting = pictures.filter((picture) => needsFile(picture) && !files.has(picture.src) && !skipped.has(picture.src));

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setError('');
    if (file.size > MAX_MARKDOWN_BYTES) { setError(text.tooLarge); return; }
    setBusy(true);
    try {
      const next = { fileName: file.name, text: await file.text() };
      const { preview: read } = await send<{ preview: Preview }>('/api/admin/posts/import/preview', next, controller.current.signal);
      setSource(next);
      setPreview(read);
    } catch (cause) {
      if (!controller.current.signal.aborted) setError(refusalText(text, cause instanceof ImportRefused ? cause.refusal : undefined));
    } finally {
      setBusy(false);
    }
  }

  /** Uploads each matched file once, two at a time; a file that fails goes back to its pictures as needing another. */
  async function uploadMatches(): Promise<boolean> {
    const failed: File[] = [];
    await runQueue([...new Set(files.values())].filter((file) => !uploaded.current.has(file)), async (file) => {
      setSending((current) => new Map(current).set(file, 'uploading'));
      try {
        uploaded.current.set(file, (await uploadImage(file, { signal: controller.current.signal })).id);
        setSending((current) => new Map(current).set(file, 'done'));
      } catch (cause) {
        setSending((current) => without(current, file));
        failed.push(file);
        throw cause;
      }
    });
    if (!failed.length) return true;
    const errors = new Map<string, string>();
    for (const [src, file] of files) if (failed.includes(file)) errors.set(src, fill(text.uploadFailed, { name: file.name }));
    setRowErrors(errors);
    setFiles((current) => new Map([...current].filter(([, file]) => !failed.includes(file))));
    return false;
  }

  async function runImport() {
    if (!source || !preview || waiting.length) return;
    setBusy(true);
    setError('');
    setRowErrors(new Map());
    try {
      if (!await uploadMatches()) return;
      const matches = Object.fromEntries([...files].map(([src, file]) => [src, uploaded.current.get(file)!]));
      const { post, warnings } = await send<{ post: Post; warnings: ImportWarning[] }>('/api/admin/posts/import', { ...source, pictures: matches }, controller.current.signal);
      const unmatched = pictures.filter((picture) => !files.has(picture.src));
      const remote = unmatched.filter((picture) => picture.kind === 'remote' && picture.where === 'body').length;
      // A body picture with no file leaves a line in the post; a cover with none leaves the post without one.
      const missing = unmatched.filter((picture) => picture.where === 'body' && picture.kind !== 'remote').length;
      const noCover = unmatched.some((picture) => picture.where === 'cover');
      setResult({
        post,
        report: [
          ...(remote ? [remote === 1 ? text.reportRemoteOne : fill(text.reportRemote, { count: remote })] : []),
          ...(missing ? [fill(missing === 1 ? text.reportSkippedOne : text.reportSkipped, { count: missing, label: MISSING_IMAGE[preview.locale] })] : []),
          ...(noCover ? [text.reportNoCover] : []),
          ...warnings.map((warning) => warningText(text, warning)),
        ],
      });
    } catch (cause) {
      if (!controller.current.signal.aborted) setError(refusalText(text, cause instanceof ImportRefused ? cause.refusal : undefined));
    } finally {
      setBusy(false);
    }
  }

  function status(picture: ImportPicture): { line: string; state: string } {
    const file = files.get(picture.src);
    if (file) {
      const progress = sending.get(file);
      return progress
        ? { line: progress === 'done' ? text.uploaded : text.uploading, state: progress }
        : { line: fill(text.matched, { name: file.name }), state: 'matched' };
    }
    if (picture.kind === 'refused') return { line: text.refused, state: 'refused' };
    if (skipped.has(picture.src)) return { line: text.skipped, state: 'skipped' };
    return needsFile(picture) ? { line: text.needsFile, state: 'needs' } : { line: text.remote, state: 'remote' };
  }

  const toggleSkip = (src: string, skip: boolean) => setSkipped((current) => {
    const next = new Set(current);
    if (skip) next.add(src);
    else next.delete(src);
    return next;
  });

  // On the body, not where the button is: the page head styles the paragraphs and buttons inside it.
  return createPortal(
    <dialog aria-labelledby="markdown-import-title" className="media-upload-dialog" onCancel={cancel} ref={dialog}>
      <div className="media-upload-dialog__head">
        <h2 id="markdown-import-title" ref={heading} tabIndex={-1}>{result ? text.done : text.title}</h2>
        <button aria-label={text.close} className="admin-button admin-button--ghost admin-button--icon" onClick={() => close()} ref={closeButton} type="button"><Icon name="close" /></button>
      </div>
      {step === 'choose' && (
        <>
          <p className="markdown-import-lede">{text.chooseHint}</p>
          <label aria-busy={busy} className="admin-button admin-button--primary media-upload">
            <span>{text.chooseFile}</span>
            <input accept=".md,.markdown,text/markdown" className="sr-only" data-testid="markdown-file" disabled={busy} onChange={(event) => { const input = event.currentTarget; void chooseFile(input.files?.[0]); input.value = ''; }} type="file" />
          </label>
        </>
      )}
      {step === 'pictures' && preview && (
        <>
          <p className="markdown-import-title"><strong>{preview.title}</strong></p>
          {pictures.length > 0 && (
            <section aria-labelledby="markdown-import-pictures">
              <h3 className="markdown-import-heading" id="markdown-import-pictures">{text.picturesHeading}</h3>
              <p className="markdown-import-lede">{text.picturesHint}</p>
              <label className="admin-button admin-button--secondary media-upload">
                <span>{text.choosePictures}</span>
                <input accept="image/*" className="sr-only" data-testid="markdown-pictures" disabled={busy} multiple onChange={(event) => { const input = event.currentTarget; const chosen = [...(input.files ?? [])]; setFiles((current) => matchFiles(pictures, chosen, current)); input.value = ''; }} type="file" />
              </label>
              <ul className="markdown-import-list">
                {pictures.map((picture, index) => {
                  const { line, state } = status(picture);
                  const rowError = rowErrors.get(picture.src);
                  const pending = state === 'needs' && !busy;
                  return (
                    <li className="markdown-import-row" data-state={state} key={`${picture.where}:${picture.src}`}>
                      <span className="markdown-import-row__name" id={`markdown-import-picture-${index}`}>{picture.where === 'cover' ? `${text.cover}: ` : ''}{pictureLabel(picture)}</span>
                      <span className="markdown-import-row__status">{line}</span>
                      {rowError && <span className="admin-field-error" role="alert">{rowError}</span>}
                      {(pending || (state === 'skipped' && !busy)) && (
                        <span className="markdown-import-row__actions">
                          {state === 'skipped'
                            ? <button aria-describedby={`markdown-import-picture-${index}`} className="admin-button admin-button--ghost" onClick={() => toggleSkip(picture.src, false)} type="button">{text.undoSkip}</button>
                            : (
                              <>
                                <label className="admin-button admin-button--ghost media-upload">
                                  <span>{text.pickOne}</span>
                                  <input accept="image/*" aria-describedby={`markdown-import-picture-${index}`} className="sr-only" onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; if (file) setFiles((current) => new Map(current).set(picture.src, file)); input.value = ''; }} type="file" />
                                </label>
                                <button aria-describedby={`markdown-import-picture-${index}`} className="admin-button admin-button--ghost" onClick={() => toggleSkip(picture.src, true)} type="button">{text.skip}</button>
                              </>
                            )}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {waiting.length > 0 && <p className="markdown-import-hint">{text.stillNeeded}</p>}
          <div className="media-upload-dialog__foot markdown-import-foot">
            <SaveButton disabled={waiting.length > 0} label={text.import} onClick={() => void runImport()} savedLabel={text.done} savingLabel={text.importing} state={busy ? 'saving' : 'dirty'} />
          </div>
        </>
      )}
      {step === 'done' && result && (
        <>
          {result.report.length > 0 && <ul className="markdown-import-report">{result.report.map((line) => <li key={line}>{line}</li>)}</ul>}
          <div className="media-upload-dialog__foot markdown-import-foot">
            <a className="admin-button admin-button--primary" href={editHref.replace('__ID__', result.post.id)}>{text.openDraft}</a>
          </div>
        </>
      )}
      {error && <p className="admin-field-error" role="alert">{error}</p>}
      {step === 'pictures' && uploaded.current.size > 0 && (error || rowErrors.size > 0) && <p className="markdown-import-hint">{text.uploadedStay}</p>}
    </dialog>,
    document.body,
  );
}
