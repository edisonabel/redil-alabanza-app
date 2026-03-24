import React, { useMemo, useState } from 'react';

const initialForm = {
  title: '',
  body: '',
  url: '',
};

export default function PanelAdminPush({ isAdmin = false }) {
  const [form, setForm] = useState(initialForm);
  const [isSending, setIsSending] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const canSubmit = useMemo(() => {
    return Boolean(form.title.trim() && form.body.trim() && !isSending);
  }, [form.title, form.body, isSending]);

  if (!isAdmin) {
    return null;
  }

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSending(true);
    setFeedback(null);

    try {
      const response = await fetch('/api/send-push', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          title: form.title.trim(),
          body: form.body.trim(),
          url: form.url.trim() || undefined,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        setFeedback({
          type: 'error',
          title: 'No se pudo enviar',
          message: result?.error || 'El motor de alertas respondio con un error.',
        });
        return;
      }

      setFeedback({
        type: 'success',
        title: 'Alerta enviada',
        message: `Se procesaron ${result?.recipients ?? 0} destinatarios entre campanita, correo y push.`,
        meta: result,
      });
      setForm(initialForm);
    } catch (error) {
      console.error('Admin push panel: error enviando push', error);
      setFeedback({
        type: 'error',
        title: 'Error de red',
        message: 'No fue posible contactar el motor de notificaciones.',
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <section className="mt-8 rounded-[1.75rem] border border-border bg-surface p-6 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-content-muted">
            Alertas del Equipo
          </p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-content">
            Centro de alertas multicanal
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-content-muted">
            Envia una alerta y el sistema la reparte por campanita interna, correo y push a quienes tengan el canal activo.
          </p>
        </div>

        <div className="inline-flex items-center gap-2 rounded-2xl border border-action/25 bg-action/10 px-3 py-2 text-xs font-semibold text-action">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-action" aria-hidden="true"></span>
          Envio multicanal habilitado
        </div>
      </div>

      <form className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_0.9fr]" onSubmit={handleSubmit}>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-content-muted">
              Titulo
            </span>
            <input
              type="text"
              name="title"
              value={form.title}
              onChange={handleChange}
              placeholder="Ensayo este jueves"
              className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm text-content outline-none transition focus:border-action focus:ring-2 focus:ring-action/15"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-content-muted">
              Mensaje
            </span>
            <textarea
              name="body"
              value={form.body}
              onChange={handleChange}
              placeholder="Musicos, recuerden traer sus partituras y llegar con tiempo."
              rows={5}
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm leading-relaxed text-content outline-none transition focus:border-action focus:ring-2 focus:ring-action/15 resize-none"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-content-muted">
              URL de destino <span className="normal-case tracking-normal font-medium">(opcional)</span>
            </span>
            <input
              type="text"
              name="url"
              value={form.url}
              onChange={handleChange}
              placeholder="/ensayos"
              className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm text-content outline-none transition focus:border-action focus:ring-2 focus:ring-action/15"
            />
          </label>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-border bg-background/70 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-action/10 text-action">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 19v3" />
                  <path d="M18 15a6 6 0 0 0-12 0" />
                  <path d="M15 10a3 3 0 1 0-6 0" />
                  <path d="M19 21a7 7 0 0 0-14 0" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-content">Resumen del envio</p>
                <p className="text-xs text-content-muted">
                  Se crea la alerta interna y luego se intenta entregar por correo y push usando la misma base de destinatarios.
                </p>
              </div>
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-action/40 bg-action px-5 text-sm font-bold text-white shadow-[0_18px_35px_rgba(0,0,0,0.14)] transition hover:bg-action/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSending ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true"></span>
                  Enviando...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m22 2-7 20-4-9-9-4Z" />
                    <path d="M22 2 11 13" />
                  </svg>
                  Enviar Alerta al Equipo
                </>
              )}
            </button>
          </div>

          <div
            className={`rounded-2xl border p-4 ${
              feedback?.type === 'error'
                ? 'border-danger/25 bg-danger/10'
                : feedback
                  ? 'border-success/25 bg-success/10'
                  : 'border-border bg-background/70'
            }`}
          >
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-content-muted">
              Reporte
            </p>

            {feedback ? (
              <div className="mt-3 space-y-2">
                <p className="text-sm font-bold text-content">{feedback.title}</p>
                <p className="text-sm leading-relaxed text-content-muted">{feedback.message}</p>

                {feedback.meta && (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-content-muted">
                    <div className="rounded-xl border border-border bg-surface px-3 py-2">
                      Internas: <span className="text-content">{feedback.meta.inApp?.inserted ?? 0}</span>
                    </div>
                    <div className="rounded-xl border border-border bg-surface px-3 py-2">
                      Correos: <span className="text-content">{feedback.meta.email?.sent ?? 0}</span>
                    </div>
                    <div className="rounded-xl border border-border bg-surface px-3 py-2">
                      Push: <span className="text-content">{feedback.meta.push?.sent ?? 0}</span>
                    </div>
                    <div className="rounded-xl border border-border bg-surface px-3 py-2">
                      Destinatarios: <span className="text-content">{feedback.meta.recipients ?? 0}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-relaxed text-content-muted">
                Aqui veras cuantos recibieron campanita, correo y push cuando el motor termine de procesar la alerta.
              </p>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
