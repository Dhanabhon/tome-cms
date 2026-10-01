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
import { isPermanentUploadFailure, uploadFailureMessage, uploadImage, type UploadFailureCopy } from '../../lib/media-client';
import { runQueue } from '../../lib/upload-queue';
import type { Post } from '../../types/cms';
import Icon from '../Icon';
import SaveButton from './SaveButton';
import { useDrawer } from './useDrawer';

type Text = AdminCopy['markdownImport'];
interface Preview { title: string; slug: string; locale: 'th' | 'en'; categories: string[]; pictures: ImportPicture[]; warnings: ImportWarning[] }
interface Source { fileName: string; text: string }
interface Props { editHref: string; mediaText: UploadFailureCopy['media']; text: Text }

/** A request the server refused, with what it said: the warning of a file it would not read. */
class ImportRefused extends Error {
  constructor(readonly refusal: ImportRefusal) {
    super('refused');
  }
}

async function send<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  const payload: { warning?: ImportWarning } | null = await response.json().catch(() => null);
  if (!response.ok) throw new ImportRefused({ status: response.status, warning: payload?.warning });
  return payload as T;
}

/** What makes two chosen files the same picture: the same file chosen twice is a new File each time. */
const fileKey = (file: File) => `${file.name}\n${file.size}\n${file.lastModified}`;

const without = <K, V>(map: ReadonlyMap<K, V>, key: K): Map<K, V> => {
  const next = new Map(map);
  next.delete(key);
  return next;
};

/**
 * "Import Markdown" on the post list: choose a file, match its pictures to files, and make a draft.
 * The server reads the file twice, once to show what it holds and once to import it, so nothing
 * lives between the steps but the sheet's state. The sheet is mounted only while it is open, so
 * closing it is also how it forgets and how it stops the uploads it has in flight.
 */
export default function MarkdownImport({ editHref, mediaText, text }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button aria-haspopup="dialog" className="admin-button admin-button--secondary" onClick={() => setOpen(true)} type="button">{text.open}</button>
      {open && <ImportSheet editHref={editHref} mediaText={mediaText} onClose={() => setOpen(false)} text={text} />}
    </>
  );
}

