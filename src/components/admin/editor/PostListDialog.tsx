import { useEffect, useId, useRef, useState } from 'react';

import { fill, type AdminCopy } from '../../../lib/admin-i18n';
import {
  DEFAULT_POST_LIST_LIMIT,
  MAX_POST_LIST_ITEMS,
  postListAttrs,
  type PostListAttrs,
  type PostListLayout,
  type PostListOption,
} from '../../../lib/editor-post-list';
import { closeOverlay } from '../../../lib/overlay-motion';
import { adminButtonClass } from '../../../lib/ui-dialog';
import type { PostCategorySummary, PostLocale } from '../../../types/cms';
import Icon from '../../Icon';
import UiSelect from '../UiSelect';

const LAYOUTS: PostListLayout[] = ['grid-3', 'grid-2', 'list'];

export const postOptionsUrl = (locale: PostLocale) => `/api/admin/post-list-options?locale=${locale}`;
export const CATEGORIES_URL = '/api/admin/categories';

/** One list from the admin API: null until it answers, 'failed' if it cannot, and no read at all for no address. */
export function useAdminList<T>(url: string | null, key: string): T[] | 'failed' | null {
  const [answer, setAnswer] = useState<T[] | 'failed' | null>(null);
  useEffect(() => {
    if (!url) return;
    let current = true;
    setAnswer(null);
    fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
        return (await response.json() as Record<string, T[]>)[key];
      })
      .then((list) => { if (current) setAnswer(list ?? 'failed'); })
      .catch(() => { if (current) setAnswer('failed'); });
    return () => { current = false; };
  }, [key, url]);
  return answer;
}

interface PostListDialogProps {
  copy: AdminCopy;
  current?: PostListAttrs;
  locale: PostLocale;
  onDone: (attrs: PostListAttrs | null) => void;
}

