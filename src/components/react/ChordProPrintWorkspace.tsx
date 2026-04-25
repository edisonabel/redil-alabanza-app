import { useEffect, useMemo, useRef, useState } from 'react';
import ChordProPreview from './ChordProPreview';
import type {
  SongSheetDensity,
  SongSheetLayoutOptions,
  SongSheetMetadata,
  SongSheetRenderMode,
} from './SongSheet';
import { parseChordProSemantic } from '../../utils/parseChordProSemantic';
import { resolveSongSheetSemanticBlocks } from '../../utils/resolveSongSheetSemanticBlocks';
import { inferChordProTone } from '../../utils/inferChordProTone';
import { buildChordProPdfFileName } from '../../lib/chordproPdfPayload';
import { createChordProPdfBrowserToken } from '../../lib/chordproPdfBrowserStore';

const isMobilePrintDevice = () => {
  if (typeof window === 'undefined') return false;
  const navigatorWithUserAgentData = window.navigator as Navigator & {
    userAgentData?: { mobile?: boolean };
  };

  return (
    Boolean(navigatorWithUserAgentData.userAgentData?.mobile) ||
    /Android|iPad|iPhone|iPod/i.test(window.navigator.userAgent) ||
    (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
  );
};

const fetchGeneratedPdfBlob = async (payload: unknown) => {
  const response = await fetch('/api/chordpro-print-pdf', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ payload }),
  });

  if (!response.ok) {
    let detail = 'No se pudo generar el PDF para compartir.';
    try {
      const errorPayload = await response.json();
      detail = String(errorPayload?.detail || errorPayload?.error || detail);
    } catch {
      // Keep the generic message when the server does not return JSON.
    }
    throw new Error(detail);
  }

  return response.blob();
};

