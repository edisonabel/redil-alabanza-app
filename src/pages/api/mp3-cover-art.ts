import type { APIRoute } from 'astro';

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

const extractCoverArt = (buffer: ArrayBuffer) => {
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
      headers: { Range: 'bytes=0-524287' },
      redirect: 'follow',
    });
  } catch {
    return new Response('Could not fetch MP3', { status: 502 });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response('MP3 unavailable', { status: upstream.status });
  }

  const coverArt = extractCoverArt(await upstream.arrayBuffer());
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
