// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import AstroPWA from '@vite-pwa/astro';

// https://astro.build/config
export default defineConfig({
  site: 'https://alabanzaredilestadio.com',
  base: '/',
  integrations: [
    AstroPWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true
      },
      manifest: {
        name: 'Repertorio Alabanza Redil',
        short_name: 'Redil Alabanza',
        description: 'Administración de canciones, tonos y recursos.',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        icons: [
          { src: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512x512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,ico,txt}'] }
    })
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});