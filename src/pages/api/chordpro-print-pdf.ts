import type { APIRoute } from 'astro';
import puppeteer, { type Browser } from 'puppeteer';
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
  const renderUrl = new URL('/render/chordpro-print-pdf', request.url);
  renderUrl.searchParams.set('token', token);
  return renderUrl.toString();
};

const buildPdfFileName = (payload: ChordProPdfPayload) =>
  payload.fileName?.trim() || `${buildChordProPdfFileName(payload.title, payload.artist)}.pdf`;

export const POST: APIRoute = async ({ request }) => {
  let browser: Browser | null = null;
  let token = '';
  let failureStage = 'payload';
  const isLocalRequest = (() => {
    try {
      const url = new URL(request.url);
      return (
        import.meta.env.DEV ||
        url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname.endsWith('.local')
      );
    } catch {
      return Boolean(import.meta.env.DEV);
    }
  })();

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
    failureStage = 'launch-browser';

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    page.on('console', (message) => {
      console.log(`[ChordPro PDF][page console][${message.type()}] ${message.text()}`);
    });
    page.on('pageerror', (error) => {
      console.error('[ChordPro PDF][page error]', error);
    });
    page.on('requestfailed', (failedRequest) => {
      console.warn(
        `[ChordPro PDF][request failed] ${failedRequest.failure()?.errorText || 'unknown'} ${
          failedRequest.url()
        }`
      );
    });

    failureStage = 'open-render-page';
    await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 1 });
    await page.emulateMediaType('screen');
    await page.goto(renderUrl, {
      waitUntil: 'networkidle0',
      timeout: PDF_READY_TIMEOUT_MS,
    });
    failureStage = 'wait-sheet';
    await page.waitForSelector('#chordpro-pdf-sheet', { timeout: PDF_READY_TIMEOUT_MS });
    failureStage = 'wait-ready';
    await page.waitForFunction(() => window.__CHORDPRO_PDF_READY__ === true, {
      timeout: PDF_READY_TIMEOUT_MS,
    });

    failureStage = 'render-pdf';
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
    console.error(`ChordPro PDF generation failed at stage "${failureStage}":`, error);

    const errorMessage =
      error instanceof Error ? error.message : 'No se pudo generar el PDF.';

    return new Response(
      JSON.stringify({
        error: 'No se pudo generar el PDF.',
        ...(isLocalRequest
          ? {
              detail: errorMessage,
              stage: failureStage,
            }
          : {}),
      }),
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
