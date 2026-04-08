import type { LiveDirectorPersistedSession } from './liveDirectorSongSession';

type LiveDirectorUploadTarget = {
  presignedUrl: string;
  publicUrl: string;
  objectKey: string;
  folder: string;
};

const readJsonResponse = async (response: Response) => {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(String(payload?.error || 'The request failed.'));
  }

  return payload;
};

export async function requestLiveDirectorUploadTarget(params: {
  songId: string;
  fileName: string;
  fileType?: string;
  kind: 'playback' | 'stems';
}): Promise<LiveDirectorUploadTarget> {
  const response = await fetch('/api/live-director-upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  return readJsonResponse(response);
}

export async function uploadFileToLiveDirectorTarget(
  file: File,
  target: LiveDirectorUploadTarget,
): Promise<void> {
  const response = await fetch(target.presignedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error(`No se pudo subir "${file.name}" a R2.`);
  }
}

export async function saveLiveDirectorSongSession(params: {
  songId: string;
  session: Omit<LiveDirectorPersistedSession, 'folder' | 'manifestUrl' | 'updatedAt' | 'songId' | 'songTitle' | 'version'>;
}): Promise<LiveDirectorPersistedSession> {
  const response = await fetch('/api/live-director-song-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  return readJsonResponse(response);
}

export async function deleteLiveDirectorSongSession(songId: string): Promise<void> {
  const response = await fetch('/api/live-director-song-session', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId }),
  });

  await readJsonResponse(response);
}
