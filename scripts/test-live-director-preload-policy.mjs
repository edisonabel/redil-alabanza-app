import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  shouldRunLiveDirectorFullFileWebPrewarm,
} from '../src/utils/liveDirectorPreloadPolicy.js';

const desktopChrome = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  userAgentDataMobile: false,
};

assert.equal(
  shouldRunLiveDirectorFullFileWebPrewarm(desktopChrome),
  true,
  'Chrome desktop conserva el prewarm web existente.',
);
assert.equal(
  shouldRunLiveDirectorFullFileWebPrewarm({
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; Pixel 8 Pro) '
      + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
  }),
  false,
  'Chrome Android no descarga stems completos en segundo plano.',
);
assert.equal(
  shouldRunLiveDirectorFullFileWebPrewarm({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) '
      + 'AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1',
  }),
  false,
  'Los navegadores iPhone quedan protegidos.',
);
assert.equal(
  shouldRunLiveDirectorFullFileWebPrewarm({
    maxTouchPoints: 5,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) '
      + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  }),
  false,
  'iPadOS con agente de escritorio no se confunde con macOS.',
);
assert.equal(
  shouldRunLiveDirectorFullFileWebPrewarm({
    userAgent: desktopChrome.userAgent,
    userAgentDataMobile: true,
  }),
  false,
  'La señal Client Hints mobile protege agentes reducidos.',
);
assert.equal(
  shouldRunLiveDirectorFullFileWebPrewarm({
    isNativeRuntime: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; Pixel 8 Pro) '
      + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
  }),
  true,
  'El runtime nativo conserva su comportamiento existente.',
);
assert.equal(
  shouldRunLiveDirectorFullFileWebPrewarm({
    hasNativePreloadEngine: true,
    isNativeRuntime: true,
    userAgent: desktopChrome.userAgent,
  }),
  false,
  'El motor nativo conserva su ruta de precarga separada.',
);

const directorSource = await readFile(
  new URL('../src/components/react/ModoEnsayoDirector.jsx', import.meta.url),
  'utf8',
);
assert.match(
  directorSource,
  /shouldRunLiveDirectorFullFileWebPrewarm\(\{/,
  'Modo Ensayo aplica la política antes del prewarm Cache API.',
);
assert.match(
  directorSource,
  /isSafariWebBrowser\(\)/,
  'La exclusión Safari existente permanece.',
);
assert.match(
  directorSource,
  /NativeLiveDirectorEngine\.preloadTracks\(\{/,
  'La ruta de precarga nativa permanece activa.',
);

console.log('live director preload policy: ok');
