import { useCallback, useEffect, useState } from 'react';
import ModoEnsayoCompacto from './ModoEnsayoCompacto.jsx';
import { fetchLiveDirectorSongSession } from '../../utils/liveDirectorUploadClient';
import { readLiveBrowserCapabilities } from '../../utils/liveDiagnostics';

// ── ChordPro parser ──────────────────────────────────────────────────────────
// Identical logic to AdminRepertorio so sections are compatible.

const SECTION_LABEL_RE = /^\s*\[([^\]]+)\]\s*(.*)$/;
const PURE_SECTION_HEADER_RE = /^\[([^\[\]]+)\]$/;
const CHORD_BODY_PATTERN =
  '[A-G](?:#|b)?(?:[a-z0-9+#°ø()\\-]*)?(?:\\/[A-G](?:#|b)?(?:[a-z0-9+#°ø()\\-]*)?)?';
const CHORD_TOKEN_RE = new RegExp(
  `^\\(?\\s*(\\[${CHORD_BODY_PATTERN}\\]\\s*)+\\)?\\s*$`,
  'i',
);
const CHORD_SYMBOL_RE = new RegExp(`^${CHORD_BODY_PATTERN}$`, 'i');
const LEADING_CHORD_SECTION_RE = new RegExp(`^\\[(${CHORD_BODY_PATTERN})\\|`, 'i');
const BROKEN_INLINE_CHORD_RE = new RegExp(
  `\\[(${CHORD_BODY_PATTERN})\\s*\\|\\s*`,
  'gi',
);

const normalizeSectionName = (rawValue = '') => {
  const cleaned = String(rawValue).trim();
  if (!cleaned) return 'Seccion';
  const normalized = cleaned.toLowerCase();
  if (normalized === 'soc' || normalized === 'start_of_chorus') return 'Coro';
  if (normalized === 'sov' || normalized === 'start_of_verse') return 'Verso';
  if (normalized === 'sob' || normalized === 'start_of_bridge') return 'Puente';
  if (normalized === 'soi' || normalized === 'start_of_intro') return 'Intro';
  if (
    normalized === 'interlude' ||
    normalized === 'interludio' ||
    normalized === 'instrumental' ||
    normalized === 'start_of_interlude'
  )
    return 'Interludio';
  if (normalized === 'sot' || normalized === 'start_of_tag') return 'Tag';
  if (
    ['eoc', 'eov', 'eob', 'eoi', 'eot'].includes(normalized) ||
    normalized.startsWith('end_of_')
  )
    return '';
  return cleaned;
};

const isLikelySectionHeader = (rawHeader = '') => {
  const cleaned = String(rawHeader || '').trim();
  if (!cleaned) return false;
  if (CHORD_SYMBOL_RE.test(cleaned)) return false;
  const normalized = cleaned.toLowerCase();
  if (
    [
      'intro', 'interlude', 'interludio', 'instrumental',
      'coro', 'chorus', 'pre coro', 'pre-coro',
      'verse', 'verso', 'puente', 'bridge',
      'tag', 'outro', 'final',
    ].some((label) => normalized.startsWith(label))
  )
    return true;
  return /\d/.test(cleaned);
};

const parseSectionHeader = (rawHeader = '') => {
  const cleaned = String(rawHeader || '').trim();
  if (!cleaned) return { name: 'Seccion', note: '' };
  const [rawName, ...rawNoteParts] = cleaned.split('|');
  return {
    name: normalizeSectionName(rawName.trim()) || 'Seccion',
    note: rawNoteParts.join('|').trim(),
  };
};

const repararChordProCorrupto = (rawValue = '') => {
  if (!rawValue || typeof rawValue !== 'string') return '';
  return String(rawValue)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => {
      let fixedLine = line;
      if (
        LEADING_CHORD_SECTION_RE.test(fixedLine) ||
        BROKEN_INLINE_CHORD_RE.test(fixedLine)
      ) {
        fixedLine = fixedLine.replace(LEADING_CHORD_SECTION_RE, '[$1]');
        fixedLine = fixedLine.replace(BROKEN_INLINE_CHORD_RE, '[$1]');
        fixedLine = fixedLine.replace(/(?:\s*\|\s*)+\]+\s*$/, '');
      }
      BROKEN_INLINE_CHORD_RE.lastIndex = 0;
      return fixedLine;
    })
    .join('\n');
};

