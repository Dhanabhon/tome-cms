import type { Editor, Range } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';

import type { AdminCopy } from '../../../lib/admin-i18n';
import type { VideoAttrs } from '../../../lib/editor-video';
import { alertUi, promptUi } from '../../../lib/ui-dialog';
import { parseVideoLink, type VideoLink } from '../../../lib/video-link';

type Reason = 'unavailable' | 'unreachable' | null;

/** Asks the server for the clip's title and poster. A failure leaves the clip as it is, with a reason. */
async function resolve(clip: VideoLink, link: string): Promise<{ attrs: VideoAttrs; reason: Reason }> {
  const bare = { attrs: { ...clip, mediaId: null, title: '' }, reason: 'unreachable' as const };
  try {
    const response = await fetch('/api/admin/videos', {
      body: JSON.stringify({ link }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) return bare;
    const found = await response.json() as VideoAttrs & { reason: Reason };
    return {
      attrs: { mediaId: found.mediaId, provider: found.provider, start: found.start, title: found.title, videoId: found.videoId },
      reason: found.reason,
    };
  } catch {
    return bare;
  }
}

/**
 * Puts a clip in at once, then fills in its title and poster when the server answers.
 *
 * ponytail: the clip is found again by provider and id, with no title and no poster yet, so two of
 * the same clip added within one lookup fill the first. Mapping the position through each
 * transaction would tell them apart.
 */
export async function insertVideo(editor: Editor, at: number | Range, link: string, copy: AdminCopy): Promise<void> {
  const clip = parseVideoLink(link);
  if (!clip) return;
  const node = { type: 'video', attrs: { ...clip, mediaId: null, title: '' } };
  const chain = editor.chain().focus();
  (typeof at === 'number' ? chain.setTextSelection(at).insertContent(node) : chain.insertContentAt(at, node)).run();

  const { attrs, reason } = await resolve(clip, link);
  if (editor.isDestroyed) return;
  editor.commands.command(({ tr }) => {
    let filled = false;
    tr.doc.descendants((current, position) => {
      if (filled) return false;
      if (current.type.name !== 'video' || current.attrs.provider !== clip.provider || current.attrs.videoId !== clip.videoId
        || current.attrs.title || current.attrs.mediaId) return true;
      tr.setNodeMarkup(position, undefined, attrs);
      filled = true;
      return false;
    });
    return filled;
  });
  if (reason) {
    void alertUi({
      message: reason === 'unavailable' ? copy.blocks.videoUnavailable : copy.blocks.videoUnreachable,
      title: copy.blocks.videoLookupFailed,
    });
  }
}

/** The + and / menus: ask for a link, then put the clip where the menu was opened. */
export async function askForVideo(editor: Editor, position: number, copy: AdminCopy): Promise<void> {
  const link = await promptUi({
    label: copy.blocks.videoLink,
    message: copy.blocks.videoHint,
    title: copy.blocks.videoTitle,
    validate: (value) => (parseVideoLink(value) ? null : copy.blocks.videoInvalid),
  });
  if (link) await insertVideo(editor, position, link, copy);
}

/** A YouTube or Vimeo link pasted alone on an empty line becomes a video; anywhere else it stays a link. */
export function handleVideoPaste(view: EditorView, event: ClipboardEvent, editor: Editor | null, copy: AdminCopy): boolean {
  const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
  if (!editor || !parseVideoLink(text)) return false;
  const { $from, empty } = view.state.selection;
  if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.content.size !== 0) return false;
  event.preventDefault();
  void insertVideo(editor, { from: $from.before(), to: $from.after() }, text, copy);
  return true;
}
