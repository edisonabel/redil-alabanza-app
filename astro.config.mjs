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

const legacyCatchBindingPlugin = () => ({
  name: 'legacy-catch-binding',
  apply: 'build',
  enforce: 'post',
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
    plugins: [tailwindcss(), legacyCatchBindingPlugin()],
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