const parseChordProSections = (rawChordpro = '') => {
  const content = repararChordProCorrupto(
    String(rawChordpro || ''),
  )
    .replace(/\r\n/g, '\n')
    .trim();

  if (!content) return [];

  const sections = [];
  let currentSection = { name: 'Letra', note: '', lines: [] };

  const pushCurrentSection = () => {
    const sectionName = String(currentSection.name || '').trim();
    const shouldKeep =
      sectionName && sectionName.toLowerCase() !== 'letra';
    if (
      currentSection.lines.length === 0 &&
      !currentSection.note &&
      !shouldKeep
    )
      return;
    sections.push({
      name: sectionName || 'Letra',
      note: currentSection.note || '',
      lines: [...currentSection.lines],
    });
  };

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) continue;

    const inlineSectionMatch = trimmed.match(SECTION_LABEL_RE);
    if (inlineSectionMatch && isLikelySectionHeader(inlineSectionMatch[1])) {
      pushCurrentSection();
      const nextSection = parseSectionHeader(inlineSectionMatch[1]);
      const inlineRest = String(inlineSectionMatch[2] || '').trim();
      currentSection = { name: nextSection.name, note: nextSection.note, lines: [] };
      if (inlineRest) {
        if (CHORD_TOKEN_RE.test(inlineRest)) {
          currentSection.lines.push(inlineRest.replace(/\s{2,}/g, ' ').trim());
        } else {
          currentSection.note = currentSection.note
            ? `${currentSection.note} | ${inlineRest}`
            : inlineRest;
        }
      }
      continue;
    }

    const sectionLineMatch = trimmed.match(PURE_SECTION_HEADER_RE);
    if (sectionLineMatch && isLikelySectionHeader(sectionLineMatch[1])) {
      pushCurrentSection();
      const nextSection = parseSectionHeader(sectionLineMatch[1]);
      currentSection = { name: nextSection.name, note: nextSection.note, lines: [] };
      continue;
    }

    const directiveMatch = trimmed.match(/^\{([^}:]+)(?::\s*(.+))?\}$/);
    if (directiveMatch) {
      const rawDirectiveName = String(directiveMatch[1] || '').trim();
      const directiveKey = rawDirectiveName.toLowerCase();
      const directiveName = normalizeSectionName(rawDirectiveName);
      const directiveValue = directiveMatch[2]?.trim() || '';

      if (['title', 'artist', 'subtitle', 'key', 'tempo', 'bpm', 'capo'].includes(directiveKey)) {
        continue;
      }
      if (directiveKey === 'comment' || directiveKey === 'c') {
        if (!currentSection.note && directiveValue) currentSection.note = directiveValue;
        else if (directiveValue) currentSection.lines.push(directiveValue);
        continue;
      }
      if (directiveName) {
        pushCurrentSection();
        const nextSection = parseSectionHeader(directiveValue || directiveName);
        currentSection = { name: nextSection.name, note: nextSection.note, lines: [] };
      }
      continue;
    }

    currentSection.lines.push(line);
  }

  pushCurrentSection();
  return sections;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const isRemoteChordProUrl = (value = '') => {
  const s = String(value || '').trim();
  return /^https?:\/\//i.test(s) && /\.(txt|pro|cho|chordpro)(\?.*)?$/i.test(s);
};

const ENSAYO_OPEN_TIMEOUT_MS = 10_000;
const ENSAYO_OPEN_RETRY_DELAY_MS = 350;
const PWA_ISOLATION_WORKER_VERSION = 'redil-sw-v4';
const PWA_ISOLATION_WORKER_URL = `/sw.js?v=${PWA_ISOLATION_WORKER_VERSION}`;
const PWA_ISOLATION_WORKER_TIMEOUT_MS = 5_000;

