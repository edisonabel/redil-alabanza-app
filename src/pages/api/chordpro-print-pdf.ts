import type { APIRoute } from 'astro';
import puppeteer, { type Browser, type CookieParam } from 'puppeteer';
import type { ChordProPdfPayload } from '../../lib/chordproPdfPayload';
import {
  buildChordProPdfFileName,
  normalizeChordProPdfPayload,
} from '../../lib/chordproPdfPayload';
import {
  createChordProPdfPayloadToken,
  deleteChordProPdfPayloadToken,
} from '../../lib/chordproPdfPayloadStore';

export const prerender = false;

const PDF_READY_TIMEOUT_MS = 60000;

const buildContentDisposition = (fileName: string) => {
  const safeName = `${buildChordProPdfFileName(fileName)}.pdf`.replace(/\.pdf\.pdf$/i, '.pdf');
  const encodedName = encodeURIComponent(safeName);
  return `inline; filename="${safeName}"; filename*=UTF-8''${encodedName}`;
};

const readIncomingPayload = async (request: Request) => {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const rawJson = await request.json();
    return normalizeChordProPdfPayload(rawJson?.payload ?? rawJson);
  }

  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    const formData = await request.formData();
    const rawPayload = String(formData.get('payload') || '');
    if (!rawPayload.trim()) return null;

    try {
      return normalizeChordProPdfPayload(JSON.parse(rawPayload));
    } catch {
      return null;
    }
  }

  const rawText = await request.text();
  if (!rawText.trim()) return null;

  try {
    return normalizeChordProPdfPayload(JSON.parse(rawText));
  } catch {
    return null;
  }
};

const buildRenderUrl = (request: Request, token: string) => {
  const renderUrl = new URL('/herramientas/chordpro-print-pdf', request.url);
  renderUrl.searchParams.set('token', token);
  return renderUrl.toString();
};

const buildBrowserCookies = (request: Request): CookieParam[] => {
  const cookieHeader = request.headers.get('cookie') || '';
  if (!cookieHeader.trim()) return [];

  const requestUrl = new URL(request.url);
  const cookieUrl = requestUrl.origin;

  return cookieHeader
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const separatorIndex = chunk.indexOf('=');
      if (separatorIndex <= 0) return null;

      return {
        name: chunk.slice(0, separatorIndex).trim(),
        value: chunk.slice(separatorIndex + 1).trim(),
        url: cookieUrl,
      } satisfies CookieParam;
    })
    .filter((cookie): cookie is CookieParam => Boolean(cookie));
};

const buildPdfFileName = (payload: ChordProPdfPayload) =>
  payload.fileName?.trim() || `${buildChordProPdfFileName(payload.title, payload.artist)}.pdf`;

export const POST: APIRoute = async ({ request }) => {
  let browser: Browser | null = null;
  let token = '';

  try {
    const payload = await readIncomingPayload(request);
    if (!payload) {
      return new Response(
        JSON.stringify({ error: 'Payload invalido para generar el PDF.' }),
        {
          status: 400,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        }
      );
    }

    token = await createChordProPdfPayloadToken(payload);
    const renderUrl = buildRenderUrl(request, token);

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    const browserCookies = buildBrowserCookies(request);
    if (browserCookies.length > 0) {
      await page.setCookie(...browserCookies);
    }
    await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 1 });
    await page.emulateMediaType('screen');
    await page.goto(renderUrl, {
      waitUntil: 'networkidle0',
      timeout: PDF_READY_TIMEOUT_MS,
    });

    if (page.url().includes('/login')) {
      return new Response(
        JSON.stringify({ error: 'Tu sesion ya no es valida. Recarga e intenta otra vez.' }),
        {
          status: 401,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        }
      );
    }

    await page.waitForSelector('#chordpro-pdf-sheet', { timeout: PDF_READY_TIMEOUT_MS });
    await page.waitForFunction(() => window.__CHORDPRO_PDF_READY__ === true, {
      timeout: PDF_READY_TIMEOUT_MS,
    });

    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': buildContentDisposition(buildPdfFileName(payload)),
        'cache-control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error('ChordPro PDF generation failed:', error);

    return new Response(
      JSON.stringify({ error: 'No se pudo generar el PDF.' }),
      {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }
    );
  } finally {
    if (browser) {
      await browser.close();
    }

    if (token) {
      await deleteChordProPdfPayloadToken(token);
    }
  }
};