function ImportSheet({ editHref, mediaText, onClose, text }: Props & { onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorLine = useRef<HTMLParagraphElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const controller = useRef(new AbortController());
  // Set if the browser closes the dialog while the draft is being made; the sheet finishes that close once the answer is in.
  const closedWhilePosting = useRef(false);
  const postingNow = useRef(false);
  // A picture file is uploaded once however often it is tried, so a retry never doubles the File Manager.
  const uploaded = useRef(new Map<string, string>());
  const [source, setSource] = useState<Source | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [files, setFiles] = useState<Map<string, File>>(new Map());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<Map<string, 'uploading' | 'done'>>(new Map());
  // A picture's own trouble, by address. A refused file is no longer matched; one that may pass on a retry stays matched.
  const [rowErrors, setRowErrors] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  // Only while the draft is being made: a close then would end in a draft the owner never hears about.
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ post: Post; report: string[] } | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ key: string } | null>(null);

  // The list behind the sheet was drawn before the draft existed.
  const leave = () => { if (result) window.location.reload(); else onClose(); };
  const { cancel, close, dialog } = useDrawer({ focus: closeButton, locked: posting, onClose: leave });

  useEffect(() => () => controller.current.abort(), []);
  const step = result ? 'done' : preview ? 'pictures' : 'choose';
  // The first step keeps the focus on the close button, where the sheet put it.
  useEffect(() => { if (step !== 'choose') heading.current?.focus(); }, [step]);
  useEffect(() => { if (error) errorLine.current?.focus(); }, [error]);
  // A control that is pressed often goes away as it is pressed; the focus is handed on, never dropped to the page.
  useEffect(() => {
    if (!focusRequest) return;
    const target = dialog.current?.querySelector<HTMLElement>(`[data-focus="${focusRequest.key}"]`)
      ?? foot.current?.querySelector<HTMLElement>('button:not(:disabled)')
      ?? heading.current;
    target?.focus();
  }, [dialog, focusRequest]);

  const pictures = preview?.pictures ?? [];
  const waiting = (matched: ReadonlyMap<string, File>, skips: ReadonlySet<string>) =>
    pictures.filter((picture) => needsFile(picture) && !matched.has(picture.src) && !skips.has(picture.src));
  const stillWaiting = waiting(files, skipped);
  const focusNextRow = (after: number, matched: ReadonlyMap<string, File>) => {
    const index = pictures.findIndex((picture, at) => at > after && waiting(matched, skipped).includes(picture));
    const first = pictures.findIndex((picture) => waiting(matched, skipped).includes(picture));
    const target = index === -1 ? first : index;
    setFocusRequest({ key: target === -1 ? 'import' : `row:${target}` });
  };

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

  /** Uploads each matched file once, two at a time. Returns the pictures that could not go up, by address. */
  async function uploadMatches(): Promise<Map<string, { message: string; permanent: boolean }>> {
    const failed = new Map<string, { message: string; permanent: boolean }>();
    const toSend = [...new Map([...files.values()].filter((file) => !uploaded.current.has(fileKey(file))).map((file) => [fileKey(file), file])).values()];
    await runQueue(toSend, async (file) => {
      const key = fileKey(file);
      setSending((current) => new Map(current).set(key, 'uploading'));
      try {
        uploaded.current.set(key, (await uploadImage(file, { signal: controller.current.signal })).id);
        setSending((current) => new Map(current).set(key, 'done'));
      } catch (cause) {
        setSending((current) => without(current, key));
        const failure = { message: uploadFailureMessage(cause, { media: mediaText }), permanent: isPermanentUploadFailure(cause) };
        for (const [src, match] of files) if (fileKey(match) === key) failed.set(src, failure);
        throw cause;
      }
    });
    return failed;
  }

  async function runImport() {
    if (!source || !preview || stillWaiting.length) return;
    let made = false;
    setBusy(true);
    setError('');
    setRowErrors(new Map());
    // The button and the row's Retry both go away while this runs.
    heading.current?.focus();
    try {
      const failed = await uploadMatches();
      if (failed.size) {
        setRowErrors(new Map([...failed].map(([src, { message }]) => [src, message])));
        setFiles((current) => new Map([...current].filter(([src]) => !failed.get(src)?.permanent)));
        const first = pictures.findIndex((picture) => failed.has(picture.src));
        setFocusRequest({ key: `row:${first}` });
        return;
      }
      const matches = Object.fromEntries([...files].map(([src, file]) => [src, uploaded.current.get(fileKey(file))!]));
      setPosting(true);
      postingNow.current = true;
      // No signal: a request the server has taken makes its draft, so the sheet waits for the answer.
      const { post, warnings } = await send<{ post: Post; warnings: ImportWarning[] }>('/api/admin/posts/import', { ...source, pictures: matches });
      const unmatched = pictures.filter((picture) => !files.has(picture.src));
      const remote = unmatched.filter((picture) => picture.kind === 'remote' && picture.where === 'body').length;
      // A body picture with no file leaves a line in the post; a cover with none leaves the post without one.
      const missing = unmatched.filter((picture) => picture.where === 'body' && picture.kind !== 'remote').length;
      const noCover = unmatched.some((picture) => picture.where === 'cover');
      made = true;
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
      postingNow.current = false;
      setPosting(false);
      setBusy(false);
      // The dialog is already closed, so nothing is left to show the report on: the list is refreshed, or the sheet goes.
      if (closedWhilePosting.current) { if (made) window.location.reload(); else onClose(); }
    }
  }

  type RowState = 'done' | 'failed' | 'matched' | 'needs' | 'refused' | 'remote' | 'skipped' | 'uploading';
  function status(picture: ImportPicture): { line: string; state: RowState } {
    const file = files.get(picture.src);
    if (file) {
      const progress = sending.get(fileKey(file));
      if (progress) return { line: progress === 'done' ? text.uploaded : text.uploading, state: progress === 'done' ? 'done' : 'uploading' };
      if (rowErrors.has(picture.src)) return { line: rowErrors.get(picture.src)!, state: 'failed' };
      return { line: fill(text.matched, { name: file.name }), state: 'matched' };
    }
    if (picture.kind === 'refused') return { line: text.refused, state: 'refused' };
    if (skipped.has(picture.src)) return { line: text.skipped, state: 'skipped' };
    return needsFile(picture) ? { line: text.needsFile, state: 'needs' } : { line: text.remote, state: 'remote' };
  }

  const skip = (picture: ImportPicture, index: number) => {
    setSkipped((current) => new Set(current).add(picture.src));
    setFiles((current) => without(current, picture.src));
    setRowErrors((current) => without(current, picture.src));
    setFocusRequest({ key: `undo:${index}` });
  };
  const undo = (picture: ImportPicture, index: number) => {
    setSkipped((current) => { const next = new Set(current); next.delete(picture.src); return next; });
    setFocusRequest({ key: `row:${index}` });
  };
  const chooseForRow = (picture: ImportPicture, index: number, file: File) => {
    const next = new Map(files).set(picture.src, file);
    setFiles(next);
    setRowErrors((current) => without(current, picture.src));
    focusNextRow(index, next);
  };

  const languages = { en: text.languageEn, th: text.languageTh };
  // On the body, not where the button is: the page head styles the paragraphs and buttons inside it.
  return createPortal(
    <dialog aria-labelledby="markdown-import-title" className="media-upload-dialog" onCancel={cancel} onClose={() => { if (postingNow.current) closedWhilePosting.current = true; }} ref={dialog}>
      <div className="media-upload-dialog__head">
        <h2 id="markdown-import-title" ref={heading} tabIndex={-1}>{result ? text.done : text.title}</h2>
        <button aria-disabled={posting} aria-label={text.close} className="admin-button admin-button--ghost admin-button--icon" disabled={posting} onClick={() => close()} ref={closeButton} type="button"><Icon name="close" /></button>
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
          <dl className="markdown-import-summary">
            <div><dt>{text.summaryLanguage}</dt><dd>{languages[preview.locale]}</dd></div>
            {preview.slug && <div><dt>{text.summarySlug}</dt><dd>{preview.slug}</dd></div>}
            <div><dt>{text.summaryCategories}</dt><dd>{preview.categories.length ? preview.categories.join(', ') : text.categoriesNone}</dd></div>
          </dl>
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
                  const nameId = `markdown-import-picture-${index}`;
                  const choose = (
                    <label className="admin-button admin-button--ghost media-upload">
                      <span>{text.pickOne}</span>
                      <input accept="image/*" aria-describedby={nameId} className="sr-only" data-focus={state === 'needs' ? `row:${index}` : undefined} onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; input.value = ''; if (file) chooseForRow(picture, index, file); }} type="file" />
                    </label>
                  );
                  const skipButton = <button aria-describedby={nameId} className="admin-button admin-button--ghost" onClick={() => skip(picture, index)} type="button">{text.skip}</button>;
                  return (
                    <li className="markdown-import-row" data-state={state} key={`${picture.where}:${picture.src}`}>
                      <span className="markdown-import-row__name" id={nameId}>{picture.where === 'cover' ? `${text.cover}: ` : ''}{pictureLabel(picture)}</span>
                      <span className="markdown-import-row__status" role={state === 'failed' ? 'alert' : undefined}>{line}</span>
                      {rowErrors.has(picture.src) && state === 'needs' && <span className="admin-field-error" role="alert">{rowErrors.get(picture.src)}</span>}
                      {!busy && state === 'needs' && <span className="markdown-import-row__actions">{choose}{skipButton}</span>}
                      {!busy && state === 'failed' && (
                        <span className="markdown-import-row__actions">
                          <button aria-describedby={nameId} className="admin-button admin-button--ghost" data-focus={`row:${index}`} onClick={() => void runImport()} type="button">{text.retry}</button>
                          {choose}{skipButton}
                        </span>
                      )}
                      {!busy && state === 'skipped' && <span className="markdown-import-row__actions"><button aria-describedby={nameId} className="admin-button admin-button--ghost" data-focus={`undo:${index}`} onClick={() => undo(picture, index)} type="button">{text.undoSkip}</button></span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {stillWaiting.length > 0 && <p className="markdown-import-hint" id="markdown-import-needed">{text.stillNeeded}</p>}
          <div className="media-upload-dialog__foot markdown-import-foot" ref={foot}>
            <SaveButton describedBy={stillWaiting.length ? 'markdown-import-needed' : undefined} disabled={stillWaiting.length > 0} label={text.import} onClick={() => void runImport()} savedLabel={text.done} savingLabel={text.importing} state={busy ? 'saving' : 'dirty'} />
          </div>
        </>
      )}
      {step === 'done' && result && (
        <>
          {result.report.length > 0 && <ul className="markdown-import-report">{result.report.map((line) => <li key={line}>{line}</li>)}</ul>}
          <div className="media-upload-dialog__foot markdown-import-foot" ref={foot}>
            <a className="admin-button admin-button--primary" href={editHref.replace('__ID__', result.post.id)}>{text.openDraft}</a>
          </div>
        </>
      )}
      {error && <p className="admin-field-error" ref={errorLine} role="alert" tabIndex={-1}>{error}</p>}
      {step === 'pictures' && uploaded.current.size > 0 && (error || rowErrors.size > 0) && <p className="markdown-import-hint">{text.uploadedStay}</p>}
    </dialog>,
    document.body,
  );
}