type ChordProPrintWorkspaceProps = {
  initialChordProText: string;
  initialTitle: string;
  initialArtist?: string;
  initialMetadata?: SongSheetMetadata;
};

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CAPO_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7];
const OPEN_SHAPE_ROOTS = new Set(['C', 'D', 'E', 'G', 'A']);
const OPEN_MINOR_ROOTS = new Set(['A', 'D', 'E']);
const FLAT_TO_SHARP: Record<string, string> = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
};
const NOTE_BUTTON_ROWS = [
  ['C', 'C#', 'D', 'D#', 'E', 'F'],
  ['F#', 'G', 'G#', 'A', 'A#', 'B'],
];
const CHORD_TOKEN_RE =
  /^[A-G](?:#|b)?(?:[a-z0-9+#/()\-]*)?(?:\/[A-G](?:#|b)?(?:[a-z0-9+#/()\-]*)?)?$/i;

const groupButtonBase =
  'inline-flex min-h-10 items-center justify-center rounded-2xl border px-4 py-2.5 text-sm font-bold transition-all';

const readIsDarkTheme = () => {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
};

const getOptionButtonClass = (active: boolean, isDarkTheme: boolean) =>
  [
    groupButtonBase,
    isDarkTheme
      ? active
        ? 'border-sky-400 bg-sky-500/15 text-sky-200 shadow-[0_12px_28px_rgba(14,165,233,0.16)]'
        : 'border-white/10 bg-white/5 text-zinc-300 hover:border-white/20 hover:bg-white/8 hover:text-white'
      : active
        ? 'border-sky-500/70 bg-sky-500/12 text-sky-700 shadow-[0_16px_32px_rgba(14,165,233,0.14)]'
        : 'border-zinc-200 bg-white/88 text-zinc-700 hover:border-zinc-300 hover:bg-white hover:text-zinc-950',
  ].join(' ');

const getToggleClass = (active: boolean, isDarkTheme: boolean) =>
  [
    'inline-flex h-7 w-12 items-center rounded-full border transition-colors',
    active
      ? isDarkTheme
        ? 'justify-end border-sky-400/60 bg-sky-500/20'
        : 'justify-end border-sky-500/40 bg-sky-500/15'
      : isDarkTheme
        ? 'justify-start border-white/10 bg-white/5'
        : 'justify-start border-zinc-200 bg-zinc-100/90',
  ].join(' ');

const getNoteIndex = (value: string) => NOTES.indexOf(value);

const normalizeNote = (value: string | number | null | undefined) => {
  const safeValue = String(value ?? '').trim();
  if (!safeValue) return '';
  if (FLAT_TO_SHARP[safeValue]) return FLAT_TO_SHARP[safeValue];
  return NOTES.includes(safeValue) ? safeValue : safeValue;
};

const transposeChord = (chord: string, steps: number) => {
  const match = chord.match(/^([A-G][#b]?)(.*)$/);
  if (!match) return chord;

  let root = match[1];
  const modifier = match[2];

  if (FLAT_TO_SHARP[root]) root = FLAT_TO_SHARP[root];

  const currentIndex = getNoteIndex(root);
  if (currentIndex === -1) return chord;

  let nextIndex = (currentIndex + steps) % 12;
  if (nextIndex < 0) nextIndex += 12;

  return `${NOTES[nextIndex]}${modifier}`;
};

const isTransposableChordToken = (value: string) => {
  const safeValue = String(value || '').trim();
  if (!safeValue || safeValue.includes(' ')) return false;
  return CHORD_TOKEN_RE.test(safeValue);
};

const transposeChordProText = (text: string, steps: number) => {
  if (!steps) return text;

  return String(text || '').replace(/\[(.*?)\]/g, (_, chord) => {
    const safeChord = String(chord || '').trim();
    if (!isTransposableChordToken(safeChord)) {
      return `[${safeChord}]`;
    }

    return `[${transposeChord(safeChord, steps)}]`;
  });
};

const getSignedSemitoneDelta = (from: string, to: string) => {
  const fromIndex = getNoteIndex(normalizeNote(from));
  const toIndex = getNoteIndex(normalizeNote(to));
  if (fromIndex === -1 || toIndex === -1) return 0;

  let diff = toIndex - fromIndex;
  if (diff > 6) diff -= 12;
  if (diff < -6) diff += 12;
  return diff;
};

const getShiftedTone = (tone: string, steps: number) => {
  const normalizedTone = normalizeNote(tone);
  const toneIndex = getNoteIndex(normalizedTone);
  if (toneIndex === -1) return '';

  let shiftedIndex = (toneIndex + steps) % 12;
  if (shiftedIndex < 0) shiftedIndex += 12;
  return NOTES[shiftedIndex];
};

const scoreCapoChord = (chord: string) => {
  const rootMatch = chord.match(/^([A-G][#b]?)/);
  if (!rootMatch) return 0;
  let root = rootMatch[1];
  if (FLAT_TO_SHARP[root]) root = FLAT_TO_SHARP[root];
  const afterRoot = chord.slice(rootMatch[0].length);
  const bassIdx = afterRoot.indexOf('/');
  const suffix = (bassIdx >= 0 ? afterRoot.slice(0, bassIdx) : afterRoot).toLowerCase();
  const bassRaw = bassIdx >= 0 ? afterRoot.slice(bassIdx + 1) : '';
  let score = 0;
  if (OPEN_SHAPE_ROOTS.has(root)) score += 3.2;
  else if (root === 'F' || root === 'B') score -= 2.2;
  else score -= 0.8;
  if (root.includes('#')) score -= 3.4;
  if (suffix.startsWith('m') && OPEN_MINOR_ROOTS.has(root)) score += 0.9;
  if (bassRaw) {
    let bassRoot = (bassRaw.match(/^([A-G][#b]?)/) || [])[1] || '';
    if (FLAT_TO_SHARP[bassRoot]) bassRoot = FLAT_TO_SHARP[bassRoot];
    if (OPEN_SHAPE_ROOTS.has(bassRoot)) score += 0.8;
    else score -= 0.4;
    if (bassRoot.includes('#')) score -= 1.4;
  }
  return score;
};

const scoreCapoKey = (key: string) => {
  let norm = String(key || '').trim();
  if (!norm || norm === '-') return 0;
  if (FLAT_TO_SHARP[norm]) norm = FLAT_TO_SHARP[norm];
  if (OPEN_SHAPE_ROOTS.has(norm)) return 4.5;
  if (norm === 'F' || norm === 'B') return -2.2;
  if (norm.includes('#')) return -4.2;
  return -0.6;
};

const formatDelta = (steps: number) => {
  if (steps === 0) return 'Original';
  return steps > 0 ? `+${steps}` : String(steps);
};

const formatTransposeSummary = (steps: number) => {
  if (steps === 0) return 'Tono original';
  const absSteps = Math.abs(steps);
  const suffix = absSteps === 1 ? 'tono' : 'tonos';
  return `${steps > 0 ? '+' : '-'}${absSteps} ${suffix}`;
};

export default function ChordProPrintWorkspace({
  initialChordProText,
  initialTitle,
  initialArtist = '',
  initialMetadata,
}: ChordProPrintWorkspaceProps) {
  const explicitOriginalTone = normalizeNote(initialMetadata?.tone);
  const inferredOriginalTone = useMemo(() => {
    if (explicitOriginalTone) return '';
    const semanticNodes = parseChordProSemantic(initialChordProText);
    const semanticBlocks = resolveSongSheetSemanticBlocks(semanticNodes, {
      mode: 'complete',
    });
    return inferChordProTone(semanticBlocks);
  }, [explicitOriginalTone, initialChordProText]);
  const originalTone = explicitOriginalTone || inferredOriginalTone;
  const [isDarkTheme, setIsDarkTheme] = useState(() => readIsDarkTheme());
  const [title, setTitle] = useState(initialTitle || '');
  const [artist, setArtist] = useState(initialArtist || '');
  const [targetTone, setTargetTone] = useState(originalTone || '');
  const [selectedCapo, setSelectedCapo] = useState(0);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const pdfFeedbackTimeoutRef = useRef<number | null>(null);
  const [sheetOptions, setSheetOptions] = useState<Required<SongSheetLayoutOptions>>({
    renderMode: 'chords-lyrics',
    columnCount: 2,
    density: 'complete',
    showSongMap: true,
    showSectionDividers: true,
    styleMode: 'completo',
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const safeTitle = title.trim() || 'SIN TITULO';
    const safeArtist = artist.trim();
    document.title = safeArtist ? `${safeTitle} - ${safeArtist}` : safeTitle;
  }, [artist, title]);

  useEffect(() => {
    return () => {
      if (pdfFeedbackTimeoutRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(pdfFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncTheme = () => {
      setIsDarkTheme(readIsDarkTheme());
    };

    syncTheme();

    window.addEventListener('redil:theme-changed', syncTheme as EventListener);
    document.addEventListener('astro:after-swap', syncTheme);

    return () => {
      window.removeEventListener('redil:theme-changed', syncTheme as EventListener);
      document.removeEventListener('astro:after-swap', syncTheme);
    };
  }, []);

  useEffect(() => {
    setSheetOptions((current) => {
      const needsCondensedSingleColumn = current.columnCount === 1 && current.density !== 'condensed';
      const needsSectionDividers = !current.showSectionDividers;

      if (!needsCondensedSingleColumn && !needsSectionDividers) {
        return current;
      }

      return {
        ...current,
        showSectionDividers: true,
        ...(needsCondensedSingleColumn
          ? {
            density: 'condensed',
            styleMode: 'condensado' as const,
          }
          : {}),
      };
    });
  }, []);

  const semitoneDelta = useMemo(
    () => getSignedSemitoneDelta(originalTone, targetTone),
    [originalTone, targetTone]
  );

  const songChordTokens = useMemo(() => {
    const tokens: string[] = [];
    const seen = new Set<string>();
    String(initialChordProText || '').replace(/\[([^\]]+)\]/g, (_, chord) => {
      const safe = String(chord || '').trim();
      if (isTransposableChordToken(safe) && !seen.has(safe)) {
        seen.add(safe);
        tokens.push(safe);
      }
      return '';
    });
    return tokens;
  }, [initialChordProText]);

  const capoScores = useMemo(() => {
    const base = targetTone || originalTone;
    return CAPO_OPTIONS.map((fret) => {
      const shapeKey = fret > 0 ? getShiftedTone(base, -fret) : base;
      const steps = semitoneDelta - fret;
      const score = songChordTokens.reduce(
        (total, token) => total + scoreCapoChord(transposeChord(token, steps)),
        0
      ) + scoreCapoKey(shapeKey);
      return { fret, shapeKey, score };
    });
  }, [targetTone, originalTone, songChordTokens, semitoneDelta]);

  const recommendedCapo = useMemo(() => {
    const candidates = capoScores.filter((o) => o.fret > 0 && songChordTokens.length > 0);
    if (candidates.length === 0) return null;
    return candidates.reduce((best, option) => {
      if (!best) return option;
      if (option.score > best.score + 0.01) return option;
      if (Math.abs(option.score - best.score) <= 0.01 && option.fret < best.fret) return option;
      return best;
    }, null as (typeof candidates)[0] | null);
  }, [capoScores, songChordTokens]);

  const displayedTone = useMemo(
    () => getShiftedTone(targetTone, -selectedCapo),
    [selectedCapo, targetTone]
  );

  const playbackSemitoneDelta = useMemo(
    () => semitoneDelta - selectedCapo,
    [selectedCapo, semitoneDelta]
  );

  const transposedChordProText = useMemo(
    () => transposeChordProText(initialChordProText, playbackSemitoneDelta),
    [initialChordProText, playbackSemitoneDelta]
  );

  const previewMetadata = useMemo(
    () => ({
      tone: targetTone || originalTone || '',
      capo: selectedCapo > 0
        ? `${selectedCapo}${displayedTone ? ` (${displayedTone})` : ''}`
        : '0',
      tempo: initialMetadata?.tempo ?? '',
      time: initialMetadata?.time ?? '',
    }),
    [displayedTone, initialMetadata?.tempo, initialMetadata?.time, originalTone, selectedCapo, targetTone]
  );

  const setRenderMode = (renderMode: SongSheetRenderMode) => {
    setSheetOptions((current) => ({ ...current, renderMode }));
  };

  const setDensityMode = (density: SongSheetDensity) => {
    setSheetOptions((current) => ({
      ...current,
      density,
      styleMode: density === 'condensed' ? 'condensado' : 'completo',
    }));
  };

  const setColumnCountMode = (columnCount: 1 | 2) => {
    setSheetOptions((current) => {
      if (columnCount === 1) {
        return {
          ...current,
          columnCount,
          density: 'condensed',
          styleMode: 'condensado',
        };
      }

      return {
        ...current,
        columnCount,
      };
    });
  };

  const handlePrint = async () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const payload = {
      chordProText: transposedChordProText,
      title: title.trim(),
      artist: artist.trim(),
      metadata: {
        tone: String(previewMetadata.tone ?? ''),
        capo: String(previewMetadata.capo ?? ''),
        tempo: String(previewMetadata.tempo ?? ''),
        time: String(previewMetadata.time ?? ''),
      },
      sheetOptions,
      fileName: `${buildChordProPdfFileName(title, artist)}.pdf`,
    };

    const targetName = 'chordpro-pdf-preview';

    if (isMobilePrintDevice()) {
      setIsGeneratingPdf(true);
      try {
        const blob = await fetchGeneratedPdfBlob(payload);
        const file = new File([blob], payload.fileName, { type: 'application/pdf' });

        if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: payload.title || 'ChordPro PDF' });
        } else {
          const blobUrl = URL.createObjectURL(blob);
          window.open(blobUrl, '_blank');
          setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
        }
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          // User cancelled the share sheet — not an error
        } else {
          console.error('ChordPro iOS PDF generation failed:', error);
          alert('Hubo un error al generar el PDF para imprimir.');
        }
      } finally {
        setIsGeneratingPdf(false);
      }
      return;
    }

    const previewWindow = window.open('', targetName);

    if (previewWindow && !previewWindow.closed) {
      previewWindow.document.title = 'Generando PDF...';
      previewWindow.document.body.innerHTML = `
        <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:Segoe UI,Arial,sans-serif;background:#ffffff;color:#111827;">
          <div style="text-align:center;max-width:28rem;padding:2rem;">
            <p style="margin:0 0 0.75rem;font-size:0.8rem;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:#64748b;">ChordPro</p>
            <h1 style="margin:0 0 0.5rem;font-size:1.5rem;font-weight:900;">Generando PDF</h1>
            <p style="margin:0;font-size:0.95rem;line-height:1.55;color:#475569;">Estamos preparando el archivo exacto para imprimir.</p>
          </div>
        </div>
      `;
    }

    setIsGeneratingPdf(true);
    if (pdfFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(pdfFeedbackTimeoutRef.current);
    }
    try {
      const clientToken = createChordProPdfBrowserToken(payload as any);
      const renderUrl = new URL('/render/chordpro-print-pdf', window.location.origin);
      renderUrl.searchParams.set('clientToken', clientToken);
      renderUrl.searchParams.set('autoprint', '1');

      if (previewWindow && !previewWindow.closed) {
        previewWindow.location.href = renderUrl.toString();
      } else {
        window.open(renderUrl.toString(), targetName);
      }
    } catch (error) {
      console.error('ChordPro print route preparation failed:', error);

      const errorMessage =
        error instanceof Error ? error.message : 'No se pudo preparar la hoja para imprimir.';

      if (previewWindow && !previewWindow.closed) {
        previewWindow.document.title = 'Error al preparar impresion';
        previewWindow.document.body.innerHTML = `
          <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:Segoe UI,Arial,sans-serif;background:#0f172a;color:#f8fafc;">
            <div style="max-width:34rem;padding:2rem;">
               <p style="margin:0 0 0.75rem;font-size:0.8rem;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:#93c5fd;">ChordPro</p>
               <h1 style="margin:0 0 0.75rem;font-size:1.6rem;font-weight:900;">No se pudo abrir la hoja</h1>
               <p style="margin:0;font-size:0.95rem;line-height:1.65;color:#cbd5e1;">${errorMessage}</p>
            </div>
          </div>
        `;
      }
    } finally {
      setIsGeneratingPdf(false);
      pdfFeedbackTimeoutRef.current = null;
    }
  };

  const zoomLabel = `${Math.round(previewZoom * 100)}%`;
  const completeModeDisabled = sheetOptions.columnCount === 1;

  const sidebarShellClasses = isDarkTheme
    ? 'border-white/10 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_28%),linear-gradient(180deg,_rgba(9,9,11,0.98),_rgba(15,23,42,0.96))] text-white shadow-[0_30px_80px_rgba(2,6,23,0.35)]'
    : 'border-zinc-200/80 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_26%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.98))] text-zinc-950 shadow-[0_30px_80px_rgba(148,163,184,0.16)]';
  const eyebrowTextClasses = isDarkTheme ? 'text-zinc-400' : 'text-slate-500';
  const titleTextClasses = isDarkTheme ? 'text-white' : 'text-slate-950';
  const bodyTextClasses = isDarkTheme ? 'text-zinc-400' : 'text-slate-600';
  const fieldClasses = isDarkTheme
    ? 'border-white/10 bg-white/5 text-white placeholder:text-zinc-500 focus:border-sky-400/60 focus:bg-white/8'
    : 'border-zinc-200 bg-white/88 text-zinc-950 placeholder:text-zinc-400 focus:border-sky-500/60 focus:bg-white';
  const metricCardClasses = isDarkTheme
    ? 'border-white/10 bg-white/5'
    : 'border-zinc-200 bg-white/84 shadow-[0_10px_28px_rgba(148,163,184,0.08)]';
  const metricLabelClasses = isDarkTheme ? 'text-zinc-500' : 'text-slate-400';
  const metricValueClasses = isDarkTheme ? 'text-white' : 'text-slate-950';
  const metricHintClasses = isDarkTheme ? 'text-zinc-400' : 'text-slate-500';
  const structurePanelClasses = isDarkTheme
    ? 'border-white/10 bg-white/5'
    : 'border-zinc-200 bg-white/80 shadow-[0_10px_28px_rgba(148,163,184,0.08)]';
  const sectionTitleClasses = isDarkTheme ? 'text-white' : 'text-slate-950';
  const sectionBodyClasses = isDarkTheme ? 'text-zinc-400' : 'text-slate-500';

  return (
    <div className="mx-auto flex w-full max-w-[1880px] flex-col gap-4 px-4 pb-4 lg:flex-row lg:items-start lg:px-6 xl:px-8 print:block print:max-w-none print:px-0 print:py-0">
      <aside
        className={[
          'w-full shrink-0 rounded-[2rem] border p-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2.75rem)] lg:w-[340px] lg:overflow-auto xl:w-[360px] 2xl:w-[390px] print:hidden',
          sidebarShellClasses,
        ].join(' ')}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className={['text-[1.45rem] font-black tracking-[-0.04em]', titleTextClasses].join(' ')}>
            Configura tu impresion
          </h1>
          <span
            className={[
              'inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em]',
              isDarkTheme
                ? 'border-white/10 bg-white/5 text-zinc-300'
                : 'border-zinc-200 bg-white/88 text-slate-500',
            ].join(' ')}
          >
            Carta
          </span>
        </div>

        <div className="space-y-4">
          <section className="space-y-3">
            <h2 className={['text-xs font-black uppercase tracking-[0.18em]', eyebrowTextClasses].join(' ')}>
              Cancion
            </h2>
            <div className="space-y-3">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Nombre de la cancion"
                className={['w-full rounded-2xl border px-4 py-3 text-sm font-semibold outline-none transition', fieldClasses].join(' ')}
              />
              <input
                value={artist}
                onChange={(event) => setArtist(event.target.value)}
                placeholder="Artista"
                className={['w-full rounded-2xl border px-4 py-3 text-sm font-semibold outline-none transition', fieldClasses].join(' ')}
              />

              <div className="grid grid-cols-2 gap-2.5">
                <div className={['rounded-2xl border px-4 py-3', metricCardClasses].join(' ')}>
                  <p className={['text-[11px] font-black uppercase tracking-[0.18em]', metricLabelClasses].join(' ')}>
                    Tono base
                  </p>
                  <p className={['mt-1 text-[1.55rem] font-black leading-none', metricValueClasses].join(' ')}>
                    {originalTone || '--'}
                  </p>
                </div>
                <div className={['rounded-2xl border px-4 py-3', metricCardClasses].join(' ')}>
                  <p className={['text-[11px] font-black uppercase tracking-[0.18em]', metricLabelClasses].join(' ')}>
                    BPM
                  </p>
                  <p className={['mt-1 text-[1.55rem] font-black leading-none', metricValueClasses].join(' ')}>
                    {String(initialMetadata?.tempo ?? '--') || '--'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className={['text-xs font-black uppercase tracking-[0.18em]', eyebrowTextClasses].join(' ')}>
                Transponer
              </h2>
              <span className={['text-xs font-bold uppercase tracking-[0.14em]', isDarkTheme ? 'text-sky-300' : 'text-sky-600'].join(' ')}>
                {formatTransposeSummary(semitoneDelta)}
              </span>
            </div>
            <div className="space-y-2">
              {NOTE_BUTTON_ROWS.map((row, rowIndex) => (
                <div key={`tone-row-${rowIndex}`} className="grid grid-cols-6 gap-2">
                  {row.map((note) => (
                    <button
                      key={note}
                      type="button"
                      className={getOptionButtonClass(targetTone === note, isDarkTheme)}
                      onClick={() => setTargetTone(note)}
                    >
                      {note}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className={['text-xs font-black uppercase tracking-[0.18em]', eyebrowTextClasses].join(' ')}>
                Capo
              </h2>
              <span className={['text-xs font-bold uppercase tracking-[0.14em]', isDarkTheme ? 'text-sky-300' : 'text-sky-600'].join(' ')}>
                {selectedCapo > 0 ? `${selectedCapo} / ${displayedTone || '--'}` : 'Sin capo'}
              </span>
            </div>
            <div className="grid grid-cols-8 gap-1.5">
              {CAPO_OPTIONS.map((fret) => {
                const isRec = recommendedCapo?.fret === fret;
                return (
                  <div key={fret} className="relative flex flex-col items-center gap-0.5">
                    <button
                      type="button"
                      className={getOptionButtonClass(selectedCapo === fret, isDarkTheme)}
                      onClick={() => setSelectedCapo(fret)}
                    >
                      {fret === 0 ? 'Ø' : fret}
                    </button>
                    {isRec && (
                      <span className={['text-[9px] font-black uppercase tracking-wide', isDarkTheme ? 'text-emerald-400' : 'text-emerald-600'].join(' ')}>
                        ★
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className={['text-xs font-black uppercase tracking-[0.18em]', eyebrowTextClasses].join(' ')}>
              Salida
            </h2>
            <div className="grid grid-cols-1 gap-3">
              <button
                type="button"
                className={getOptionButtonClass(sheetOptions.renderMode === 'chords-lyrics', isDarkTheme)}
                onClick={() => setRenderMode('chords-lyrics')}
              >
                Acordes + letra
              </button>
              <button
                type="button"
                className={getOptionButtonClass(sheetOptions.renderMode === 'lyrics-only', isDarkTheme)}
                onClick={() => setRenderMode('lyrics-only')}
              >
                Solo letra
              </button>
              <button
                type="button"
                className={getOptionButtonClass(sheetOptions.renderMode === 'chords-only', isDarkTheme)}
                onClick={() => setRenderMode('chords-only')}
              >
                Solo acordes
              </button>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className={['text-xs font-black uppercase tracking-[0.18em]', eyebrowTextClasses].join(' ')}>
              Formato
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                className={getOptionButtonClass(sheetOptions.columnCount === 2, isDarkTheme)}
                onClick={() => setColumnCountMode(2)}
              >
                2 columnas
              </button>
              <button
                type="button"
                className={getOptionButtonClass(sheetOptions.columnCount === 1, isDarkTheme)}
                onClick={() => setColumnCountMode(1)}
              >
                1 columna
              </button>
              <button
                type="button"
                disabled={completeModeDisabled}
                title={completeModeDisabled ? '1 columna solo funciona en condensado' : undefined}
                className={[
                  getOptionButtonClass(sheetOptions.density === 'complete', isDarkTheme),
                  completeModeDisabled
                    ? isDarkTheme
                      ? 'cursor-not-allowed opacity-45 saturate-50'
                      : 'cursor-not-allowed opacity-50'
                    : '',
                ].join(' ')}
                onClick={() => {
                  if (completeModeDisabled) return;
                  setDensityMode('complete');
                }}
              >
                Completo
              </button>
              <button
                type="button"
                className={getOptionButtonClass(sheetOptions.density === 'condensed', isDarkTheme)}
                onClick={() => setDensityMode('condensed')}
              >
                Condensado
              </button>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className={['text-xs font-black uppercase tracking-[0.18em]', eyebrowTextClasses].join(' ')}>
              Extras
            </h2>
            <div className={['space-y-3 rounded-[1.5rem] border p-4', structurePanelClasses].join(' ')}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 text-left"
                onClick={() =>
                  setSheetOptions((current) => ({ ...current, showSongMap: !current.showSongMap }))
                }
              >
                <div>
                  <p className={['text-sm font-bold', sectionTitleClasses].join(' ')}>Mapa de cancion</p>
                  <p className={['text-xs', sectionBodyClasses].join(' ')}>
                    Pildoras superiores con el orden de las secciones.
                  </p>
                </div>
                <span className={getToggleClass(sheetOptions.showSongMap, isDarkTheme)}>
                  <span className="m-1 h-4 w-4 rounded-full bg-white shadow-sm" />
                </span>
              </button>
            </div>
          </section>
        </div>

        <button
          type="button"
          onClick={handlePrint}
          disabled={isGeneratingPdf}
          className={[
            'mt-6 inline-flex w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-black transition',
            isDarkTheme
              ? 'bg-sky-500 text-slate-950 hover:bg-sky-400'
              : 'bg-sky-500 text-white shadow-[0_18px_32px_rgba(14,165,233,0.24)] hover:bg-sky-600',
            isGeneratingPdf ? 'cursor-wait opacity-90' : '',
          ].join(' ')}
        >
          {isGeneratingPdf ? 'Generando PDF...' : 'Imprimir PDF'}
        </button>
      </aside>

      <div className="min-w-0 flex-1 lg:min-h-[calc(100dvh-3rem)]">
        <div className="mb-3 flex items-center justify-between print:hidden">
          <p className="text-sm font-black uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
            Vista previa
          </p>
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              aria-label="Reducir vista previa"
              className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-white/5 dark:hover:text-zinc-300"
              onClick={() => setPreviewZoom((current) => Math.max(0.7, Number((current - 0.08).toFixed(2))))}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
            <span className={['min-w-[3rem] text-center text-xs font-black tracking-[0.05em]', isDarkTheme ? 'text-zinc-400' : 'text-zinc-500'].join(' ')}>
              {zoomLabel}
            </span>
            <button
              type="button"
              aria-label="Ampliar vista previa"
              className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-white/5 dark:hover:text-zinc-300"
              onClick={() => setPreviewZoom((current) => Math.min(1.35, Number((current + 0.08).toFixed(2))))}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        <section id="vista-previa-impresion" className="w-full min-w-0 print:mx-0 print:max-w-none">
          <ChordProPreview
            chordProText={transposedChordProText}
            title={title}
            artist={artist}
            metadata={previewMetadata}
            sheetOptions={sheetOptions}
            zoomMultiplier={previewZoom}
            className="w-full min-h-[26rem] sm:min-h-[32rem] lg:h-[calc(100dvh-5.9rem)] xl:h-[calc(100dvh-5.5rem)]"
          />
        </section>
      </div>
    </div>
  );
}
