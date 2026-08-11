import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Link2,
  Mail,
  RotateCcw,
  Send,
  Smartphone,
} from 'lucide-react';

const initialForm = {
  title: '',
  body: '',
  url: '',
  mode: 'multicanal',
};

const WIZARD_STEPS = [
  { label: 'Contenido', description: 'Escribe la alerta' },
  { label: 'Canales', description: 'Elige cómo enviarla' },
  { label: 'Revisar', description: 'Confirma el envío' },
];

const DELIVERY_MODES = [
  {
    value: 'multicanal',
    label: 'Multicanal',
    description: 'Campanita, correo y push',
    badge: '3 canales',
    icon: Bell,
  },
  {
    value: 'in_app',
    label: 'Campanita',
    description: 'Solo dentro de la aplicación',
    badge: '1 canal',
    icon: Bell,
  },
  {
    value: 'email',
    label: 'Correo',
    description: 'Solo correo electrónico',
    badge: '1 canal',
    icon: Mail,
  },
  {
    value: 'push',
    label: 'Push',
    description: 'Solo dispositivos suscritos',
    badge: '1 canal',
    icon: Smartphone,
  },
];

const isValidDestination = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return true;
  if (normalized.startsWith('/') && !normalized.startsWith('//')) return true;

  try {
    const parsed = new URL(normalized);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
};

const channelMetric = (label, value, tone = 'neutral') => (
  <div
    className={`rounded-2xl border px-3 py-3 ${
      tone === 'success'
        ? 'border-success/25 bg-success/10'
        : tone === 'warning'
          ? 'border-amber-500/25 bg-amber-500/10'
          : 'border-border bg-background/70'
    }`}
  >
    <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-content-muted">{label}</p>
    <p className="mt-1 text-lg font-black text-content">{value}</p>
  </div>
);

