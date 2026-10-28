import type { APIRoute } from 'astro';
import { buildSilentAacMp4, readClickCarrierSeconds } from '../../../utils/silentClickCarrier.js';

export const prerender = false;

// Pista virtual de click (silencio AAC) para canciones sin stems. El motor la pide por rangos de bytes.
export const GET: APIRoute = async ({ params, request }) => {
  const seconds = readClickCarrierSeconds(`/api/live-director-click-carrier/${params.file || ''}`);
  if (seconds === null) return new Response('Duración no válida.', { status: 400 });
  const bytes = buildSilentAacMp4(seconds);
  const total = bytes.length;
  const headers = new Headers({
    'content-type': 'audio/mp4',
    'accept-ranges': 'bytes',
    // El contenido depende solo de la duración: la etiqueta identifica la versión del formato.
    etag: `"click-carrier-v1-${seconds}"`,
    'cross-origin-resource-policy': 'same-origin',
  });
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (!range) {
    headers.set('content-length', String(total));
    return new Response(bytes, { status: 200, headers });
  }
  let start = range[1] === '' ? Math.max(0, total - Number(range[2])) : Number(range[1]);
  let end = range[1] === '' || range[2] === '' ? total - 1 : Math.min(total - 1, Number(range[2]));
  if (!(start <= end) || start >= total) {
    headers.set('content-range', `bytes */${total}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set('content-range', `bytes ${start}-${end}/${total}`);
  headers.set('content-length', String(end - start + 1));
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
};
