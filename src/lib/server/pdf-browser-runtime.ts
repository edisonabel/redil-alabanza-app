import type { Browser, Page } from 'puppeteer-core';
import type { AstroCookies } from 'astro';
import { readEnv } from './supabase-env.js';

// Render routes have the same access rules as the workspace. Give the isolated
// PDF browser the caller's session, scoped to this origin, without public URLs
// or authentication tokens in query strings.
export const setPdfBrowserSession = async (page: Page, origin: string, cookies: AstroCookies) => {
  for (const name of ['sb-access-token', 'sb-refresh-token']) {
    const value = cookies.get(name)?.value;
    if (value) await page.setCookie({ name, value, url: origin, httpOnly: true, sameSite: 'Lax', secure: origin.startsWith('https:') });
  }
};

type PdfViewport = {
  width: number;
  height: number;
  deviceScaleFactor: number;
};

type BrowserLauncher = {
  launch: (options: Record<string, unknown>) => Promise<Browser>;
  defaultArgs?: (options?: Record<string, unknown>) => string[] | Promise<string[]>;
};

const CHROMIUM_VERSION = '149.0.0';

export const isDevRuntime = () => (
  readEnv('DEV') === 'true' || process.env.NODE_ENV === 'development'
);

const isServerlessChromiumRuntime = () => (
  !isDevRuntime()
  && Boolean(
    process.env.NETLIFY
    || process.env.AWS_EXECUTION_ENV
    || process.env.AWS_LAMBDA_FUNCTION_NAME
    || process.env.LAMBDA_TASK_ROOT
  )
);

const resolveChromiumPackUrl = () => {
  const configuredUrl = readEnv('CHROMIUM_PACK_URL');
  if (configuredUrl) return configuredUrl;

  const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
  const publicR2Url = readEnv('PUBLIC_R2_URL', 'R2_PUBLIC_URL')?.replace(/\/+$/, '');
  if (publicR2Url && architecture === 'x64') {
    return `${publicR2Url}/runtime/chromium-v${CHROMIUM_VERSION}-pack.x64.tar`;
  }

  return `https://github.com/Sparticuz/chromium/releases/download/v${CHROMIUM_VERSION}/chromium-v${CHROMIUM_VERSION}-pack.${architecture}.tar`;
};

export const getPdfBrowserRuntime = async (defaultViewport: PdfViewport) => {
  if (isServerlessChromiumRuntime()) {
    const [{ default: puppeteerCore }, { default: chromium }] = await Promise.all([
      import('puppeteer-core'),
      import('@sparticuz/chromium-min'),
    ]);

    chromium.setGraphicsMode = false;

    const headlessMode = 'shell';
    const executablePath = await chromium.executablePath(resolveChromiumPackUrl());
    const launchArgs = typeof puppeteerCore.defaultArgs === 'function'
      ? await puppeteerCore.defaultArgs({ args: chromium.args, headless: headlessMode })
      : chromium.args;

    return {
      launcher: puppeteerCore as unknown as BrowserLauncher,
      launchOptions: {
        args: launchArgs,
        defaultViewport,
        executablePath,
        headless: headlessMode,
      },
      runtimeLabel: 'serverless-chromium-min',
    };
  }

  const { default: puppeteer } = await import('puppeteer');
  return {
    launcher: puppeteer as unknown as BrowserLauncher,
    launchOptions: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
    runtimeLabel: 'local-puppeteer',
  };
};
