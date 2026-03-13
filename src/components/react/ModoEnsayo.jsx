import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Minus, Pause, Play, Plus, Type } from 'lucide-react';

const MOCK_CANCION_ENSAYO = {
  id: 'demo',
  title: 'Grande y Fuerte',
  artist: 'Miel San Marcos',
  key: 'Sol',
  bpm: 76,
  duration: 298,
  sections: [
    {
      name: 'Intro',
      lines: [
        '[G]Oh oh oh [D/F#]oh oh [Em]oh [C]',
        '[G]Oh oh oh [D/F#]oh oh [Em]oh [C]',
      ],
    },
    {
      name: 'Verso 1',
      lines: [
        '[G]Tu voz resuena [D/F#]fuerte en la mañana',
        '[C]Tu gloria llena todo [G]mi interior',
        '[G]Mi fe despierta [D/F#]cuando Tú me llamas',
        '[C]Y canta el pueblo al [D]Rey de amor',
      ],
    },
    {
      name: 'Coro',
      lines: [
        '[G]Grande y fuerte [D]es nuestro Dios',
        '[Em]Digno por siempre [C]de adoración',
        '[G]Toda la tierra [D]cantará',
        '[Em]Cristo es mi roca, [C]mi salvación',
      ],
    },
    {
      name: 'Puente',
      lines: [
        '[Em]No hay otro nombre [C]como el de Jesús',
        '[G]Luz en la noche, [D]esperanza y virtud',
      ],
    },
  ],
};

const FONT_PRESETS = {
  compacta: {
    section: 'text-[0.72rem] sm:text-xs tracking-[0.28em]',
    chord: 'text-[0.82rem] sm:text-[0.9rem]',
    lyric: 'text-[1rem] sm:text-[1.08rem]',
    line: 'gap-y-0.5',
  },
  normal: {
    section: 'text-xs sm:text-sm tracking-[0.3em]',
    chord: 'text-[0.92rem] sm:text-[1rem]',
    lyric: 'text-[1.12rem] sm:text-[1.24rem]',
    line: 'gap-y-1',
  },
  grande: {
    section: 'text-sm sm:text-base tracking-[0.32em]',
    chord: 'text-[1.02rem] sm:text-[1.1rem]',
    lyric: 'text-[1.28rem] sm:text-[1.46rem]',
    line: 'gap-y-1.5',
  },
};

const formatSeconds = (value) => {
  const total = Math.max(0, Math.floor(value));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const parseChordProLine = (line) => {
  if (!line) return [];

  const segments = [];
  const regex = /\[([^\]]+)\]/g;
  let currentChord = '';
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(line)) !== null) {
    const lyric = line.slice(lastIndex, match.index);
    if (lyric || currentChord) {
      segments.push({ chord: currentChord, lyric });
    }
    currentChord = match[1].trim();
    lastIndex = match.index + match[0].length;
  }

  const tail = line.slice(lastIndex);
  if (tail || currentChord) {
    segments.push({ chord: currentChord, lyric: tail });
  }

  return segments.length > 0 ? segments : [{ chord: '', lyric: line }];
};

const buildChordOverlayLine = (line) => {
  const segments = parseChordProLine(line);
  if (!segments.length) {
    return { mode: 'plain', text: line || '' };
  }

  const hasChord = segments.some((segment) => segment.chord);
  const lyricLine = segments.map((segment) => segment.lyric || '').join('');
  const hasVisibleLyric = lyricLine.trim().length > 0;

  if (!hasChord) {
    return { mode: 'plain', text: lyricLine || line || '' };
  }

  if (!hasVisibleLyric) {
    return {
      mode: 'instrumental',
      chords: segments.map((segment) => segment.chord).filter(Boolean),
    };
  }

  return {
    mode: 'segments',
    segments,
  };
};

