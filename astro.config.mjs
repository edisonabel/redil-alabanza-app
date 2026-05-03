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
    plugins: [tailwindcss()],
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