export default function PanelAdminPush({ isAdmin = false }) {
  const [form, setForm] = useState(initialForm);
  const [currentStep, setCurrentStep] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [completed, setCompleted] = useState(false);
  const sectionRef = useRef(null);
  const panelHeadingRef = useRef(null);

  const selectedMode = useMemo(
    () => DELIVERY_MODES.find((option) => option.value === form.mode) || DELIVERY_MODES[0],
    [form.mode],
  );
  const destinationIsValid = useMemo(() => isValidDestination(form.url), [form.url]);
  const contentIsReady = Boolean(
    form.title.trim() && form.body.trim() && destinationIsValid,
  );
  const canSubmit = contentIsReady && !isSending && !completed;

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const section = sectionRef.current;
    const settingsPanel = section?.closest('.settings-wizard-step');

    if (window.matchMedia('(max-width: 639px)').matches) {
      section?.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    } else {
      settingsPanel?.scrollTo({
        top: 0,
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      });
    }

    panelHeadingRef.current?.focus({ preventScroll: true });
  }, [currentStep]);

  if (!isAdmin) return null;

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
    if (feedback) setFeedback(null);
  };

  const goToStep = (nextStep) => {
    if (nextStep > 0 && !contentIsReady) return;
    setCurrentStep(Math.max(0, Math.min(WIZARD_STEPS.length - 1, nextStep)));
  };

  const resetWizard = () => {
    setForm(initialForm);
    setFeedback(null);
    setCompleted(false);
    setCurrentStep(0);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (currentStep !== 2 || !canSubmit) return;

    setIsSending(true);
    setFeedback(null);

    try {
      const response = await fetch('/api/send-push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          title: form.title.trim(),
          body: form.body.trim(),
          url: form.url.trim() || undefined,
          mode: form.mode,
        }),
      });

      const result = await response.json().catch(() => null);
      const hasChannelReport = Boolean(result?.inApp || result?.email || result?.push);

      if (!response.ok) {
        setFeedback({
          type: 'error',
          title: 'No se pudo completar',
          message: result?.error || 'El motor de alertas respondió con un error.',
          meta: hasChannelReport ? result : null,
        });
        return;
      }

      const isPartial = Boolean(result?.partial || result?.ok === false);
      setFeedback({
        type: isPartial ? 'warning' : 'success',
        title: isPartial ? 'Envío parcial' : 'Alerta procesada',
        message: isPartial
          ? 'Algunos canales no terminaron. Revisa el reporte antes de crear otra alerta.'
          : `Se procesaron ${result?.recipients ?? 0} destinatarios en modo ${selectedMode.label.toLowerCase()}.`,
        meta: result,
      });
      setCompleted(true);
    } catch (error) {
      console.error('Admin push panel: error enviando alerta', error);
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
    <section ref={sectionRef} className="scroll-mt-20 space-y-5" aria-labelledby="admin-alerts-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-content-muted">Alertas del equipo</p>
          <h2 id="admin-alerts-title" className="mt-1 text-2xl font-black tracking-tight text-content">
            Preparar alerta
          </h2>
        </div>
        <span className="rounded-full border border-action/25 bg-action/10 px-3 py-1.5 text-xs font-bold text-action">
          {selectedMode.badge}
        </span>
      </div>

      <nav className="grid grid-cols-3 gap-2" aria-label="Pasos para crear la alerta">
        {WIZARD_STEPS.map((step, index) => {
          const isActive = currentStep === index;
          const isAvailable = index === 0 || contentIsReady;
          const isDone = currentStep > index || (completed && index === 2);

          return (
            <button
              key={step.label}
              type="button"
              aria-current={isActive ? 'step' : undefined}
              disabled={!isAvailable || isSending}
              onClick={() => goToStep(index)}
              className={`group flex min-w-0 items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                isActive
                  ? 'border-action/40 bg-action/10 text-content shadow-[0_12px_26px_rgba(0,0,0,0.08)]'
                  : 'border-border bg-surface/55 text-content-muted hover:border-action/25'
              } disabled:cursor-not-allowed disabled:opacity-45`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-black ${
                  isActive || isDone ? 'bg-action text-white' : 'bg-background text-content-muted'
                }`}
                aria-hidden="true"
              >
                {isDone ? <Check className="h-4 w-4" /> : index + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-black">{step.label}</span>
                <span className="hidden truncate text-[0.68rem] font-medium text-content-muted sm:block">
                  {step.description}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      <form
        onSubmit={handleSubmit}
        className="rounded-[1.65rem] border border-border bg-surface/88 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.08)] md:p-6"
        noValidate
      >
        <div
          role="region"
          aria-labelledby={`admin-alert-step-heading-${currentStep}`}
        >
          <h3
            id={`admin-alert-step-heading-${currentStep}`}
            ref={panelHeadingRef}
            tabIndex={-1}
            className="sr-only"
          >
            {WIZARD_STEPS[currentStep].label}
          </h3>

          {currentStep === 0 && (
            <div className="grid gap-4 lg:grid-cols-[0.78fr_1.22fr]">
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-content-muted">
                    Título
                  </span>
                  <input
                    type="text"
                    name="title"
                    value={form.title}
                    onChange={handleChange}
                    maxLength={120}
                    placeholder="Ensayo este jueves"
                    className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm text-content outline-none transition focus:border-action focus:ring-2 focus:ring-action/15"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 flex items-center justify-between gap-3 text-xs font-black uppercase tracking-[0.16em] text-content-muted">
                    <span>Enlace <span className="normal-case tracking-normal">(opcional)</span></span>
                    <Link2 className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <input
                    type="text"
                    inputMode="url"
                    name="url"
                    value={form.url}
                    onChange={handleChange}
                    maxLength={2048}
                    placeholder="/programacion"
                    aria-invalid={!destinationIsValid}
                    aria-describedby={!destinationIsValid ? 'admin-alert-url-error' : undefined}
                    className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm text-content outline-none transition focus:border-action focus:ring-2 focus:ring-action/15"
                  />
                  {!destinationIsValid && (
                    <span id="admin-alert-url-error" className="mt-2 block text-xs font-semibold text-danger">
                      Usa una ruta interna o una URL http/https.
                    </span>
                  )}
                </label>
              </div>

              <label className="block">
                <span className="mb-2 flex items-center justify-between gap-3 text-xs font-black uppercase tracking-[0.16em] text-content-muted">
                  <span>Mensaje</span>
                  <span className="normal-case tracking-normal">{form.body.length}/1200</span>
                </span>
                <textarea
                  name="body"
                  value={form.body}
                  onChange={handleChange}
                  maxLength={1200}
                  placeholder="Músicos, recuerden traer sus partituras y llegar con tiempo."
                  rows={7}
                  className="min-h-48 w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm leading-relaxed text-content outline-none transition focus:border-action focus:ring-2 focus:ring-action/15"
                />
              </label>
            </div>
          )}

          {currentStep === 1 && (
            <fieldset>
              <legend className="text-lg font-black tracking-tight text-content">Canal de envío</legend>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {DELIVERY_MODES.map((option) => {
                  const Icon = option.icon;
                  const isSelected = form.mode === option.value;
                  return (
                    <label
                      key={option.value}
                      className={`flex cursor-pointer items-center gap-4 rounded-2xl border p-4 transition ${
                        isSelected
                          ? 'border-action bg-action/10 shadow-[0_14px_28px_rgba(0,0,0,0.08)]'
                          : 'border-border bg-background/70 hover:border-action/35'
                      }`}
                    >
                      <input
                        type="radio"
                        name="mode"
                        value={option.value}
                        checked={isSelected}
                        onChange={handleChange}
                        className="sr-only"
                      />
                      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                        isSelected ? 'bg-action text-white' : 'bg-surface text-content-muted'
                      }`}>
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-black text-content">{option.label}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-content-muted">{option.description}</span>
                      </span>
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                        isSelected ? 'border-action bg-action text-white' : 'border-border text-transparent'
                      }`} aria-hidden="true">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {currentStep === 2 && !completed && (
            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-2xl border border-border bg-background/70 p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-action/10 text-action">
                    <Bell className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-lg font-black leading-tight text-content">{form.title.trim()}</p>
                    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-content-muted">{form.body.trim()}</p>
                    {form.url.trim() && (
                      <p className="mt-3 truncate text-xs font-bold text-action">{form.url.trim()}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col justify-between gap-5 rounded-2xl border border-action/25 bg-action/10 p-5">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-content-muted">Envío</p>
                  <p className="mt-2 text-xl font-black text-content">{selectedMode.label}</p>
                  <p className="mt-1 text-sm text-content-muted">{selectedMode.description}</p>
                </div>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-action/40 bg-action px-5 text-sm font-black text-white shadow-[0_16px_32px_rgba(0,0,0,0.14)] transition hover:bg-action/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSending ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
                      Enviando…
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" aria-hidden="true" />
                      Enviar alerta
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {currentStep === 2 && completed && feedback?.meta && (
            <div className="space-y-4" role="status" aria-live="polite">
              <div className={`rounded-2xl border p-5 ${
                feedback.type === 'warning'
                  ? 'border-amber-500/25 bg-amber-500/10'
                  : 'border-success/25 bg-success/10'
              }`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-black text-content">{feedback.title}</p>
                    <p className="mt-1 text-sm text-content-muted">{feedback.message}</p>
                  </div>
                  <button
                    type="button"
                    onClick={resetWizard}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-bold text-content transition hover:border-action/35"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Nueva alerta
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {channelMetric('Campanita', feedback.meta.inApp?.inserted ?? 0, 'success')}
                {channelMetric('Correos', feedback.meta.email?.sent ?? 0, 'success')}
                {channelMetric('Push', feedback.meta.push?.sent ?? 0, 'success')}
                {channelMetric('Destinatarios', feedback.meta.recipients ?? 0)}
              </div>
            </div>
          )}

          {currentStep === 2 && !completed && feedback && (
            <div
              className="mt-4 rounded-2xl border border-danger/25 bg-danger/10 p-4"
              role="alert"
              aria-live="assertive"
            >
              <p className="text-sm font-black text-content">{feedback.title}</p>
              <p className="mt-1 text-sm text-content-muted">{feedback.message}</p>
            </div>
          )}
        </div>

        {!completed && (
          <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-5">
            <button
              type="button"
              onClick={() => goToStep(currentStep - 1)}
              disabled={currentStep === 0 || isSending}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-bold text-content transition hover:border-action/35 disabled:pointer-events-none disabled:opacity-0"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Atrás
            </button>

            {currentStep < 2 && (
              <button
                type="button"
                onClick={() => goToStep(currentStep + 1)}
                disabled={!contentIsReady}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-action px-5 text-sm font-black text-white transition hover:bg-action/90 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {currentStep === 0 ? 'Elegir canales' : 'Revisar alerta'}
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