export default function ModoEnsayo({
  song = MOCK_CANCION_ENSAYO,
  songId = 'demo',
  playlist = [],
  contextTitle = '',
}) {
  const [headerHidden, setHeaderHidden] = useState(false);
  const [fontScale, setFontScale] = useState('normal');
  const [showViewSettings, setShowViewSettings] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(18);
  const [loopA, setLoopA] = useState(12);
  const [loopB, setLoopB] = useState(74);
  const [activeSongIndex, setActiveSongIndex] = useState(0);

  const scrollRef = useRef(null);
  const lastScrollTop = useRef(0);

  const availableSongs = useMemo(() => {
    if (Array.isArray(playlist) && playlist.length > 0) {
      return playlist.filter(Boolean);
    }

    return [song || MOCK_CANCION_ENSAYO].filter(Boolean);
  }, [playlist, song]);

  const currentSong = availableSongs[activeSongIndex] || availableSongs[0] || MOCK_CANCION_ENSAYO;

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return undefined;

    const handleScroll = () => {
      const currentTop = scroller.scrollTop;
      if (currentTop > lastScrollTop.current + 8 && currentTop > 32) {
        setHeaderHidden(true);
      } else if (currentTop < lastScrollTop.current - 8 || currentTop < 16) {
        setHeaderHidden(false);
      }
      lastScrollTop.current = currentTop;
    };

    scroller.addEventListener('scroll', handleScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const nextIndex = availableSongs.findIndex((item) => String(item?.id || '') === String(songId));
    setActiveSongIndex(nextIndex >= 0 ? nextIndex : 0);
  }, [availableSongs, songId]);

  useEffect(() => {
    const duration = Math.max(120, currentSong?.duration || 0);
    setIsPlaying(false);
    setProgress(Math.min(18, duration));
    setLoopA(Math.min(12, duration));
    setLoopB(Math.min(duration, 74));
  }, [currentSong]);

  useEffect(() => {
    if (!isPlaying) return undefined;

    const timer = window.setInterval(() => {
      setProgress((prev) => {
        const next = prev + 1;
        if (next >= loopB) return loopA;
        return next > currentSong.duration ? 0 : next;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [currentSong.duration, isPlaying, loopA, loopB]);

  const fontPreset = FONT_PRESETS[fontScale] || FONT_PRESETS.normal;

  const progressPercent = useMemo(() => {
    if (!currentSong.duration) return 0;
    return Math.min(100, Math.max(0, (progress / currentSong.duration) * 100));
  }, [currentSong.duration, progress]);

  const loopAPercent = useMemo(() => (loopA / Math.max(1, currentSong.duration)) * 100, [currentSong.duration, loopA]);
  const loopBPercent = useMemo(() => (loopB / Math.max(1, currentSong.duration)) * 100, [currentSong.duration, loopB]);

  const handleGoBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    window.location.href = '/repertorio';
  };

  const cycleFontScale = (direction) => {
    const order = ['compacta', 'normal', 'grande'];
    const currentIndex = order.indexOf(fontScale);
    const nextIndex = Math.min(order.length - 1, Math.max(0, currentIndex + direction));
    setFontScale(order[nextIndex]);
  };

  const markLoopPoint = (point) => {
    if (point === 'A') {
      setLoopA(progress >= loopB ? Math.max(0, loopB - 4) : progress);
      return;
    }

    setLoopB(progress <= loopA ? Math.min(currentSong.duration, loopA + 4) : progress);
  };

  return (
    <div className="h-screen w-full flex flex-col bg-white text-slate-950 dark:bg-gray-900 dark:text-white">
      <header
        className={`sticky top-0 z-30 border-b border-slate-200/70 bg-white/95 backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/92 transition-transform duration-300 ${
          headerHidden ? '-translate-y-full' : 'translate-y-0'
        }`}
      >
        <div className="flex items-start gap-3 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <button
            type="button"
            onClick={handleGoBack}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm transition-colors hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
            aria-label="Volver"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">
              {contextTitle || 'Modo Ensayo'}
            </p>
            <h1 className="truncate text-lg font-black tracking-tight sm:text-xl">{currentSong.title}</h1>
            <p className="truncate text-sm text-slate-600 dark:text-slate-300">
              {currentSong.artist} · {currentSong.key} · {currentSong.bpm || '-'} BPM
            </p>
          </div>

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowViewSettings((prev) => !prev)}
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm transition-colors hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
              aria-label="Ajustes de vista"
            >
              <Type className="h-5 w-5" />
            </button>

            {showViewSettings && (
              <div className="absolute right-0 mt-2 w-[164px] rounded-2xl border border-slate-200 bg-white/98 p-2 shadow-2xl dark:border-white/10 dark:bg-slate-950/95">
                <p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Tamaño
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => cycleFontScale(-1)}
                    className="flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white"
                    aria-label="Reducir texto"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <div className="flex h-10 items-center justify-center rounded-xl border border-brand/30 bg-brand/10 text-xs font-bold uppercase text-brand">
                    {fontScale}
                  </div>
                  <button
                    type="button"
                    onClick={() => cycleFontScale(1)}
                    className="flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white"
                    aria-label="Aumentar texto"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {availableSongs.length > 1 && (
          <div className="px-4 pb-3">
            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {availableSongs.map((playlistSong, index) => {
                const isActiveSong = index === activeSongIndex;
                return (
                  <button
                    key={playlistSong.id || `${playlistSong.title}-${index}`}
                    type="button"
                    onClick={() => setActiveSongIndex(index)}
                    className={`shrink-0 rounded-2xl border px-3 py-2 text-left transition-colors ${
                      isActiveSong
                        ? 'border-brand/40 bg-brand/12 text-brand shadow-sm'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10'
                    }`}
                  >
                    <p className="text-[11px] font-black uppercase tracking-[0.18em]">
                      {String(index + 1).padStart(2, '0')}
                    </p>
                    <p className="max-w-[12rem] truncate text-sm font-semibold">
                      {playlistSong.title}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      <main ref={scrollRef} className="flex-grow overflow-y-auto p-4 pb-32 sm:p-5 sm:pb-36">
        <div className="mx-auto columns-1 gap-4 md:max-w-6xl md:columns-2 md:gap-6">
          {currentSong.sections.map((section) => (
            <article
              key={`${currentSong.id || songId}-${section.name}`}
              className="mb-4 break-inside-avoid-column rounded-[1.75rem] border border-slate-200 bg-white/88 px-4 py-4 shadow-sm dark:border-white/10 dark:bg-white/5"
            >
              <h2 className={`mb-4 font-black uppercase text-brand ${fontPreset.section}`}>
                {section.name}
              </h2>

              <div className="space-y-3">
                {section.lines.map((line, lineIndex) => {
                  const renderedLine = buildChordOverlayLine(line);
                  return (
                    <div key={`${section.name}-${lineIndex}`} className={`grid ${fontPreset.line}`}>
                      {renderedLine.mode === 'plain' && (
                        <p className={`leading-tight text-slate-900 dark:text-white ${fontPreset.lyric}`}>
                          {renderedLine.text}
                        </p>
                      )}

                      {renderedLine.mode === 'instrumental' && (
                        <div className="flex flex-row flex-wrap gap-2">
                          {renderedLine.chords.map((chord, chordIndex) => (
                            <span
                              key={`${section.name}-${lineIndex}-chord-${chordIndex}`}
                              className={`font-black leading-none text-brand ${fontPreset.chord}`}
                            >
                              {chord}
                            </span>
                          ))}
                        </div>
                      )}

                      {renderedLine.mode === 'segments' && (
                        <div className="flex flex-wrap items-end gap-x-1.5 gap-y-1">
                          {renderedLine.segments.map((segment, segmentIndex) => (
                            <div key={`${section.name}-${lineIndex}-${segmentIndex}`} className="flex flex-col">
                              <span className={`font-black text-brand ${fontPreset.chord}`}>
                                {segment.chord || '\u00A0'}
                              </span>
                              <span className={`leading-tight text-slate-900 dark:text-white ${fontPreset.lyric}`}>
                                {segment.lyric || '\u00A0'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/96 pb-[calc(env(safe-area-inset-bottom)+0.7rem)] pt-3 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/94">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4">
          <button
            type="button"
            onClick={() => setIsPlaying((prev) => !prev)}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-action text-white shadow-lg transition-transform active:scale-95"
            aria-label={isPlaying ? 'Pausar ensayo' : 'Reproducir ensayo'}
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
          </button>

          <button
            type="button"
            onClick={() => markLoopPoint('A')}
            className={`h-9 w-9 shrink-0 rounded-xl border text-xs font-black transition-colors ${
              loopA > 0
                ? 'border-brand bg-brand/15 text-brand'
                : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'
            }`}
          >
            A
          </button>

          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              <span>{formatSeconds(progress)}</span>
              <span>{currentSong.key}</span>
              <span>{formatSeconds(currentSong.duration)}</span>
            </div>

            <div className="relative h-2.5 rounded-full bg-slate-200 dark:bg-white/10">
              <div className="absolute inset-y-0 left-0 rounded-full bg-action" style={{ width: `${progressPercent}%` }} />
              <div
                className="absolute top-1/2 h-4 w-1.5 -translate-y-1/2 rounded-full bg-brand"
                style={{ left: `${loopAPercent}%` }}
              />
              <div
                className="absolute top-1/2 h-4 w-1.5 -translate-y-1/2 rounded-full bg-brand"
                style={{ left: `${loopBPercent}%` }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => markLoopPoint('B')}
            className={`h-9 w-9 shrink-0 rounded-xl border text-xs font-black transition-colors ${
              loopB < currentSong.duration
                ? 'border-brand bg-brand/15 text-brand'
                : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'
            }`}
          >
            B
          </button>
        </div>
      </div>
    </div>
  );
}
