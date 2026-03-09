// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import AstroPWA from '@vite-pwa/astro';

import netlify from '@astrojs/netlify';

import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  site: 'https://alabanzaredilestadio.com',
  base: '/',
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },

  integrations: [AstroPWA({
    registerType: 'autoUpdate',
    devOptions: {
      enabled: false
    },
    manifest: {
      name: 'Repertorio Alabanza Redil',
      short_name: 'Redil Alabanza',
      description: 'Administración de canciones, tonos y recursos.',
      theme_color: '#0a0a0a',
      background_color: '#0a0a0a',
      display: 'standalone',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
      ]
    },
    workbox: {
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: true,
      navigateFallbackDenylist: [/^\/.*$/],
      globPatterns: ['**/*.{js,css,svg,png,ico,txt,webmanifest}'],
      runtimeCaching: [
        {
          urlPattern: ({ url }) => url.origin.includes('supabase.co'),
          handler: 'NetworkOnly'
        }
      ]
    }
  }), react()],

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: [
        {
          find: /^react\/jsx-runtime$/,
          replacement: fileURLToPath(new URL('./src/lib/react-jsx-runtime-shim.js', import.meta.url))
        }
      ]
    }
  },

  adapter: netlify()
});
