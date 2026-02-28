// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://edisonabel.github.io',
  base: '/redil-alabanza-app',
  vite: {
    plugins: [tailwindcss()]
  }
});