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
    if (result === 'connected') setFeedback('Google Calendar quedo conectado y tus asignaciones futuras se sincronizaron.');
    if (result === 'partial') setFeedback('Google Calendar quedo conectado. Algunas asignaciones se reintentaran al actualizarse.');
    if (result === 'error') setFeedback('No se pudo completar la conexion con Google Calendar. Intenta de nuevo.');
    loadStatus();
  }, []);

  const connect = () => {
    window.location.assign('/api/calendar/google/connect?return_to=/perfil');
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
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6" aria-labelledby="calendar-connection-title">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${connected ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600' : 'border-blue-500/20 bg-blue-500/10 text-blue-600'}`} aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="4" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
              <path d="m9 16 2 2 4-4" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="calendar-connection-title" className="text-lg font-bold text-content">Calendario personal</h3>
              {!status.loading && !unavailable && (
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${connected ? 'bg-emerald-500/10 text-emerald-600' : 'bg-neutral/10 text-content-muted'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-content-muted/60'}`} />
                  {connected ? 'Conectado' : 'Sin conectar'}
                </span>
              )}
            </div>
            <p className="mt-1.5 max-w-xl text-sm leading-6 text-content-muted">
              {connected
                ? 'Tus asignaciones se agregan y se mantienen actualizadas automaticamente en Google Calendar.'
                : 'Agrega tus asignaciones a Google Calendar sin descargar archivos.'}
            </p>
            <p className="mt-2 text-xs leading-5 text-content-muted">
              En iPhone y Mac tambien apareceran en Apple Calendar si esa cuenta de Google esta activada en Calendarios.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 sm:max-w-[220px] sm:justify-end">
          {status.loading ? (
            <button type="button" disabled className="min-h-11 rounded-xl border border-border bg-background px-4 py-2 text-sm font-bold text-content-muted opacity-70">
              Comprobando…
            </button>
          ) : !connected ? (
            <button
              type="button"
              onClick={connect}
              disabled={busy || unavailable}
              className="min-h-11 rounded-xl bg-action px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-action/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action/60 disabled:cursor-not-allowed disabled:opacity-55"
            >
              Conectar Google
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={syncNow}
                disabled={Boolean(busy)}
                className="min-h-11 rounded-xl border border-border bg-background px-3.5 py-2 text-sm font-bold text-content transition-colors hover:border-action/35 hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action/60 disabled:opacity-55"
              >
                {busy === 'sync' ? 'Sincronizando…' : 'Sincronizar'}
              </button>
              <button
                type="button"
                onClick={disconnect}
                disabled={Boolean(busy)}
                className="min-h-11 rounded-xl px-3 py-2 text-sm font-bold text-content-muted transition-colors hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 disabled:opacity-55"
              >
                {busy === 'disconnect' ? 'Desconectando…' : 'Desconectar'}
              </button>
            </>
          )}
        </div>
      </div>

      {status.needsAttention && (
        <p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-3 text-xs font-semibold leading-5 text-amber-700" role="status">
          Google necesita renovar la conexion. Pulsa Sincronizar; si persiste, desconecta y vuelve a conectar.
        </p>
      )}
      {unavailable && (
        <p className="mt-4 rounded-xl border border-border bg-background px-3.5 py-3 text-xs font-semibold leading-5 text-content-muted" role="status">
          La conexion de calendario estara disponible cuando termine la configuracion del servidor.
        </p>
      )}
      {feedback && (
        <p className="mt-4 text-xs font-semibold leading-5 text-content-muted" role="status" aria-live="polite">
          {feedback}
        </p>
      )}
    </section>
  );
}
