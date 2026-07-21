import { useEffect, useState } from 'react';

const readResponse = async (response) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || 'No se pudo completar la operacion.');
  }
  return payload;
};

export default function GoogleCalendarConnection() {
  const [status, setStatus] = useState({ loading: true, connected: false, needsAttention: false });
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState('');

  const loadStatus = async () => {
    try {
      const response = await fetch('/api/calendar/google/status', {
        credentials: 'same-origin',
        headers: { 'cache-control': 'no-store' },
      });
      const payload = await readResponse(response);
      setStatus({
        loading: false,
        connected: Boolean(payload.connected),
        needsAttention: Boolean(payload.needsAttention),
        lastSyncAt: payload.lastSyncAt || null,
      });
    } catch (error) {
      console.error('Google Calendar status error:', error);
      setStatus({ loading: false, connected: false, needsAttention: false, unavailable: true });
    }
  };

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const result = query.get('calendar');
    if (result === 'connected') setFeedback('Calendario conectado.');
    if (result === 'partial') setFeedback('Calendario conectado.');
    if (result === 'error') setFeedback('No se pudo conectar.');
    loadStatus();

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') loadStatus();
    };
    window.addEventListener('focus', loadStatus);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', loadStatus);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  const connect = async () => {
    setBusy('connect');
    setFeedback('');
    try {
      const response = await fetch('/api/calendar/google/connect?return_to=/perfil', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      const payload = await readResponse(response);
      if (!payload?.authorizationUrl) throw new Error('No se pudo abrir el calendario.');
      window.location.assign(payload.authorizationUrl);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'No se pudo abrir el calendario.');
      setBusy('');
    }
  };

  const syncNow = async () => {
    setBusy('sync');
    setFeedback('');
    try {
      const response = await fetch('/api/calendar/google/sync', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const payload = await readResponse(response);
      const changed = Number(payload.synced || 0) + Number(payload.removed || 0);
      setFeedback(changed > 0 ? 'Calendario actualizado.' : 'Tu calendario ya estaba al dia.');
      await loadStatus();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'No se pudo sincronizar el calendario.');
    } finally {
      setBusy('');
    }
  };

  const disconnect = async () => {
    const confirmed = window.confirm(
      '¿Desconectar Google Calendar? Los eventos que ya estan en tu calendario no se borraran, pero dejaran de actualizarse.',
    );
    if (!confirmed) return;

    setBusy('disconnect');
    setFeedback('');
    try {
      const response = await fetch('/api/calendar/google/disconnect', {
        method: 'POST',
        credentials: 'same-origin',
      });
      await readResponse(response);
      setStatus({ loading: false, connected: false, needsAttention: false });
      setFeedback('Google Calendar fue desconectado.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'No se pudo desconectar el calendario.');
    } finally {
      setBusy('');
    }
  };

  const connected = status.connected;
  const unavailable = status.unavailable;

  return (
    <section className="mt-8" aria-label="Calendario">
      <div className="flex min-h-14 items-center rounded-2xl border border-border bg-surface p-2 shadow-sm">
        <button
          type="button"
          onClick={connected ? syncNow : connect}
          disabled={Boolean(busy) || status.loading || unavailable}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 text-left transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action/60 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${connected ? 'bg-emerald-500/10 text-emerald-500' : 'bg-action/10 text-action'}`} aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="4" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
              <path d="m9 16 2 2 4-4" />
            </svg>
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-content">
            {status.loading
              ? 'Calendario'
              : connected
                ? busy === 'sync' ? 'Sincronizando…' : 'Calendario conectado'
                : busy === 'connect' ? 'Abriendo…' : 'Conectar calendario'}
          </span>
          {!status.loading && !unavailable && !connected && (
            <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-content-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m9 18 6-6-6-6" />
            </svg>
          )}
        </button>

        {connected && (
          <button
            type="button"
            onClick={disconnect}
            disabled={Boolean(busy)}
            aria-label="Desconectar calendario"
            title="Desconectar calendario"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-content-muted transition-colors hover:bg-red-500/10 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 disabled:opacity-50"
          >
            <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {status.needsAttention && (
        <p className="mt-2 px-2 text-xs font-semibold leading-5 text-amber-600" role="status">
          Vuelve a conectar el calendario.
        </p>
      )}
      {unavailable && (
        <p className="mt-2 px-2 text-xs font-semibold leading-5 text-content-muted" role="status">
          Calendario no disponible.
        </p>
      )}
      {feedback && (
        <p className="mt-2 px-2 text-xs font-semibold leading-5 text-content-muted" role="status" aria-live="polite">
          {feedback}
        </p>
      )}
    </section>
  );
}
