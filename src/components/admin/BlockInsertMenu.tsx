import { useEditor } from 'novel';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

import type { AdminCopy } from '../../lib/admin-i18n';
import { PICK_FILE_EVENT } from '../../lib/editor-attachment';
import { NEW_TABLE } from '../../lib/editor-table';
import { isImageAsset, type MediaKind } from '../../lib/media';
import type { MediaAsset, PostLocale } from '../../types/cms';
import Icon from '../Icon';
import MediaPicker from './MediaPicker';

const MENU_ID = 'block-insert-menu';
/** Between the menu and the + button, on whichever side of it the menu opens. */
const GAP = 6;
/** Kept between the menu and whatever would cover or cut it. */
const MARGIN = 8;
/** Held any shorter than this, a menu is a slot to scroll a list through. */
const LEAST_ROOM = 128;

export default function BlockInsertMenu({ copy, ownerLocale }: { copy: AdminCopy; ownerLocale?: PostLocale | null }) {
  const { editor } = useEditor();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const frame = useRef<number | null>(null);
  const savedPosition = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [picker, setPicker] = useState<MediaKind | null>(null);
  const [position, setPosition] = useState<{ left: number; menuLeft: number; menuMaxHeight?: number; menuTop: number; top: number }>(
    { left: 0, menuLeft: 0, menuTop: 0, top: 0 },
  );
  const [visible, setVisible] = useState(false);

  const update = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    const ownsFocus = editor.isFocused || Boolean(root.current?.contains(document.activeElement));
    const shouldShow = editor.isEditable && editor.state.selection.empty && ownsFocus;
    setVisible(shouldShow);
    if (!shouldShow && picker === null) setMenuOpen(false);
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
    // Under the button as it is drawn. Its height is the stylesheet's to decide: a number kept
    // here once stayed at 36px when the button grew to 44, and the menu opened across it.
    const underButton = cursor.top + (trigger.current?.offsetHeight ?? 0) + GAP;
    const below = window.innerHeight - MARGIN - underButton;
    const above = cursor.top - GAP - ceiling;
    // Below the line when it fits there, else on the side with more room -- held to that room,
    // and scrolled within when even that is short.
    const opensAbove = menuHeight > below && above > below;
    const room = Math.max(LEAST_ROOM, opensAbove ? above : below);
    const menuViewportTop = opensAbove ? cursor.top - GAP - Math.min(menuHeight, room) : underButton;
    setPosition({
      left,
      menuLeft,
      menuMaxHeight: room,
      menuTop: menuViewportTop - cursor.top,
      top: cursor.top - canvasRect.top,
    });
  }, [editor, menuOpen, picker]);

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

  // '/' has no picker of its own. It asks for this one, at the cursor it leaves behind.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const pickFile = () => {
      savedPosition.current = editor.state.selection.from;
      setMenuOpen(false);
      setPicker('document');
    };
    dom.addEventListener(PICK_FILE_EVENT, pickFile);
    return () => dom.removeEventListener(PICK_FILE_EVENT, pickFile);
  }, [editor]);

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

  const openPicker = (kind: MediaKind) => {
    savedPosition.current = editor.state.selection.from;
    setMenuOpen(false);
    setPicker(kind);
  };

  const actions = [
    ...blockActions,
    { icon: 'media', label: copy.blocks.image, run: () => openPicker('image') },
    { icon: 'file', label: copy.blocks.file, run: () => openPicker('document') },
  ] as const;

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
    const kind = picker;
    setPicker(null);
    const position = Math.min(savedPosition.current, editor.state.doc.content.size);
    const chain = editor.chain().focus().setTextSelection(position);
    if (kind === 'image' && isImageAsset(asset)) {
      chain.insertContent({
        type: 'image',
        attrs: { alt: asset.alt_text || asset.original_name, mediaId: asset.id, src: asset.publicUrl, title: asset.original_name },
      }).run();
    } else if (kind === 'document') {
      // These draw the card until it is saved; then the server fills it from the library.
      chain.insertContent({
        type: 'attachment',
        attrs: { href: asset.publicUrl, mediaId: asset.id, mimeType: asset.mime_type, name: asset.original_name, size: asset.size_bytes },
      }).run();
    }
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
            ref={trigger}
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
      {picker && (
        <MediaPicker
          kind={picker}
          onCancel={() => {
            setPicker(null);
            editor.commands.focus();
          }}
          onSelect={selectAsset}
          ownerLocale={ownerLocale}
          returnFocus={editor.view.dom}
        />
      )}
    </>
  );
}
