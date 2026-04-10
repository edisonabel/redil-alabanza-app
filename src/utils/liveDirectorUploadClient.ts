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

export type UploadProgressEvent = {
  loaded: number;
  total: number;
  percent: number;
};

export type UploadFileOptions = {
  onProgress?: (event: UploadProgressEvent) => void;
  signal?: AbortSignal;
};

export async function uploadFileToLiveDirectorTarget(
  file: File,
  target: LiveDirectorUploadTarget,
  options?: UploadFileOptions,
): Promise<void> {
  const onProgress = options?.onProgress;
  const signal = options?.signal;

  // Camino moderno (sin progreso): mantener fetch para máxima compatibilidad.
  if (!onProgress) {
    const response = await fetch(target.presignedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
      signal,
    });

    if (!response.ok) {
      throw new Error(`No se pudo subir "${file.name}" a R2.`);
    }
    return;
  }

  // Camino con progreso: XHR es la única forma de obtener upload progress en navegador.
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', target.presignedUrl, true);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    let aborted = false;
    const onAbort = () => {
      aborted = true;
      try {
        xhr.abort();
      } catch {
        // ignore
      }
      reject(new DOMException('Upload aborted', 'AbortError'));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    if (xhr.upload) {
      xhr.upload.onprogress = (evt) => {
        if (!evt.lengthComputable) {
          return;
        }
        try {
          onProgress({
            loaded: evt.loaded,
            total: evt.total,
            percent: evt.total > 0 ? evt.loaded / evt.total : 0,
          });
        } catch {
          // ignore progress callback errors
        }
      };
    }

    xhr.onload = () => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      if (aborted) {
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`No se pudo subir "${file.name}" a R2.`));
      }
    };

    xhr.onerror = () => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      if (aborted) {
        return;
      }
      reject(new Error(`No se pudo subir "${file.name}" a R2.`));
    };

    xhr.send(file);
  });
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
