import type { APIRoute } from 'astro';

const COVER_SCAN_BYTES = 2 * 1024 * 1024;

const DRIVE_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
  'drive.usercontent.google.com',
]);

const isAllowedCoverHost = (hostname: string) => {
  const host = hostname.toLowerCase();
  return (
    DRIVE_HOSTS.has(host) ||
    host === 'stems.alabanzaredilestadio.com' ||
    host.endsWith('.r2.dev')
  );
};

const extractGoogleDriveId = (rawUrl: string) => {
  if (!rawUrl) return '';
  return (
    rawUrl.match(/\/file\/d\/([^/]+)/i)?.[1] ||
    rawUrl.match(/[?&]id=([^&]+)/i)?.[1] ||
    ''
  );
};

const toFetchableAudioUrl = (rawUrl: string) => {
  const fileId = extractGoogleDriveId(rawUrl);
  if (!fileId) return rawUrl;
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
};

const readSynchsafeInt = (view: DataView, offset: number) => (
  ((view.getUint8(offset) & 0x7f) << 21) |
  ((view.getUint8(offset + 1) & 0x7f) << 14) |
  ((view.getUint8(offset + 2) & 0x7f) << 7) |
  (view.getUint8(offset + 3) & 0x7f)
);

type CoverArt = {
  bytes: Uint8Array;
  mimeType: string;
};

const readAtomType = (view: DataView, offset: number) => {
  if (offset + 4 > view.byteLength) return '';
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
};

const readUint64Number = (view: DataView, offset: number) => {
  if (offset + 8 > view.byteLength) return 0;
  const high = view.getUint32(offset);
  const low = view.getUint32(offset + 4);
  const value = high * 2 ** 32 + low;
  return Number.isSafeInteger(value) ? value : 0;
};

const detectImageMimeType = (bytes: Uint8Array, dataType = 0) => {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  if (dataType === 14) return 'image/png';
  if (dataType === 13) return 'image/jpeg';
  return 'image/jpeg';
};

const findImageSignatureOffset = (bytes: Uint8Array) => {
  for (let index = 0; index < bytes.length - 8; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd8 && bytes[index + 2] === 0xff) {
      return index;
    }

    if (
      bytes[index] === 0x89 &&
      bytes[index + 1] === 0x50 &&
      bytes[index + 2] === 0x4e &&
      bytes[index + 3] === 0x47 &&
      bytes[index + 4] === 0x0d &&
      bytes[index + 5] === 0x0a &&
      bytes[index + 6] === 0x1a &&
      bytes[index + 7] === 0x0a
    ) {
      return index;
    }
  }

  return -1;
};

const extractId3CoverArt = (buffer: ArrayBuffer): CoverArt | null => {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20) return null;
  if (view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) {
    return null;
  }

  const majorVersion = view.getUint8(3);
  const tagSize = readSynchsafeInt(view, 6);
  const tagEnd = Math.min(10 + tagSize, buffer.byteLength);
  let offset = 10;
  const flags = view.getUint8(5);

  if (flags & 0x40 && offset + 4 < tagEnd) {
    offset += view.getUint32(offset);
  }

  while (offset + 10 < tagEnd) {
    const frameId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );

    const frameSize = majorVersion >= 4
      ? readSynchsafeInt(view, offset + 4)
      : view.getUint32(offset + 4);

    if (frameSize <= 0 || frameSize > tagEnd - offset) break;

    if (frameId === 'APIC') {
      const frameData = new Uint8Array(buffer, offset + 10, frameSize);
      const encoding = frameData[0];
      let position = 1;
      let mimeType = '';

      while (position < frameData.length && frameData[position] !== 0) {
        mimeType += String.fromCharCode(frameData[position]);
        position += 1;
      }

      position += 2;

      if (encoding === 0 || encoding === 3) {
        while (position < frameData.length && frameData[position] !== 0) {
          position += 1;
        }
        position += 1;
      } else {
        while (
          position + 1 < frameData.length &&
          !(frameData[position] === 0 && frameData[position + 1] === 0)
        ) {
          position += 2;
        }
        position += 2;
      }

      const imageData = frameData.slice(position);
      if (imageData.length < 100) return null;
      return {
        bytes: imageData,
        mimeType: mimeType || 'image/jpeg',
      };
    }

    offset += 10 + frameSize;
  }

  return null;
};

const MP4_CONTAINER_ATOMS = new Set([
  'moov',
  'udta',
  'ilst',
  'trak',
  'mdia',
  'minf',
  'stbl',
]);

