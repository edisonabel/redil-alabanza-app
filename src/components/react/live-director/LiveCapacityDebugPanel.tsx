import { useEffect, useState } from 'react';
import {
  copyLiveCapacityDiagnostics,
  downloadLiveCapacityDiagnostics,
  ensureLiveCapacityDiagnostics,
  flushLiveCapacityDiagnostics,
  isLiveCapacityDiagnosticsEnabled,
  readLiveCapacitySummary,
  recordLiveCapacityDiagnostic,
  type CapacitySummary,
} from '../../../utils/liveCapacityDiagnostics';

type LiveCapacityDebugPanelProps = {
  songId?: string;
  songTitle?: string;
  trackCount: number;
  mode: string;
};

const EMPTY_SUMMARY: CapacitySummary = {
  enabled: false,
  sessionId: '',
  elapsedSeconds: 0,
  entryCount: 0,
  criticalCount: 0,
  lastEventLoopLagMs: 0,
  maxEventLoopLagMs: 0,
  remoteStatus: 'idle',
  lastRemoteAt: '',
};

const formatElapsed = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, '0')}`;
};

export function LiveCapacityDebugPanel({
  songId = '',
  songTitle = '',
  trackCount,
  mode,
}: LiveCapacityDebugPanelProps) {
  const [enabled] = useState(() => isLiveCapacityDiagnosticsEnabled());
  const [summary, setSummary] = useState<CapacitySummary>(EMPTY_SUMMARY);
  const [feedback, setFeedback] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;

    ensureLiveCapacityDiagnostics({
      route: window.location.pathname,
      songId: songId || null,
      songTitle: songTitle || null,
      trackCount,
      mode,
    });
    recordLiveCapacityDiagnostic('diagnostic-view-context', {
      songId: songId || null,
      songTitle: songTitle || null,
      trackCount,
      mode,
    });

    const refresh = () => setSummary(readLiveCapacitySummary());
    refresh();
    window.addEventListener('live-capacity-diagnostics:update', refresh);
    const timer = window.setInterval(refresh, 2_000);
    return () => {
      window.removeEventListener('live-capacity-diagnostics:update', refresh);
      window.clearInterval(timer);
    };
  }, [enabled, mode, songId, songTitle, trackCount]);

  if (!enabled) return null;

  const showFeedback = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(''), 2_000);
  };

  const markAudioLoss = () => {
    recordLiveCapacityDiagnostic('user-marked-audio-loss', {
      songId: songId || null,
      songTitle: songTitle || null,
      trackCount,
      visible: document.visibilityState,
    }, 'warn');
    showFeedback('FALLA MARCADA');
  };

  return (
    <aside className="fixed bottom-3 left-3 z-[120] max-w-[calc(100vw-1.5rem)] rounded-xl border border-cyan-300/35 bg-[#071116]/95 px-3 py-2 text-cyan-50 shadow-[0_10px_28px_rgba(0,0,0,0.5)]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="rounded-md border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-[10px] font-black tracking-[0.16em] text-cyan-100"
        >
          CAP DEBUG
        </button>
        <span className="max-w-[10rem] truncate font-mono text-[9px] text-cyan-100/70">
          {summary.sessionId || 'INICIANDO'}
        </span>
        <span className="font-mono text-[9px] text-white/60">{formatElapsed(summary.elapsedSeconds)}</span>
        {summary.criticalCount > 0 && (
          <span className="rounded bg-rose-400/20 px-1.5 py-0.5 text-[9px] font-black text-rose-200">
            {summary.criticalCount} ALERTA{summary.criticalCount === 1 ? '' : 'S'}
          </span>
        )}
      </div>

      {!collapsed && (
        <>
          <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[9px] text-white/65">
            <span>LOG {summary.entryCount}</span>
            <span>LAG {summary.lastEventLoopLagMs}ms</span>
            <span>MAX {summary.maxEventLoopLagMs}ms</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={markAudioLoss}
              className="rounded-md border border-rose-300/35 bg-rose-400/15 px-2.5 py-1.5 text-[10px] font-black tracking-[0.1em] text-rose-100"
            >
              MARCAR FALLA
            </button>
            <button
              type="button"
              onClick={() => {
                void copyLiveCapacityDiagnostics().then((copied) => {
                  if (!copied) {
                    downloadLiveCapacityDiagnostics();
                    showFeedback('JSON DESCARGADO');
                    return;
                  }
                  showFeedback('LOG COPIADO');
                });
              }}
              className="rounded-md border border-white/15 bg-white/8 px-2 py-1.5 text-[10px] font-bold text-white/80"
            >
              COPIAR
            </button>
            <button
              type="button"
              onClick={() => {
                void flushLiveCapacityDiagnostics().then(() => showFeedback('LOG ENVIADO'));
              }}
              className="rounded-md border border-white/15 bg-white/8 px-2 py-1.5 text-[10px] font-bold text-white/80"
            >
              ENVIAR
            </button>
          </div>
          {feedback && <p className="mt-1.5 text-[9px] font-black tracking-[0.12em] text-emerald-300">{feedback}</p>}
        </>
      )}
    </aside>
  );
}