const wait = (ms) => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

const runWithTimeout = async (factory, label) => {
  let timeoutId = null;
  try {
    return await Promise.race([
      factory(),
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(`${label} tardó más de ${ENSAYO_OPEN_TIMEOUT_MS / 1000}s en responder.`));
        }, ENSAYO_OPEN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
};

const runWithOneRetry = async (factory, label) => {
  try {
    return await runWithTimeout(factory, label);
  } catch (firstError) {
    console.warn(`[EnsayoGlobalIsland] ${label} falló; reintentando una vez.`, firstError);
    await wait(ENSAYO_OPEN_RETRY_DELAY_MS);
    return runWithTimeout(factory, label);
  }
};

const resolveChordPro = async (raw = '') => {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (!isRemoteChordProUrl(value)) return value;
  try {
    const res = await runWithOneRetry(() => fetch(value), 'ChordPro remoto');
    if (!res.ok) return value;
    const text = (await res.text()).trim();
    return text || value;
  } catch {
    return value;
  }
};

const resolveMultitrackSession = async (song = {}) => {
  const localSession = song?.multitrackSession || song?.multitrack_session || null;
  if (localSession) return localSession;

  const songId = String(song?.id || '').trim();
  if (!songId || song?.hasMultitrackSession === false) return null;

  try {
    return await runWithOneRetry(
      () => fetchLiveDirectorSongSession(songId),
      'Sesión multitrack',
    );
  } catch (error) {
    console.warn('[EnsayoGlobalIsland] No se pudo cargar la sesion multitrack guardada.', error);
    return null;
  }
};

const readServiceWorkerVersion = async (worker) => {
  if (!worker || typeof MessageChannel !== 'function') return '';

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (version = '') => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      channel.port1.close();
      channel.port2.close();
      resolve(String(version || ''));
    };
    const timeoutId = window.setTimeout(() => finish(), 250);

    channel.port1.onmessage = (event) => {
      finish(event.data?.version);
    };
    worker.postMessage({ type: 'redil-sw-version' }, [channel.port2]);
  });
};

const waitForWorkerActivation = async (worker) => {
  if (!worker || worker.state === 'activated') return;

  await new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      worker.removeEventListener('statechange', handleStateChange);
      reject(new Error('El Service Worker aislado no se activó a tiempo.'));
    }, PWA_ISOLATION_WORKER_TIMEOUT_MS);

    const handleStateChange = () => {
      if (worker.state === 'activated') {
        window.clearTimeout(timeoutId);
        worker.removeEventListener('statechange', handleStateChange);
        resolve();
      } else if (worker.state === 'redundant') {
        window.clearTimeout(timeoutId);
        worker.removeEventListener('statechange', handleStateChange);
        reject(new Error('El Service Worker aislado quedó redundante.'));
      }
    };

    worker.addEventListener('statechange', handleStateChange);
    handleStateChange();
  });
};

const prepareStandaloneIsolationWorker = async () => {
  if (!('serviceWorker' in navigator) || window.crossOriginIsolated === true) return;

  const registration = await navigator.serviceWorker.register(PWA_ISOLATION_WORKER_URL, {
    scope: '/',
    updateViaCache: 'none',
  });
  await registration.update();
  await waitForWorkerActivation(registration.installing || registration.waiting);
  await navigator.serviceWorker.ready;

  const deadline = performance.now() + PWA_ISOLATION_WORKER_TIMEOUT_MS;
  while (performance.now() < deadline) {
    const activeVersion = await readServiceWorkerVersion(registration.active);
    const controllerVersion = await readServiceWorkerVersion(navigator.serviceWorker.controller);
    if (
      activeVersion === PWA_ISOLATION_WORKER_VERSION
      || controllerVersion === PWA_ISOLATION_WORKER_VERSION
    ) {
      return;
    }
    await wait(120);
  }

  throw new Error('La web app no tomó el Service Worker aislado a tiempo.');
};