const extractCoverArtFromCovrAtom = (
  buffer: ArrayBuffer,
  view: DataView,
  start: number,
  end: number,
): CoverArt | null => {
  let offset = start;

  while (offset + 16 <= end) {
    let atomSize = view.getUint32(offset);
    const atomType = readAtomType(view, offset + 4);
    let headerSize = 8;

    if (atomSize === 1) {
      atomSize = readUint64Number(view, offset + 8);
      headerSize = 16;
    } else if (atomSize === 0) {
      atomSize = end - offset;
    }

    if (!atomSize || atomSize < headerSize || offset + atomSize > end) break;

    const atomEnd = offset + atomSize;
    if (atomType === 'data' && offset + headerSize + 8 < atomEnd) {
      const dataType = view.getUint32(offset + headerSize) & 0xffffff;
      const payloadStart = offset + headerSize + 8;
      const bytes = new Uint8Array(buffer, payloadStart, atomEnd - payloadStart);
      const imageOffset = findImageSignatureOffset(bytes);
      const imageBytes = imageOffset > 0 ? bytes.slice(imageOffset) : bytes;

      if (imageBytes.length >= 100) {
        return {
          bytes: imageBytes,
          mimeType: detectImageMimeType(imageBytes, dataType),
        };
      }
    }

    offset = atomEnd;
  }

  const fallbackBytes = new Uint8Array(buffer, start, Math.max(0, end - start));
  const imageOffset = findImageSignatureOffset(fallbackBytes);
  if (imageOffset >= 0) {
    const imageBytes = fallbackBytes.slice(imageOffset);
    if (imageBytes.length >= 100) {
      return {
        bytes: imageBytes,
        mimeType: detectImageMimeType(imageBytes),
      };
    }
  }

  return null;
};

const extractM4aCoverArtInRange = (
  buffer: ArrayBuffer,
  view: DataView,
  start: number,
  end: number,
  depth = 0,
): CoverArt | null => {
  if (depth > 12 || start < 0 || end > buffer.byteLength || end - start < 8) return null;

  let offset = start;
  while (offset + 8 <= end) {
    let atomSize = view.getUint32(offset);
    const atomType = readAtomType(view, offset + 4);
    let headerSize = 8;

    if (atomSize === 1) {
      atomSize = readUint64Number(view, offset + 8);
      headerSize = 16;
    } else if (atomSize === 0) {
      atomSize = end - offset;
    }

    if (!atomSize || atomSize < headerSize) break;

    const atomEnd = offset + atomSize;
    if (atomEnd > end) break;

    if (atomType === 'covr') {
      const coverArt = extractCoverArtFromCovrAtom(buffer, view, offset + headerSize, atomEnd);
      if (coverArt) return coverArt;
    }

    const childStart = atomType === 'meta'
      ? offset + headerSize + 4
      : offset + headerSize;

    if ((atomType === 'meta' || MP4_CONTAINER_ATOMS.has(atomType)) && childStart + 8 <= atomEnd) {
      const coverArt = extractM4aCoverArtInRange(buffer, view, childStart, atomEnd, depth + 1);
      if (coverArt) return coverArt;
    }

    offset = atomEnd;
  }

  return null;
};

const extractM4aCoverArt = (buffer: ArrayBuffer): CoverArt | null => {
  if (buffer.byteLength < 16) return null;
  return extractM4aCoverArtInRange(buffer, new DataView(buffer), 0, buffer.byteLength);
};

const extractCoverArt = (buffer: ArrayBuffer): CoverArt | null => (
  extractId3CoverArt(buffer) || extractM4aCoverArt(buffer)
);

const parseTotalBytesFromContentRange = (contentRange: string | null) => {
  const match = String(contentRange || '').match(/\/(\d+)$/);
  const total = match ? Number(match[1]) : 0;
  return Number.isFinite(total) && total > 0 ? total : 0;
};

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const src = url.searchParams.get('src') || '';
  if (!src) return new Response('Missing src', { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    return new Response('Invalid src URL', { status: 400 });
  }

  if (parsed.protocol !== 'https:' || !isAllowedCoverHost(parsed.hostname)) {
    return new Response('Host not allowed', { status: 403 });
  }

  const ifNoneMatch = request.headers.get('if-none-match');
  const etag = `"mp3-cover-${Buffer.from(src).toString('base64url').slice(0, 32)}"`;
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(toFetchableAudioUrl(src), {
      headers: { Range: `bytes=0-${COVER_SCAN_BYTES - 1}` },
      redirect: 'follow',
    });
  } catch {
    return new Response('Could not fetch audio', { status: 502 });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response('Audio unavailable', { status: upstream.status });
  }

  const firstBuffer = await upstream.arrayBuffer();
  let coverArt = extractCoverArt(firstBuffer);

  const totalBytes = parseTotalBytesFromContentRange(upstream.headers.get('content-range'));
  if (!coverArt && totalBytes > firstBuffer.byteLength && totalBytes > COVER_SCAN_BYTES) {
    const tailStart = Math.max(0, totalBytes - COVER_SCAN_BYTES);
    try {
      const tailResponse = await fetch(toFetchableAudioUrl(src), {
        headers: { Range: `bytes=${tailStart}-${totalBytes - 1}` },
        redirect: 'follow',
      });

      if (tailResponse.ok || tailResponse.status === 206) {
        coverArt = extractCoverArt(await tailResponse.arrayBuffer());
      }
    } catch {
      // The first scan already succeeded as an audio fetch; missing tail metadata is non-fatal.
    }
  }

  if (!coverArt) {
    return new Response(null, {
      status: 204,
      headers: {
        'cache-control': 'public, max-age=86400',
        etag,
      },
    });
  }

  return new Response(coverArt.bytes, {
    status: 200,
    headers: {
      'content-type': coverArt.mimeType,
      'cache-control': 'public, max-age=86400',
      etag,
    },
  });
};
