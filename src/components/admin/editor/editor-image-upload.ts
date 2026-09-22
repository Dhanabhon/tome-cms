import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

export type UploadFn = (file: File, view: EditorView, pos: number) => void;

interface PlaceholderMeta {
  add?: { id: object; pos: number; src: string };
  remove?: { id: object };
}

export const imageUploadKey = new PluginKey<DecorationSet>('imageUpload');

/**
 * The picture stands where it will land, at half opacity, until the upload answers. The element
 * is built when it is drawn rather than when it is added, so the plugin's own state can be read
 * without a document, which is how it is tested.
 */
export const imageUploadPlugin = (): Plugin<DecorationSet> => new Plugin<DecorationSet>({
  key: imageUploadKey,
  props: { decorations: (state) => imageUploadKey.getState(state) },
  state: {
    init: () => DecorationSet.empty,
    apply(tr, set) {
      const moved = set.map(tr.mapping, tr.doc);
      const meta = tr.getMeta(imageUploadKey) as PlaceholderMeta | undefined;
      if (meta?.add) {
        const { id, pos, src } = meta.add;
        return moved.add(tr.doc, [Decoration.widget(pos + 1, () => placeholder(src), { id })]);
      }
      if (meta?.remove) {
        const { id } = meta.remove;
        return moved.remove(moved.find(undefined, undefined, (spec) => spec.id === id));
      }
      return moved;
    },
  },
});

function placeholder(src: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'img-placeholder';
  const image = document.createElement('img');
  image.className = 'rounded-lg opacity-50';
  image.src = src;
  box.append(image);
  return box;
}

function placeholderAt(view: EditorView, id: object): number | null {
  const found = imageUploadKey.getState(view.state)?.find(undefined, undefined, (spec) => spec.id === id) ?? [];
  return found.length ? found[0]!.from : null;
}

export function createImageUpload({ onUpload, validate }: {
  onUpload: (file: File) => Promise<string>;
  validate: (file: File) => boolean;
}): UploadFn {
  return (file, view, pos) => {
    if (!validate(file)) return;
    const id = {};
    const reader = new FileReader();
    reader.onload = () => {
      const tr = view.state.tr;
      if (!tr.selection.empty) tr.deleteSelection();
      view.dispatch(tr.setMeta(imageUploadKey, { add: { id, pos, src: String(reader.result) } }));
    };
    reader.readAsDataURL(file);

    onUpload(file).then((src) => {
      const at = placeholderAt(view, id);
      // Gone from the document while it uploaded: there is nothing to put the picture in.
      if (at === null) return;
      const image = view.state.schema.nodes.image?.create({ src });
      if (!image) return;
      view.dispatch(view.state.tr.replaceWith(at, at, image).setMeta(imageUploadKey, { remove: { id } }));
    }, () => {
      // The alert is the uploader's; here the placeholder just leaves.
      view.dispatch(view.state.tr.setMeta(imageUploadKey, { remove: { id } }));
    });
  };
}

/** A file dropped onto the page, unless the editor is moving something of its own. */
export function handleImageDrop(view: EditorView, event: DragEvent, moved: boolean, upload: UploadFn): boolean {
  // Any file, not only an image: the uploader is what refuses one, and it says why.
  const file = moved ? undefined : event.dataTransfer?.files[0];
  if (!file) return false;
  event.preventDefault();
  upload(file, view, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? -1);
  return true;
}

/** A file pasted into the page, which lands where the cursor is. */
export function handleImagePaste(view: EditorView, event: ClipboardEvent, upload: UploadFn): boolean {
  const file = event.clipboardData?.files[0];
  if (!file) return false;
  event.preventDefault();
  upload(file, view, view.state.selection.from);
  return true;
}