export default function PostListDialog({ copy, current, locale, onDone }: PostListDialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const completed = useRef(false);
  const options = useAdminList<PostListOption>(postOptionsUrl(locale), 'options');
  const categories = useAdminList<PostCategorySummary>(CATEGORIES_URL, 'categories');
  const [source, setSource] = useState(current?.source ?? 'posts');
  const [picked, setPicked] = useState(current?.postGroupIds ?? []);
  const [categoryId, setCategoryId] = useState(current?.categoryId ?? '');
  const [limit, setLimit] = useState(String(current?.limit ?? DEFAULT_POST_LIST_LIMIT));
  const [layout, setLayout] = useState<PostListLayout>(current?.layout ?? 'grid-3');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      completed.current = true;
      if (element?.open) element.close();
    };
  }, []);

  /** `played` is false when the browser has already closed it itself, as an Escape the page may not hold back does. */
  const leave = (attrs: PostListAttrs | null, played = true) => {
    if (completed.current) return;
    completed.current = true;
    if (played && dialog.current) void closeOverlay(dialog.current).then(() => onDone(attrs));
    else onDone(attrs);
  };

  const titled = Array.isArray(options) ? options : [];
  const known = Array.isArray(categories) ? categories : [];
  // A category deleted since the block was set is no choice, so the select and Save both say so.
  const chosenCategory = known.some((category) => category.id === categoryId) ? categoryId : '';
  const asked = search.trim().toLowerCase();
  const shown = titled.filter((option) => option.title.toLowerCase().includes(asked));
  const full = picked.length >= MAX_POST_LIST_ITEMS;

  const attrs = source === 'posts'
    ? (Array.isArray(options) && picked.length ? postListAttrs({ source, postGroupIds: picked, categoryId: null, limit: DEFAULT_POST_LIST_LIMIT, layout }) : null)
    : postListAttrs({ source, postGroupIds: [], categoryId: chosenCategory, limit: Number(limit), layout });

  const toggle = (group: string) => setPicked((now) => (now.includes(group) ? now.filter((one) => one !== group) : [...now, group]));
  const move = (from: number, to: number, button: HTMLButtonElement) => {
    setPicked((now) => {
      const next = [...now];
      const [group] = next.splice(from, 1);
      next.splice(to, 0, group!);
      return next;
    });
    // A row moved to the end has no further to go, and its button turns off under the keyboard:
    // the focus goes on to the row's way back rather than being lost.
    requestAnimationFrame(() => (button.disabled ? button.parentElement?.querySelector<HTMLButtonElement>('button:not(:disabled)') : button)?.focus());
  };

  return (
    <dialog
      aria-labelledby={`${id}-title`}
      className="ui-dialog post-list-dialog"
      onCancel={(event) => {
        // Chromium lets a page hold Escape back only once the reader has done something on it.
        if (event.cancelable) event.preventDefault();
        leave(null, event.cancelable);
      }}
      ref={dialog}
    >
      <div className="ui-dialog__surface post-list-dialog__surface">
        <h2 id={`${id}-title`}>{copy.blocks.postList}</h2>

        <fieldset className="navigation-kinds">
          <legend>{copy.blocks.postListSource}</legend>
          <label><input checked={source === 'posts'} name={`${id}-source`} onChange={() => setSource('posts')} type="radio" /> {copy.blocks.postListSourcePosts}</label>
          <label><input checked={source === 'category'} name={`${id}-source`} onChange={() => setSource('category')} type="radio" /> {copy.blocks.postListSourceCategory}</label>
        </fieldset>

        {source === 'posts' ? (
          <>
            {options === 'failed' ? <p className="admin-alert" role="alert">{copy.blocks.postListPostsFailed}</p> : (
              <>
                <label className="admin-field">
                  <span>{copy.blocks.postListSearch}</span>
                  <input className="admin-control" onChange={(event) => setSearch(event.target.value)} type="search" value={search} />
                </label>
                <ul className="post-list-dialog__options">
                  {shown.map((option) => {
                    const ticked = picked.includes(option.groupId);
                    return (
                      <li key={option.groupId}>
                        <label>
                          <input checked={ticked} disabled={full && !ticked} onChange={() => toggle(option.groupId)} type="checkbox" />
                          <span>{option.title}</span>
                          {option.status !== 'published' && <small>{copy.status[option.status]}</small>}
                        </label>
                      </li>
                    );
                  })}
                  {options && !shown.length && <li className="admin-hint">{titled.length ? copy.blocks.postListNoMatch : copy.blocks.postListNoPosts}</li>}
                </ul>
                {full && <p className="admin-hint" role="status">{fill(copy.blocks.postListFull, { count: MAX_POST_LIST_ITEMS })}</p>}
              </>
            )}
            {picked.length > 0 && options !== 'failed' && (
              <div>
                <h3 id={`${id}-chosen`}>{copy.blocks.postListChosen}</h3>
                <ol aria-labelledby={`${id}-chosen`} className="post-list-dialog__chosen">
                  {picked.map((group, index) => {
                    const option = titled.find((one) => one.groupId === group);
                    // Until the titles are in, there is nothing yet to say a row is missing from.
                    const title = option?.title ?? (options ? copy.blocks.postListRowGone : '…');
                    const up = fill(copy.blocks.postListMoveUp, { title });
                    const down = fill(copy.blocks.postListMoveDown, { title });
                    const remove = fill(copy.blocks.postListRemove, { title });
                    return (
                      <li key={group}>
                        <span>{title}</span>
                        <span className="post-list-dialog__row-actions">
                          <button aria-label={up} className="admin-button admin-button--ghost admin-button--icon" disabled={index === 0} onClick={(event) => move(index, index - 1, event.currentTarget)} title={up} type="button"><Icon name="up" /></button>
                          <button aria-label={down} className="admin-button admin-button--ghost admin-button--icon" disabled={index === picked.length - 1} onClick={(event) => move(index, index + 1, event.currentTarget)} title={down} type="button"><Icon name="down" /></button>
                          <button aria-label={remove} className="admin-button admin-button--ghost admin-button--icon" onClick={() => toggle(group)} title={remove} type="button"><Icon name="close" /></button>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </>
        ) : categories === 'failed' ? <p className="admin-alert" role="alert">{copy.blocks.postListCategoriesFailed}</p> : (
          <div className="settings-pair">
            <div className="admin-field">
              <span aria-hidden="true">{copy.blocks.postListCategory}</span>
              <UiSelect
                ariaLabel={copy.blocks.postListCategory}
                className="admin-control"
                id={`${id}-category-select`}
                onValueChange={setCategoryId}
                options={[
                  { label: copy.blocks.postListCategoryChoose, value: '' },
                  ...known.map((category) => ({ label: category.name, value: category.id })),
                ]}
                value={chosenCategory}
              />
            </div>
            <label className="admin-field">
              <span>{fill(copy.blocks.postListLimit, { count: MAX_POST_LIST_ITEMS })}</span>
              <input className="admin-control" inputMode="numeric" max={MAX_POST_LIST_ITEMS} min={1} onChange={(event) => setLimit(event.target.value)} type="number" value={limit} />
            </label>
          </div>
        )}

        <fieldset className="navigation-kinds">
          <legend>{copy.blocks.postListLayout}</legend>
          {LAYOUTS.map((value) => (
            <label key={value}><input checked={layout === value} name={`${id}-layout`} onChange={() => setLayout(value)} type="radio" /> {copy.blocks.postListLayouts[value]}</label>
          ))}
        </fieldset>

        <div className="ui-dialog__actions">
          <button className={adminButtonClass('cancel', 'default')} onClick={() => leave(null)} type="button">{copy.shell.cancel}</button>
          <button className={adminButtonClass('confirm', 'default')} disabled={!attrs} onClick={() => leave(attrs)} type="button">{copy.blocks.postListSave}</button>
        </div>
      </div>
    </dialog>
  );
}
