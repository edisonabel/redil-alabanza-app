export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'rgb(var(--bg-background) / <alpha-value>)',
        surface: 'rgb(var(--bg-surface) / <alpha-value>)',
        border: 'rgb(var(--border-base) / <alpha-value>)',
        content: {
          DEFAULT: 'rgb(var(--text-base) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
        },
        brand: 'rgb(var(--color-brand) / <alpha-value>)',
        danger: 'rgb(var(--color-danger) / <alpha-value>)',
        success: 'rgb(var(--color-success) / <alpha-value>)',
        warning: 'rgb(var(--color-warning) / <alpha-value>)',
        info: 'rgb(var(--color-info) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        neutral: 'rgb(var(--color-neutral) / <alpha-value>)',
        overlay: 'rgb(var(--color-overlay) / <alpha-value>)',
        rol: {
          dir: 'rgb(var(--color-rol-dir) / <alpha-value>)',
          let: 'rgb(var(--color-rol-let) / <alpha-value>)',
          ban: 'rgb(var(--color-rol-ban) / <alpha-value>)',
          voc: 'rgb(var(--color-rol-voc) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};

