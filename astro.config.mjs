// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://edisonabel.github.io',
  base: process.env.NODE_ENV === 'production' ? '/redil-alabanza-app' : '/',
  vite: {
    plugins: [tailwindcss()]
  }
});