import { useEditor } from 'novel';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

import type { MediaAsset } from '../../types/cms';
import MediaPicker from './MediaPicker';

const MENU_ID = 'block-insert-menu';

export default function BlockInsertMenu() {
  const { editor } = useEditor();
  const root = useRef<HTMLDivElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const savedPosition = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [visible, setVisible] = useState(false);

  const update = useCallback(() => {
    if (!editor) return;
    const ownsFocus = editor.isFocused || Boolean(root.current?.contains(document.activeElement));
    const shouldShow = editor.isEditable && editor.state.selection.empty && ownsFocus;
    setVisible(shouldShow);
    if (!shouldShow && !pickerOpen) setMenuOpen(false);
    if (!shouldShow) return;

    const canvas = editor.view.dom.closest<HTMLElement>('.editor-canvas');
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const cursor = editor.view.coordsAtPos(editor.state.selection.from);
    setPosition({
      left: Math.max(0, Math.min(cursor.left - canvasRect.left - 44, canvasRect.width - 36)),
      top: cursor.top - canvasRect.top,
    });
  }, [editor, pickerOpen]);

  useEffect(() => {
    if (!editor) return;
    const afterBlur = () => requestAnimationFrame(update);
    editor.on('focus', update);
    editor.on('blur', afterBlur);
    editor.on('selectionUpdate', update);
    editor.on('transaction', afterBlur);
    window.addEventListener('resize', update);
    update();
    return () => {
      editor.off('focus', update);
      editor.off('blur', afterBlur);
      editor.off('selectionUpdate', update);
      editor.off('transaction', afterBlur);
      window.removeEventListener('resize', update);
    };
  }, [editor, update]);

  useEffect(() => {
    if (menuOpen) items.current[activeIndex]?.focus();
  }, [activeIndex, menuOpen]);

  if (!editor) return null;

  const closeMenu = () => {
    setMenuOpen(false);
    editor.commands.focus();
  };

  const blockActions = [
    { label: 'Text', run: () => editor.chain().focus().setParagraph().run() },
    { label: 'Heading 1', run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: 'Heading 2', run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'Heading 3', run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: 'Bullet list', run: () => editor.chain().focus().toggleBulletList().run() },
    { label: 'Quote', run: () => editor.chain().focus().toggleBlockquote().run() },
    { label: 'Code block', run: () => editor.chain().focus().toggleCodeBlock().run() },
  ] as const;

  const openPicker = () => {
    savedPosition.current = editor.state.selection.from;
    setMenuOpen(false);
    setPickerOpen(true);
  };

  const actions = [...blockActions, { label: 'Image', run: openPicker }];

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
      .setImage({ alt: asset.alt_text || asset.original_name, src: asset.publicUrl })
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
            aria-label="Add block"
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
            <div aria-label="Insert block" className="block-insert-menu" id={MENU_ID} role="menu">
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
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {pickerOpen && (
        <MediaPicker
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
