import type { ChordProPdfPayload } from './chordproPdfPayload';
import { normalizeChordProPdfPayload } from './chordproPdfPayload';

const STORAGE_PREFIX = 'alabanza:chordpro-pdf:';
const MAX_ITEM_AGE_MS = 1000 * 60 * 20;

const getStorageKey = (token: string) => `${STORAGE_PREFIX}${token}`;

const getStorage = () => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const cleanupStaleItems = (storage: Storage) => {
  const now = Date.now();

  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;

    try {
      const rawValue = storage.getItem(key);
      if (!rawValue) {
        storage.removeItem(key);
        continue;
      }

      const parsed = JSON.parse(rawValue) as { createdAt?: number };
      const createdAt = Number(parsed?.createdAt) || 0;
      if (!createdAt || now - createdAt > MAX_ITEM_AGE_MS) {
        storage.removeItem(key);
      }
    } catch {
      storage.removeItem(key);
    }
  }
};

export const createChordProPdfBrowserToken = (payload: ChordProPdfPayload) => {
  const storage = getStorage();
  if (!storage) {
    throw new Error('Este navegador no permite guardar el documento temporalmente.');
  }

  cleanupStaleItems(storage);

  const token =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  storage.setItem(
    getStorageKey(token),
    JSON.stringify({
      createdAt: Date.now(),
      payload,
    })
  );

  return token;
};

export const readChordProPdfBrowserToken = (token: string) => {
  const storage = getStorage();
  if (!storage || !token.trim()) return null;

  cleanupStaleItems(storage);

  try {
    const rawValue = storage.getItem(getStorageKey(token));
    if (!rawValue) return null;

    const parsed = JSON.parse(rawValue) as { payload?: unknown };
    return normalizeChordProPdfPayload(parsed?.payload);
  } catch {
    return null;
  }
};

export const deleteChordProPdfBrowserToken = (token: string) => {
  const storage = getStorage();
  if (!storage || !token.trim()) return;

  try {
    storage.removeItem(getStorageKey(token));
  } catch {
    // no-op
  }
};
