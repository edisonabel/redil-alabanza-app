const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

export const encodeCustomSetlistPlaylistId = (playlistId: unknown): string | null => {
  const uuid = String(playlistId || '').trim().toLowerCase();
  if (!UUID_RE.test(uuid)) return null;

  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};

export const decodeCustomSetlistPlaylistId = (token: unknown): string | null => {
  const safeToken = String(token || '').trim();
  if (!TOKEN_RE.test(safeToken)) return null;

  try {
    const base64 = safeToken.replace(/-/g, '+').replace(/_/g, '/') + '==';
    const bytes = base64ToBytes(base64);
    if (bytes.length !== 16) return null;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const uuid = [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-');

    return UUID_RE.test(uuid) ? uuid : null;
  } catch {
    return null;
  }
};

export const buildCustomSetlistPath = (playlistId: unknown): string | null => {
  const token = encodeCustomSetlistPlaylistId(playlistId);
  return token ? `/ensayo/p-${token}` : null;
};

export const parseCustomSetlistRouteId = (routeId: unknown): string | null => {
  const value = String(routeId || '').trim();
  if (!value.startsWith('p-')) return null;
  return decodeCustomSetlistPlaylistId(value.slice(2));
};
