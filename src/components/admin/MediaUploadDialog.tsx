import { useEffect, useRef, useState } from 'react';

import { fill, type AdminCopy } from '../../lib/admin-i18n';
import { precheck, uploadFailureText, uploadFile } from '../../lib/media-client';
import { closeOverlay } from '../../lib/overlay-motion';
import { confirmUi } from '../../lib/ui-dialog';
import { runQueue } from '../../lib/upload-queue';
import type { MediaFolder } from '../../types/cms';
import Icon from '../Icon';
import UiSelect from './UiSelect';

type RowStatus = 'ready' | 'refused' | 'queued' | 'uploading' | 'done' | 'failed';
type Row = { error?: string; file: File; id: number; progress: number; status: RowStatus };

interface MediaUploadDialogProps {
  copy: AdminCopy;
  files: File[];
  folders: MediaFolder[];
  /** '' is Unsorted. */
  initialFolderId: string;
  /** The folder the files were filed into, and whether any of them went up. */
  onClose: (folderId: string, uploadedAny: boolean) => void;
}

/**
 * Files chosen in the system's file chooser land here first: listed, checked, filed into a folder,
 * then sent two at a time. Each row reports itself; one failure does not stop the others.
 */
export default function MediaUploadDialog({ copy, files, folders, initialFolderId, onClose }: MediaUploadDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stopped = useRef(false);
  const [folderId, setFolderId] = useState(initialFolderId);
  const [rows, setRows] = useState<Row[]>(() => files.map((file, id) => {
    const check = precheck(file, 'any');
    return check.ok
      ? { file, id, progress: 0, status: 'ready' }
      : { error: uploadFailureText(check.error, copy) ?? copy.media.unavailable, file, id, progress: 0, status: 'refused' };
  }));
  const [started, setStarted] = useState(false);
  const running = rows.some((row) => row.status === 'queued' || row.status === 'uploading');
  const ready = rows.filter((row) => row.status === 'ready');

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  const update = (id: number, patch: Partial<Row>) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const send = async (targets: Row[]) => {
    setStarted(true);
    for (const { id } of targets) update(id, { error: undefined, progress: 0, status: 'queued' });
    await runQueue(targets, async ({ file, id }) => {
      // Stopped from the leave prompt: what is already on its way finishes, nothing new starts.
      if (stopped.current) return;
      update(id, { status: 'uploading' });
      try {
        await uploadFile(file, { accept: 'any', folderId: folderId || null, onProgress: (progress) => update(id, { progress }) });
        update(id, { progress: 100, status: 'done' });
      } catch (error) {
        update(id, { error: uploadFailureText(error, copy) ?? copy.media.unavailable, status: 'failed' });
        throw error;
      }
    });
  };

  const close = async () => {
    if (running) {
      const leave = await confirmUi({ cancelLabel: copy.shell.cancel, confirmLabel: copy.media.uploadStop, message: copy.media.uploadLeaveBody, title: copy.media.uploadLeave });
      if (!leave) return;
      stopped.current = true;
    }
    if (dialog.current) await closeOverlay(dialog.current);
    onClose(folderId, rows.some((row) => row.status === 'done'));
  };

  const folderOptions = [{ label: copy.media.unsorted, value: '' }, ...folders.map((folder) => ({ label: folder.name, value: folder.id }))];

  return (
    <dialog aria-labelledby="media-upload-title" className="media-upload-dialog" onCancel={(event) => { event.preventDefault(); void close(); }} ref={dialog}>
      <div className="media-upload-dialog__head">
        <h2 id="media-upload-title">{copy.media.uploadTitle}</h2>
        <button aria-label={copy.shell.close} className="admin-button admin-button--ghost admin-button--icon" onClick={() => void close()} type="button"><Icon name="close" /></button>
      </div>
      <div className="admin-field">
        <label htmlFor="media-upload-folder">{copy.media.folder}</label>
        <UiSelect className="admin-control" disabled={started} id="media-upload-folder" onValueChange={setFolderId} options={folderOptions} value={folderId} />
      </div>
      <ul className="media-upload-list">
        {rows.map((row) => (
          <li className="media-upload-row" data-status={row.status} key={row.id}>
            <span className="media-upload-row__name">{row.file.name}</span>
            <span className="media-upload-row__meta">{Math.max(1, Math.round(row.file.size / 1024))} KB</span>
            {(row.status === 'queued' || row.status === 'uploading') && <progress className="update-progress" max={100} value={row.progress} />}
            {row.status === 'done' && <span className="media-upload-row__done"><Icon name="check" />{copy.media.uploadUploaded}</span>}
            {(row.status === 'refused' || row.status === 'failed') && <span className="admin-field-error" role="alert">{row.error}</span>}
            {row.status === 'failed' && <button className="admin-button" onClick={() => void send([row])} type="button">{copy.media.uploadRetry}</button>}
            {!started && <button aria-label={fill(copy.media.uploadRemove, { name: row.file.name })} className="admin-button admin-button--ghost admin-button--icon" onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))} type="button"><Icon name="trash" /></button>}
          </li>
        ))}
      </ul>
      <div className="media-upload-dialog__foot">
        {started
          ? <button className="admin-button admin-button--primary" disabled={running} onClick={() => void close()} type="button">{copy.media.uploadDone}</button>
          : <button className="admin-button admin-button--primary" disabled={!ready.length} onClick={() => void send(ready)} type="button">{ready.length === 1 ? copy.media.uploadOne : fill(copy.media.uploadCount, { count: ready.length })}</button>}
      </div>
    </dialog>
  );
}
