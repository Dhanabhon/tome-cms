import type { AdminCopy } from './admin-i18n';

export interface DeviceHints {
  userAgent: string;
  maxTouchPoints?: number;
}

/**
 * A starting name for the device being added, so the owner can tell it apart later.
 * iPhone's user agent also says "Mac OS X", so it is checked first; iPadOS says Macintosh,
 * and only its touch screen gives it away.
 * ponytail: user-agent sniffing, so an unusual browser gets "New device" -- the owner can rename it.
 */
export function guessDeviceName(hints: DeviceHints, names: AdminCopy['addDevice']['deviceNames']): string {
  const agent = hints.userAgent;
  if (/iPhone/i.test(agent)) return names.iphone;
  if (/iPad/i.test(agent)) return names.ipad;
  if (/Android/i.test(agent)) return names.android;
  if (/Windows/i.test(agent)) return names.windows;
  if (/Macintosh|Mac OS X/i.test(agent)) return (hints.maxTouchPoints ?? 0) > 1 ? names.ipad : names.mac;
  return names.other;
}
