// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';

import netlify from '@astrojs/netlify';

import react from '@astrojs/react';

const isDevCommand = process.argv.includes('dev');

const reactAliases = [
  {
    find: /^react\/jsx-runtime$/,
    replacement: fileURLToPath(new URL('./src/lib/react-jsx-runtime-shim.js', import.meta.url))
  }
];

const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const shouldApplyCrossOriginIsolation = (url = '') => {
  const pathname = String(url || '').split('?')[0];

  return (
    pathname === '/herramientas/live-director-preview' ||
    pathname === '/ensayo' ||
    pathname.startsWith('/ensayo/') ||
    pathname === '/audio-lab' ||
    pathname.startsWith('/audio-lab/')
  );
};

/**
 * @param {any} request
 * @param {any} response
 * @param {() => void} next
 */
const applyCrossOriginIsolationHeaders = (request, response, next) => {
  if (shouldApplyCrossOriginIsolation(request.url)) {
    for (const [header, value] of Object.entries(crossOriginIsolationHeaders)) {
      response.setHeader(header, value);
    }
  }
  next();
};

const crossOriginIsolationPlugin = () => ({
  name: 'cross-origin-isolation-headers',
  apply: /** @type {'serve'} */ ('serve'),
  /** @param {any} server */
  configureServer(server) {
    server.middlewares.use(applyCrossOriginIsolationHeaders);
  },
  /** @param {any} server */
  configurePreviewServer(server) {
    server.middlewares.use(applyCrossOriginIsolationHeaders);
  },
});

const legacyCatchBindingPlugin = () => ({
  name: 'legacy-catch-binding',
  apply: /** @type {'build'} */ ('build'),
  enforce: /** @type {'post'} */ ('post'),
  /** @param {any} _options @param {Record<string, any>} bundle */
  generateBundle(_options, bundle) {
    for (const asset of Object.values(bundle)) {
      if (asset.type === 'chunk' && /\bcatch\s*\{/.test(asset.code)) {
        asset.code = asset.code.replace(/\bcatch\s*\{/g, 'catch(_error){');
        asset.map = null;
      }

      if (
        asset.type === 'asset' &&
        asset.fileName.endsWith('.js') &&
        typeof asset.source === 'string' &&
        /\bcatch\s*\{/.test(asset.source)
      ) {
        asset.source = asset.source.replace(/\bcatch\s*\{/g, 'catch(_error){');
      }
    }
  },
});

// https://astro.build/config
export default defineConfig({
  output: 'server',
  site: 'https://alabanzaredilestadio.com',
  base: '/',
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'hover',
  },

  integrations: [react()],

  vite: {
    plugins: [
      /** @type {any} */ (crossOriginIsolationPlugin()),
      /** @type {any} */ (tailwindcss()),
      /** @type {any} */ (legacyCatchBindingPlugin()),
    ],
    server: {
      allowedHosts: ['.trycloudflare.com'],
    },
    build: {
      target: 'es2018',
    },
    esbuild: {
      target: 'es2018',
    },
    optimizeDeps: {
      include: ['react-dom/client'],
      needsInterop: ['react-dom/client'],
      exclude: ['@supabase/supabase-js', 'lucide-react'],
    },
    resolve: {
      alias: reactAliases
    }
  },

  adapter: netlify()
});
