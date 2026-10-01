import type { BrandName } from '../../lib/brand-marks';

export type ItemKey = `${'post' | 'page'}:${string}`;
export interface Touch { connectionId: string; clientName: string; brand: BrandName | null; action: 'read' | 'write'; at: number }

/** How long an AI's touch is shown, and how long the owner's last heartbeat holds a draft. */
const TOUCH_MS = 180_000;
const OWNER_MS = 45_000;
const MAX_ITEMS = 500;

// ponytail: both stores live in this process's memory, so a restart forgets them (at most 45 s of
// owner hold and 3 min of AI touch), and one app process serves a site. A table is the upgrade path.
const touches = new Map<ItemKey, Touch>();
const beats = new Map<ItemKey, number>();

/** A uuid is the same row in any case, so the key is lowercase: the editor's beat and an AI's id must agree. */
export const itemKey = (kind: 'post' | 'page', id: string): ItemKey => `${kind}:${id.toLowerCase()}`;

/** Sets a key as the newest entry: re-inserting moves it last, so the first key is always the oldest. */
function remember<T>(store: Map<ItemKey, T>, key: ItemKey, value: T): void {
  store.delete(key);
  store.set(key, value);
  while (store.size > MAX_ITEMS) store.delete(store.keys().next().value as ItemKey);
}

export function recordTouch(key: ItemKey, touch: Omit<Touch, 'at'>, now = Date.now()): void {
  remember(touches, key, { ...touch, at: now });
}

export function lastTouch(key: ItemKey, now = Date.now()): Touch | null {
  const found = touches.get(key);
  return found && now - found.at <= TOUCH_MS ? found : null;
}

/** The owner's editor says the draft is open; any tab will do. */
export function beat(key: ItemKey, now = Date.now()): void {
  remember(beats, key, now);
}

export function ownerIsEditing(key: ItemKey, now = Date.now()): boolean {
  const at = beats.get(key);
  return at !== undefined && now - at < OWNER_MS;
}

export function resetPresenceForTest(): void {
  touches.clear();
  beats.clear();
}
