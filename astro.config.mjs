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
    prefetchAll: false,
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
      theme_color: '#020617',
      background_color: '#020617',
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
      globPatterns: ['**/*.{js,css,svg,png,jpg,jpeg,webp,avif,ico,txt,webmanifest}'],
      runtimeCaching: [
        // R2 audio: Range Requests para streaming multitrack + pads
        {
          urlPattern: ({ url }) => url.hostname === 'pub-4faa87e319a345c38e4f3be570797088.r2.dev',
          handler: 'CacheFirst',
          options: {
            cacheName: 'r2-audio-cache',
            rangeRequests: true,
            cacheableResponse: { statuses: [0, 200] },
            expiration: {
              maxEntries: 50,
              maxAgeSeconds: 7 * 24 * 60 * 60,
            },
          },
        },
        {
          urlPattern: ({ url }) => url.origin.includes('supabase.co'),
          handler: 'NetworkOnly'
        }
      ]
    }
  }), react()],

  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      exclude: ['@supabase/supabase-js', 'lucide-react'],
    },
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
