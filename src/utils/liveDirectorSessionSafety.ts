const STEM_HOST = 'stems.alabanzaredilestadio.com';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const OWNER = new RegExp(`^secuencias/(${UUID})-`, 'i');
export const getStemObjectOwner = (key: string) => OWNER.exec(key)?.[1]?.toLowerCase() || null;
export const isSongOwnedStemKey = (key: string, songId: string) => getStemObjectOwner(key) === songId.toLowerCase();

export function assertSongOwnsStemUrls(songId: string, tracks: Array<Record<string, unknown>>) {
  for (const track of tracks) {
    for (const field of ['url', 'iosUrl', 'nativeUrl', 'optimizedUrl', 'cafUrl', 'pcmUrl']) {
      const value = track[field];
      if (typeof value !== 'string' || !value) continue;
      let url: URL;
      try { url = new URL(value); } catch { continue; }
      if (url.hostname !== STEM_HOST && !url.hostname.endsWith('.r2.dev')) continue;
      const owner = getStemObjectOwner(decodeURIComponent(url.pathname.replace(/^\/+/, '')));
      if (owner && owner !== songId.toLowerCase()) {
        throw Object.assign(new Error('Estos stems pertenecen a otra canción. Recarga la canción antes de guardar o sube sus propios archivos.'), { status: 409 });
      }
    }
  }
}

export function isMissingStemError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    const item = current as { message?: unknown; cause?: unknown; status?: unknown };
    if (item.status === 404 || item.status === 410 || /\b(?:404|410)\b/.test(String(item.message || current))) return true;
    current = item.cause;
  }
  return false;
}
