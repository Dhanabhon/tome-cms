import { useCallback, useRef, useState, type MutableRefObject } from 'react';

export type EditorSaveState = 'Saved' | 'Saving…' | 'Unsaved' | 'Save failed';

export interface EditorSaveQueue<TEntity, TStatus> {
  dirty: boolean;
  dirtyRef: MutableRefObject<boolean>;
  markDirty: () => void;
  pendingCount: MutableRefObject<number>;
  persist: (status?: TStatus) => Promise<TEntity>;
  saveState: EditorSaveState;
}

interface EditorSaveQueueOptions<TSnapshot, TEntity, TStatus> {
  onError?: (error: unknown) => void;
  save: (snapshot: TSnapshot, status?: TStatus) => Promise<TEntity>;
  snapshot: () => TSnapshot;
}

export default function useEditorSaveQueue<TSnapshot, TEntity, TStatus>({
  onError,
  save,
  snapshot,
}: EditorSaveQueueOptions<TSnapshot, TEntity, TStatus>): EditorSaveQueue<TEntity, TStatus> {
  const changeVersion = useRef(0);
  const saveTail = useRef<Promise<TEntity | null>>(Promise.resolve(null));
  const pendingCount = useRef(0);
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<EditorSaveState>('Saved');

  const markDirty = useCallback(() => {
    changeVersion.current += 1;
    dirtyRef.current = true;
    setDirty(true);
    setSaveState((current) => current === 'Save failed' ? current : 'Unsaved');
  }, []);

  const persist = useCallback((status?: TStatus): Promise<TEntity> => {
    pendingCount.current += 1;
    const pending = saveTail.current.catch(() => null).then(async () => {
      const currentSnapshot = snapshot();
      const version = changeVersion.current;
      setSaveState((current) => current === 'Save failed' ? current : 'Saving…');
      const entity = await save(currentSnapshot, status);

      if (version === changeVersion.current) {
        dirtyRef.current = false;
        setDirty(false);
        setSaveState('Saved');
      } else {
        setSaveState('Unsaved');
      }
      return entity;
    }).catch((error: unknown) => {
      dirtyRef.current = true;
      setDirty(true);
      setSaveState('Save failed');
      onError?.(error);
      throw error;
    }).finally(() => {
      pendingCount.current -= 1;
    });
    saveTail.current = pending.catch(() => null);
    return pending;
  }, [onError, save, snapshot]);

  return { dirty, dirtyRef, markDirty, pendingCount, persist, saveState };
}
