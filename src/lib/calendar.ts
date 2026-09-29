/**
 * Calendar dates for the admin's date-time picker, as the strings a datetime-local held
 * (YYYY-MM-DD and YYYY-MM-DDTHH:mm). Arithmetic runs in UTC on the date alone, so no timezone or
 * daylight-saving change can move a day; turning the wall clock into an instant stays with
 * toLocalInput/fromLocalInput in local-datetime.ts.
 */
export type LocalParts = { date: string; hour: number; minute: number };

const pad = (value: number) => String(value).padStart(2, '0');
const toDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};
const fromDate = (when: Date) => `${when.getUTCFullYear()}-${pad(when.getUTCMonth() + 1)}-${pad(when.getUTCDate())}`;

export function parseLocal(value: string): LocalParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d, hh, mm] = match.map(Number);
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (m < 1 || m > 12 || hh > 23 || mm > 59 || fromDate(toDate(date)) !== date || d < 1 || y < 1) return null;
  return { date, hour: hh, minute: mm };
}

export function formatLocal({ date, hour, minute }: LocalParts): string {
  return `${date}T${pad(hour)}:${pad(minute)}`;
}

export function addDays(date: string, days: number): string {
  const when = toDate(date);
  when.setUTCDate(when.getUTCDate() + days);
  return fromDate(when);
}

export function addMonths(date: string, months: number): string {
  const when = toDate(date);
  const day = when.getUTCDate();
  when.setUTCDate(1);
  when.setUTCMonth(when.getUTCMonth() + months);
  const last = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth() + 1, 0)).getUTCDate();
  when.setUTCDate(Math.min(day, last));
  return fromDate(when);
}

export function startOfWeek(date: string): string {
  return addDays(date, -toDate(date).getUTCDay());
}

export function endOfWeek(date: string): string {
  return addDays(startOfWeek(date), 6);
}

export function monthGrid(date: string): { date: string; inMonth: boolean }[] {
  const first = `${date.slice(0, 7)}-01`;
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => {
    const cell = addDays(start, index);
    return { date: cell, inMonth: cell.slice(0, 7) === date.slice(0, 7) };
  });
}

export function isBefore(date: string, other: string): boolean {
  return date < other;
}

export function todayLocal(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
