import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ChordProPdfPayload } from './chordproPdfPayload';
import { normalizeChordProPdfPayload } from './chordproPdfPayload';

const STORE_DIR = path.join(os.tmpdir(), 'alabanza-chordpro-pdf');
const TOKEN_RE = /^[a-f0-9-]{36}$/i;
const MAX_FILE_AGE_MS = 1000 * 60 * 20;

const getPayloadPath = (token: string) => path.join(STORE_DIR, `${token}.json`);

const ensureStoreDir = async () => {
  await mkdir(STORE_DIR, { recursive: true });
};

const cleanupStalePayloads = async () => {
  try {
    await ensureStoreDir();
    const fileNames = await readdir(STORE_DIR);
    const now = Date.now();

    await Promise.all(
      fileNames.map(async (fileName) => {
        const filePath = path.join(STORE_DIR, fileName);

        try {
          const fileStats = await stat(filePath);
          if (now - fileStats.mtimeMs > MAX_FILE_AGE_MS) {
            await rm(filePath, { force: true });
          }
        } catch {
          // no-op
        }
      })
    );
  } catch {
    // no-op
  }
};

export const createChordProPdfPayloadToken = async (payload: ChordProPdfPayload) => {
  await ensureStoreDir();
  void cleanupStalePayloads();

  const token = crypto.randomUUID();
  await writeFile(getPayloadPath(token), JSON.stringify(payload), 'utf8');
  return token;
};

export const readChordProPdfPayloadToken = async (token: string) => {
  if (!TOKEN_RE.test(token)) return null;

  try {
    const rawJson = await readFile(getPayloadPath(token), 'utf8');
    return normalizeChordProPdfPayload(JSON.parse(rawJson));
  } catch {
    return null;
  }
};

export const deleteChordProPdfPayloadToken = async (token: string) => {
  if (!TOKEN_RE.test(token)) return;

  try {
    await rm(getPayloadPath(token), { force: true });
  } catch {
    // no-op
  }
};