const openIsolatedLiveDirectorForSafari = async (song = {}) => {
  if (typeof window === 'undefined') return false;

  const capabilities = readLiveBrowserCapabilities();
  if (!capabilities.isIOS && !capabilities.isSafari) return false;

  const songId = String(song?.id || '').trim();
  if (!songId) return false;

  const targetUrl = new URL('/herramientas/live-director-preview', window.location.origin);
  targetUrl.searchParams.set('song', songId);
  if (new URLSearchParams(window.location.search).get('debug') === '1') {
    targetUrl.searchParams.set('debug', '1');
  }

  if (capabilities.standaloneDisplay) {
    await prepareStandaloneIsolationWorker();
  }

  window.location.assign(targetUrl.toString());
  return true;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function EnsayoGlobalIsland() {
  const [activeSong, setActiveSong] = useState(null);
  const [openingSong, setOpeningSong] = useState(null);
  const [openError, setOpenError] = useState('');

  const openSong = useCallback(async (raw) => {
    if (!raw) return;

    setOpeningSong(raw);
    setOpenError('');

    try {
      const [chordproText, multitrackSession] = await Promise.all([
        resolveChordPro(raw.chordpro),
        resolveMultitrackSession(raw),
      ]);

      if (multitrackSession && await openIsolatedLiveDirectorForSafari(raw)) {
        setOpeningSong(null);
        return;
      }

      const sections =
        Array.isArray(raw.sections) && raw.sections.length > 0
          ? raw.sections
          : parseChordProSections(chordproText);

      const sectionMarkers = Array.isArray(raw.sectionMarkers) ? raw.sectionMarkers : [];
      setActiveSong({
        ...raw,
        chordpro: chordproText,
        sections,
        sectionMarkers,
        ...(multitrackSession ? { multitrackSession } : {}),
      });
      setOpeningSong(null);
    } catch (error) {
      console.error('[EnsayoGlobalIsland] No se pudo abrir el modo ensayo.', error);
      setOpenError(error instanceof Error ? error.message : 'No se pudo abrir el modo ensayo.');
    }
  }, []);

  useEffect(() => {
    const handleOpen = async (event) => {
      const raw = event?.detail?.song;
      if (!raw) return;
      void openSong(raw);
    };

    window.addEventListener('open-ensayo-compacto', handleOpen);
    return () => window.removeEventListener('open-ensayo-compacto', handleOpen);
  }, [openSong]);

  const handleGoBack = useCallback(() => {
    setActiveSong(null);
    setOpenError('');
    setOpeningSong(null);
  }, []);

  if (!activeSong && (openingSong || openError)) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/24 px-5 backdrop-blur-[10px]">
        <div className="w-full max-w-sm rounded-[1.6rem] border border-white/12 bg-[linear-gradient(180deg,rgba(18,20,23,0.96),rgba(11,12,14,0.96))] px-5 py-5 text-white shadow-[0_28px_70px_rgba(0,0,0,0.34)]">
          <p className="text-[0.72rem] font-black uppercase tracking-[0.24em] text-sky-100/68">
            Modo ensayo
          </p>
          <h2 className="mt-2 text-[1.35rem] font-semibold tracking-tight">
            {openError ? 'No pudimos abrir la sesión' : 'Abriendo ensayo...'}
          </h2>
          <p className="mt-2 text-[0.92rem] leading-relaxed text-white/62">
            {openError || 'Preparando letras, carátulas y la sesión de audio.'}
          </p>
          {!openError && (
            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/8">
              <div className="live-director-indeterminate h-full w-1/3 rounded-full bg-sky-300/90" />
            </div>
          )}
          {openError && (
            <button
              type="button"
              onClick={() => {
                if (openingSong) {
                  void openSong(openingSong);
                }
              }}
              className="mt-5 rounded-[1rem] border border-sky-300/24 bg-sky-400/14 px-4 py-3 text-[0.78rem] font-black uppercase tracking-[0.16em] text-sky-50"
            >
              Reintentar
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!activeSong) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      <ModoEnsayoCompacto
        song={activeSong}
        contextTitle="Repertorio"
        onGoBack={handleGoBack}
      />
    </div>
  );
}
