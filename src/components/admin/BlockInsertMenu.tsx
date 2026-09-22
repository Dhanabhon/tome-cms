import { useEditor } from 'novel';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

import type { AdminCopy } from '../../lib/admin-i18n';
import { NEW_TABLE } from '../../lib/editor-table';
import type { MediaAsset } from '../../types/cms';
import Icon from '../Icon';
import MediaPicker from './MediaPicker';

const MENU_ID = 'block-insert-menu';
/** From the line's top to the menu's, when it opens below the + button. */
const GAP_BELOW = 42;
/** From the menu's bottom to the line's top, when it opens above. */
const GAP_ABOVE = 6;
/** Kept between the menu and whatever would cover or cut it. */
const MARGIN = 8;
/** Held any shorter than this, a menu is a slot to scroll a list through. */
const LEAST_ROOM = 128;

export default function BlockInsertMenu({ copy }: { copy: AdminCopy }) {
  const { editor } = useEditor();
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const frame = useRef<number | null>(null);
  const savedPosition = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; menuLeft: number; menuMaxHeight?: number; menuTop: number; top: number }>(
    { left: 0, menuLeft: 0, menuTop: GAP_BELOW, top: 0 },
  );
  const [visible, setVisible] = useState(false);

  const update = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    const ownsFocus = editor.isFocused || Boolean(root.current?.contains(document.activeElement));
    const shouldShow = editor.isEditable && editor.state.selection.empty && ownsFocus;
    setVisible(shouldShow);
    if (!shouldShow && !pickerOpen) setMenuOpen(false);
    if (!shouldShow) return;

    const canvas = editor.view.dom.closest<HTMLElement>('.editor-canvas');
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const cursor = editor.view.coordsAtPos(editor.state.selection.from);
    const menuWidth = menu.current?.offsetWidth ?? 0;
    // Its whole height, not the height it was held to the last time it was placed.
    const menuHeight = menu.current?.scrollHeight ?? 0;
    const left = 0;
    const menuLeft = menuOpen ? Math.max(-left, Math.min(0, canvasRect.width - left - menuWidth)) : 0;
    // The editor's bar stays at the top of the window and covers what passes under it, so the
    // menu's room ends at the bar and not at the window's edge: a menu that opened under it
    // had its first items covered, and they could not be chosen.
    const ceiling = (document.querySelector('.admin-editor-bar')?.getBoundingClientRect().bottom ?? 0) + MARGIN;
    const below = window.innerHeight - MARGIN - (cursor.top + GAP_BELOW);
    const above = cursor.top - GAP_ABOVE - ceiling;
    // Below the line when it fits there, else on the side with more room -- held to that room,
    // and scrolled within when even that is short.
    const opensAbove = menuHeight > below && above > below;
    const room = Math.max(LEAST_ROOM, opensAbove ? above : below);
    const menuViewportTop = opensAbove ? cursor.top - GAP_ABOVE - Math.min(menuHeight, room) : cursor.top + GAP_BELOW;
    setPosition({
      left,
      menuLeft,
      menuMaxHeight: room,
      menuTop: menuViewportTop - cursor.top,
      top: cursor.top - canvasRect.top,
    });
  }, [editor, menuOpen, pickerOpen]);

  const scheduleUpdate = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (!editor?.isDestroyed) update();
    });
  }, [editor, update]);

  useEffect(() => {
    if (!editor) return;
    editor.on('focus', update);
    editor.on('blur', scheduleUpdate);
    editor.on('selectionUpdate', update);
    editor.on('transaction', scheduleUpdate);
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);
    update();
    return () => {
      editor.off('focus', update);
      editor.off('blur', scheduleUpdate);
      editor.off('selectionUpdate', update);
      editor.off('transaction', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [editor, scheduleUpdate, update]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    update();
    const item = items.current[activeIndex];
    item?.focus({ preventScroll: true });
    // Into view inside a menu held short enough to scroll, and never by scrolling the page.
    const list = menu.current;
    if (item && list) {
      list.scrollTop = Math.min(item.offsetTop, Math.max(list.scrollTop, item.offsetTop + item.offsetHeight - list.clientHeight));
    }
  }, [activeIndex, menuOpen, update]);

  if (!editor) return null;

  const closeMenu = () => {
    setMenuOpen(false);
    editor.commands.focus();
  };

  const blockActions = [
    { icon: 'text', label: copy.blocks.text, run: () => editor.chain().focus().setParagraph().run() },
    { icon: 'heading1', label: copy.blocks.heading1, run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { icon: 'heading2', label: copy.blocks.heading2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { icon: 'heading3', label: copy.blocks.heading3, run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { icon: 'list', label: copy.blocks.bulletList, run: () => editor.chain().focus().toggleBulletList().run() },
    { icon: 'quote', label: copy.blocks.quote, run: () => editor.chain().focus().toggleBlockquote().run() },
    { icon: 'code', label: copy.blocks.codeBlock, run: () => editor.chain().focus().toggleCodeBlock().run() },
    // Not inside a table: a table in a cell is one nobody meant to make.
    ...(editor.isActive('table') ? [] : [
      { icon: 'table', label: copy.blocks.table, run: () => editor.chain().focus().insertTable(NEW_TABLE).run() },
    ] as const),
  ] as const;

  const openPicker = () => {
    savedPosition.current = editor.state.selection.from;
    setMenuOpen(false);
    setPickerOpen(true);
  };

  const actions = [...blockActions, { icon: 'media', label: copy.blocks.image, run: openPicker }] as const;

  const runAction = (index: number) => {
    actions[index]?.run();
    if (index < blockActions.length) setMenuOpen(false);
  };

  const handleMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!menuOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      runAction(activeIndex);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    setActiveIndex((activeIndex + direction + actions.length) % actions.length);
  };

  const selectAsset = (asset: MediaAsset) => {
    setPickerOpen(false);
    const position = Math.min(savedPosition.current, editor.state.doc.content.size);
    editor
      .chain()
      .focus()
      .setTextSelection(position)
      .insertContent({
        type: 'image',
        attrs: { alt: asset.alt_text || asset.original_name, mediaId: asset.id, src: asset.publicUrl, title: asset.original_name },
      })
      .run();
  };

  return (
    <>
      {visible && (
        <div
          className="block-insert"
          onKeyDown={handleMenuKey}
          ref={root}
          style={{ left: position.left, top: position.top }}
        >
          <button
            aria-controls={MENU_ID}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={copy.blocks.addBlock}
            className="block-insert-trigger"
            onClick={() => {
              setActiveIndex(0);
              setMenuOpen((open) => !open);
            }}
            onMouseDown={(event) => event.preventDefault()}
            type="button"
          >
            <span aria-hidden="true">+</span>
          </button>
          {menuOpen && (
            <div
              aria-label={copy.blocks.insertBlock}
              className="block-insert-menu"
              id={MENU_ID}
              ref={menu}
              role="menu"
              style={{ left: position.menuLeft, maxHeight: position.menuMaxHeight, top: position.menuTop }}
            >
              {actions.map((action, index) => (
                <button
                  className="block-insert-item"
                  key={action.label}
                  onClick={() => runAction(index)}
                  ref={(element) => { items.current[index] = element; }}
                  role="menuitem"
                  tabIndex={index === activeIndex ? 0 : -1}
                  type="button"
                >
                  <Icon name={action.icon} />
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {pickerOpen && (
        <MediaPicker
          kind="image"
          onCancel={() => {
            setPickerOpen(false);
            editor.commands.focus();
          }}
          onSelect={selectAsset}
          returnFocus={editor.view.dom}
        />
      )}
    </>
  );
}
