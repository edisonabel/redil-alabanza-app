import type { TrackData } from '../services/MultitrackEngine';

const M4A_FILE_PATTERN = /\.m4a$/i;
const MP3_FILE_PATTERN = /\.mp3(?:[?#]|$)/i;
const MP4_INSPECTION_BYTES = 2 * 1024 * 1024;

export const LIVE_DIRECTOR_M4A_ACCEPT = '.m4a,audio/mp4,audio/x-m4a,audio/m4a';

const readAscii = (bytes: Uint8Array, offset: number, length: number): string => {
  let value = '';
  const end = Math.min(bytes.byteLength, offset + length);

  for (let index = offset; index < end; index += 1) {
    value += String.fromCharCode(bytes[index]);
  }

  return value;
};

const containsAscii = (bytes: Uint8Array, value: string): boolean => {
  if (!value || bytes.byteLength < value.length) {
    return false;
  }

  const expected = Array.from(value, (character) => character.charCodeAt(0));

  for (let offset = 0; offset <= bytes.byteLength - expected.length; offset += 1) {
    let matches = true;
    for (let index = 0; index < expected.length; index += 1) {
      if (bytes[offset + index] !== expected[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return true;
    }
  }

  return false;
};

const readAtomSize = (
  view: DataView,
  offset: number,
): { headerBytes: number; size: number } | null => {
  if (offset + 8 > view.byteLength) {
    return null;
  }

  const size32 = view.getUint32(offset);
  if (size32 === 1) {
    if (offset + 16 > view.byteLength) {
      return null;
    }
    const high = view.getUint32(offset + 8);
    const low = view.getUint32(offset + 12);
    const size = high * 0x1_0000_0000 + low;
    return Number.isSafeInteger(size) && size >= 16 ? { headerBytes: 16, size } : null;
  }

  if (size32 === 0) {
    return { headerBytes: 8, size: view.byteLength - offset };
  }

  return size32 >= 8 ? { headerBytes: 8, size: size32 } : null;
};

const inspectFastStartM4a = async (file: File): Promise<void> => {
  const inspectionSize = Math.min(file.size, MP4_INSPECTION_BYTES);
  const bytes = new Uint8Array(await file.slice(0, inspectionSize).arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let foundFtyp = false;
  let foundMoov = false;

  while (offset + 8 <= bytes.byteLength) {
    const atom = readAtomSize(view, offset);
    if (!atom) {
      break;
    }

    const type = readAscii(bytes, offset + 4, 4);
    if (type === 'ftyp') {
      foundFtyp = true;
    } else if (type === 'moov') {
      foundMoov = true;
      break;
    } else if (type === 'mdat') {
      throw new Error(
        `"${file.name}" no tiene MP4 Fast Start. Pásalo por el Conversor de stems y vuelve a subirlo.`,
      );
    }

    const nextOffset = offset + atom.size;
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset || nextOffset > bytes.byteLength) {
      break;
    }
    offset = nextOffset;
  }

  if (!foundFtyp || !foundMoov) {
    throw new Error(
      `"${file.name}" no es un M4A preparado para streaming. Usa el Conversor de stems antes de subirlo.`,
    );
  }

  if (containsAscii(bytes, 'alac')) {
    throw new Error(
      `"${file.name}" usa ALAC. Live Director requiere M4A con AAC-LC para funcionar en todos los navegadores.`,
    );
  }

  if (!containsAscii(bytes, 'mp4a')) {
    throw new Error(
      `"${file.name}" no contiene una pista AAC compatible. Convierte el archivo a M4A/AAC-LC.`,
    );
  }
};

export const isLiveDirectorM4aFile = (file: File): boolean => (
  Boolean(file) && M4A_FILE_PATTERN.test(String(file.name || '').trim())
);

export const assertLiveDirectorM4aFiles = async (
  filesInput: FileList | File[],
): Promise<void> => {
  const files = Array.from(filesInput);
  const unsupportedFiles = files.filter((file) => !isLiveDirectorM4aFile(file));

  if (unsupportedFiles.length > 0) {
    const preview = unsupportedFiles.slice(0, 3).map((file) => file.name).join(', ');
    const remaining = unsupportedFiles.length > 3 ? ` y ${unsupportedFiles.length - 3} más` : '';
    throw new Error(
      `Live Director solo admite M4A/AAC-LC con Fast Start. Convierte primero: ${preview}${remaining}.`,
    );
  }

  await Promise.all(files.map((file) => inspectFastStartM4a(file)));
};

const candidateLooksLikeMp3 = (candidate: string | undefined): boolean => {
  const value = String(candidate || '').trim();
  if (!value) {
    return false;
  }

  if (MP3_FILE_PATTERN.test(value)) {
    return true;
  }

  try {
    const parsed = new URL(value, 'https://alabanzaredilestadio.com');
    if (MP3_FILE_PATTERN.test(parsed.pathname)) {
      return true;
    }
    const proxiedSource = parsed.searchParams.get('src');
    return proxiedSource ? candidateLooksLikeMp3(decodeURIComponent(proxiedSource)) : false;
  } catch {
    try {
      return MP3_FILE_PATTERN.test(decodeURIComponent(value));
    } catch {
      return MP3_FILE_PATTERN.test(value);
    }
  }
};

export const isLiveDirectorMp3Track = (track: TrackData): boolean => (
  [track.sourceFileName, track.optimizedUrl, track.url, track.iosUrl, track.nativeUrl]
    .some((candidate) => candidateLooksLikeMp3(candidate))
);
