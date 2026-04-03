const escapeHtml = (value = '') =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const normalizeCssColor = (rawValue, fallback) => {
  const value = String(rawValue || '').trim();
  if (!value) return fallback;

  if (/^\d+\s+\d+\s+\d+(?:\s*\/\s*[\d.]+)?$/u.test(value)) {
    return `rgb(${value})`;
  }

  return value;
};

const readThemeColor = (cssVariable, fallback) => {
  if (typeof window === 'undefined') return fallback;

  try {
    const styles = window.getComputedStyle(document.documentElement);
    return normalizeCssColor(styles.getPropertyValue(cssVariable), fallback);
  } catch {
    return fallback;
  }
};

const buildLoadingDocument = ({ url, title, subtitle, badge }) => {
  const origin = window.location.origin;
  const iconVersion = '20260403';
  const faviconSvg = new URL(`/favicon.svg?v=${iconVersion}`, origin).toString();
  const faviconIco = new URL(`/favicon.ico?v=${iconVersion}`, origin).toString();
  const iconPng = new URL('/icon-192.png', origin).toString();

  const brand = readThemeColor('--color-brand', '#14b8a6');
  const surface = readThemeColor('--bg-surface', '#ffffff');
  const border = readThemeColor('--border-base', '#e2e8f0');
  const content = readThemeColor('--text-base', '#0f172a');
  const muted = readThemeColor('--text-muted', '#64748b');
  const background = readThemeColor('--bg-background', '#f8fafc');

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escapeHtml(title)} | Alabanza</title>
    <meta name="theme-color" content="${escapeHtml(brand)}" />
    <link rel="icon" type="image/x-icon" href="${escapeHtml(faviconIco)}" />
    <link rel="icon" type="image/svg+xml" href="${escapeHtml(faviconSvg)}" />
    <style>
      :root {
        color-scheme: light;
        --brand: ${brand};
        --surface: ${surface};
        --border: ${border};
        --content: ${content};
        --muted: ${muted};
        --background: ${background};
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        min-height: 100%;
        background:
          radial-gradient(circle at top, color-mix(in srgb, var(--brand) 18%, transparent), transparent 46%),
          linear-gradient(180deg, color-mix(in srgb, var(--background) 94%, white 6%), var(--background));
        color: var(--content);
        font-family: "Segoe UI", Inter, system-ui, sans-serif;
      }

      body {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }

      .shell {
        width: min(100%, 460px);
        border: 1px solid color-mix(in srgb, var(--border) 80%, white 20%);
        border-radius: 28px;
        background: color-mix(in srgb, var(--surface) 92%, white 8%);
        box-shadow: 0 30px 80px rgba(15, 23, 42, 0.12);
        padding: 28px 24px;
        backdrop-filter: blur(16px);
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--brand) 24%, white 76%);
        background: color-mix(in srgb, var(--brand) 10%, white 90%);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--brand) 78%, black 22%);
      }

      .badge img {
        width: 20px;
        height: 20px;
        border-radius: 6px;
      }

      .card {
        margin-top: 18px;
        border-radius: 24px;
        border: 1px solid color-mix(in srgb, var(--border) 72%, white 28%);
        background:
          radial-gradient(circle at top, color-mix(in srgb, var(--brand) 14%, transparent), transparent 48%),
          color-mix(in srgb, var(--surface) 96%, white 4%);
        padding: 24px 22px;
      }

      .spinner {
        width: 42px;
        height: 42px;
        border-radius: 999px;
        border: 3px solid color-mix(in srgb, var(--brand) 22%, white 78%);
        border-top-color: var(--brand);
        animation: spin 0.9s linear infinite;
      }

      h1 {
        margin: 18px 0 8px;
        font-size: clamp(1.4rem, 5vw, 1.9rem);
        line-height: 1.05;
        letter-spacing: -0.04em;
      }

      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.55;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    </style>
  </head>
  <body>
    <main class="shell" aria-live="polite">
      <div class="badge">
        <img src="${escapeHtml(iconPng)}" alt="" />
        <span>${escapeHtml(badge)}</span>
      </div>
      <section class="card">
        <div class="spinner" aria-hidden="true"></div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(subtitle)}</p>
      </section>
    </main>
  </body>
</html>`;
};

export const openBrandedTab = ({
  url,
  title = 'Abriendo ensayo...',
  subtitle = 'Preparando setlist, acordes y recursos.',
  badge = 'Modo Ensayo',
} = {}) => {
  if (typeof window === 'undefined') return false;

  const safeUrl = String(url || '').trim();
  if (!safeUrl) return false;

  let resolvedUrl = safeUrl;
  try {
    resolvedUrl = new URL(safeUrl, window.location.href).toString();
  } catch {
    // Keep original URL if it cannot be normalized.
  }

  const newTab = window.open('', '_blank');
  if (!newTab) {
    window.open(resolvedUrl, '_blank', 'noopener,noreferrer');
    return false;
  }

  try {
    newTab.opener = null;
  } catch {
    // Ignore opener hardening failures.
  }

  try {
    newTab.document.open();
    newTab.document.write(buildLoadingDocument({
      url: resolvedUrl,
      title,
      subtitle,
      badge,
    }));
    newTab.document.close();
  } catch {
    newTab.location.replace(resolvedUrl);
    return true;
  }

  window.setTimeout(() => {
    try {
      newTab.location.replace(resolvedUrl);
    } catch {
      newTab.location.href = resolvedUrl;
    }
  }, 80);

  return true;
};
