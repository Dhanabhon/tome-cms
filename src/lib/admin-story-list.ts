import { apiErrorMessage } from './admin';

/**
 * Shared behaviour for the Posts and Pages lists.
 *
 * Both lists used to answer every publish, unpublish and delete with a full
 * `location.reload()`, which threw away the writer's scroll position and the
 * open state of the row menu. The API already returns the updated record, so
 * the row can be reconciled in place instead; only a delete that empties the
 * list still reloads, because the server renders the empty state.
 */

export interface StoryRecord {
  published_at: string | null;
  status: string;
  updated_at: string;
}

interface StoryListOptions {
  /** Returns false to abort — each list owns its own confirmation copy. */
  confirm: (action: string, row: DOMStringMap) => Promise<boolean>;
  endpoint: string;
  entity: 'page' | 'post';
}

/**
 * Narrows an API body to the record the row needs.
 *
 * Returning null is the safe answer — the caller falls back to a full reload.
 * Returning a half-formed record would leave the row showing a stale status.
 */
export function readRecord(payload: unknown, entity: string): StoryRecord | null {
  if (typeof payload !== 'object' || payload === null || !(entity in payload)) return null;
  const record = (payload as Record<string, unknown>)[entity];
  if (typeof record !== 'object' || record === null) return null;
  return 'updated_at' in record && 'status' in record ? (record as unknown as StoryRecord) : null;
}

/** The copy's own id, so the writer lands in the copy rather than back on the list. */
export function readRecordId(payload: unknown, entity: string): string | null {
  if (typeof payload !== 'object' || payload === null || !(entity in payload)) return null;
  const record = (payload as Record<string, unknown>)[entity];
  if (typeof record !== 'object' || record === null) return null;
  const id = (record as Record<string, unknown>).id;
  return typeof id === 'string' ? id : null;
}

interface StoryCopy {
  actionFailed: string;
  contentRequired: string;
  draft: string;
  published: string;
  publishedAt: string;
  publish: string;
  unpublish: string;
  updatedAt: string;
}

function reconcile(row: HTMLElement, record: StoryRecord, entity: string, format: Intl.DateTimeFormat, copy: StoryCopy) {
  const published = record.status === 'published';

  const badge = row.querySelector<HTMLElement>('.admin-status');
  if (badge) {
    badge.dataset.status = record.status;
    badge.textContent = published ? copy.published : copy.draft;
  }

  // The status belongs to the edition; the date belongs to the story, and sits in the
  // card's footer above every edition of it. Writing one is how the other becomes
  // newest, so the edition that was just changed is the one the footer should name.
  const card = row.closest<HTMLElement>('.admin-story-row') ?? row;
  const verb = card.querySelector<HTMLElement>('[data-story-verb]');
  const stamp = card.querySelector<HTMLTimeElement>('[data-story-when] time');
  if (verb) verb.textContent = published ? copy.publishedAt : copy.updatedAt;
  if (stamp) {
    const moment = published ? record.published_at ?? record.updated_at : record.updated_at;
    stamp.dateTime = moment;
    stamp.textContent = format.format(new Date(moment));
  }

  // Every button in the row carries the concurrency token; a stale one breaks the next action.
  row.querySelectorAll<HTMLElement>(`[data-${entity}-updated-at]`).forEach((element) => {
    element.dataset[`${entity}UpdatedAt`] = record.updated_at;
  });

  const toggle = row.querySelector<HTMLButtonElement>(`button[data-${entity}-action]:not([data-${entity}-action="delete"])`);
  if (toggle) {
    toggle.dataset[`${entity}Action`] = published ? 'draft' : 'published';
    toggle.textContent = published ? copy.unpublish : copy.publish;
  }
}

