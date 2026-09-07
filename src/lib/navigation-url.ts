export function normalizeNavigationUrl(value: string): string | null {
  const candidate = value.trim();
  if (!candidate || /[\s\\\u0000-\u001f\u007f]/.test(candidate)) return null;
  if (candidate.startsWith('/')) return candidate.startsWith('//') ? null : candidate;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