export default function wireStoryList({ confirm, endpoint, entity }: StoryListOptions) {
  const container = document.querySelector<HTMLElement>(`[data-admin-${entity}s]`);
  if (!container) return;

  const message = container.querySelector<HTMLElement>(`[data-${entity}-error]`);
  const data = container.dataset;
  const format = new Intl.DateTimeFormat(data.locale === 'th' ? 'th-TH' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.timezone || 'UTC',
  });
  const copy: StoryCopy = {
    actionFailed: data.copyActionFailed ?? 'The action could not be completed. Please try again.',
    contentRequired: data.copyContentRequired ?? 'Add content before publishing.',
    draft: data.copyDraft ?? 'draft',
    published: data.copyPublished ?? 'published',
    publishedAt: data.copyPublishedAt ?? 'Published',
    publish: data.copyPublish ?? 'Publish',
    unpublish: data.copyUnpublish ?? 'Unpublish',
    updatedAt: data.copyUpdatedAt ?? 'Updated',
  };

  container.addEventListener('click', async (event) => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>(`button[data-${entity}-action]`)
      : null;
    if (!button || button.disabled) return;

    const action = button.dataset[`${entity}Action`];
    const id = button.dataset[`${entity}Id`];
    const updatedAt = button.dataset[`${entity}UpdatedAt`];
    if (!action || !id || !updatedAt) return;
    if (!(await confirm(action, button.dataset))) return;

    // A card holds every language edition of one story, so an action belongs to the
    // edition it was pressed in, never to the card. Lists that are not grouped have no
    // edition element and fall back to the row, which is the same thing there.
    const row = button.closest<HTMLElement>('.admin-story-edition') ?? button.closest<HTMLElement>('.admin-story-row');
    const card = button.closest<HTMLElement>('.admin-story-row');
    button.disabled = true;
    // The menu closes as it is clicked, so a disabled item inside it is not visible for
    // long. The card says it instead, the way the public feed marks a filter change.
    card?.setAttribute('aria-busy', 'true');
    if (message) message.hidden = true;

    const failure = async (response: Response) =>
      new Error(apiErrorMessage(await response.json().catch(() => null), { contentRequired: copy.contentRequired, failed: copy.actionFailed }));

    try {
      if (action === 'duplicate') {
        // A copy is a new row the list has never rendered, so there is nothing here
        // to reconcile. Send the writer to the copy: duplicating is how you start
        // from something, and the next thing they want is the editor.
        const response = await fetch(`${endpoint}/duplicate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        if (!response.ok) throw await failure(response);
        const copyId = readRecordId(await response.json().catch(() => null), entity);
        if (copyId && data.editBase) window.location.assign(`${data.editBase}/${copyId}`);
        else window.location.reload();
        return;
      }

      const response = await fetch(endpoint, {
        method: action === 'delete' ? 'DELETE' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'delete' ? { id, updatedAt } : { id, status: action, updatedAt }),
      });
      if (!response.ok) throw await failure(response);

      if (action === 'delete') {
        row?.remove();
        // Deleting the last edition deletes the story, and the card has nothing left to
        // be about -- its cover and categories belonged to the group, not to a language.
        if (card && card !== row && !card.querySelector('.admin-story-edition')) card.remove();
        // The empty state is server-rendered, so hand the last removal back to the server.
        if (!container.querySelector('.admin-story-edition, .admin-story-row')) window.location.reload();
        return;
      }

      const record = readRecord(await response.json().catch(() => null), entity);
      // A response we cannot read must not leave the row showing a stale status.
      if (!record || !row) window.location.reload();
      else {
        reconcile(row, record, entity, format, copy);
        row.querySelector<HTMLDetailsElement>('.admin-story-menu')?.removeAttribute('open');
        button.disabled = false;
        card?.removeAttribute('aria-busy');
      }
    } catch (error) {
      if (message) {
        message.textContent = error instanceof Error ? error.message : copy.actionFailed;
        message.hidden = false;
      }
      button.disabled = false;
      card?.removeAttribute('aria-busy');
    }
  });
}
