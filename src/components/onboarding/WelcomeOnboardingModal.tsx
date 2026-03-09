import React, { useEffect, useRef } from 'react';

type WelcomeOnboardingModalProps = {
  open: boolean;
  title: string;
  body: string;
  secondary: string;
  onClose: () => void;
  onExplore: () => void;
  onStart: () => void;
};

export default function WelcomeOnboardingModal({
  open,
  title,
  body,
  secondary,
  onClose,
  onExplore,
  onStart,
}: WelcomeOnboardingModalProps) {
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const frame = window.requestAnimationFrame(() => {
      primaryButtonRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute('disabled'));

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Cerrar bienvenida"
        className="absolute inset-0 bg-overlay/70 backdrop-blur-[6px]"
        onClick={onClose}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-welcome-title"
        className="relative w-full max-w-[28rem] rounded-[2rem] border border-border bg-surface px-5 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:px-6 sm:py-6 animate-[onboardingModalIn_220ms_cubic-bezier(0.2,0.8,0.2,1)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-brand/20 bg-brand/10 text-brand shadow-sm">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-content-muted">
                Primer ingreso
              </p>
              <h2
                id="onboarding-welcome-title"
                className="mt-1 text-2xl font-extrabold tracking-tight text-content sm:text-[2rem]"
              >
                {title}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-background text-content-muted transition-colors hover:bg-border hover:text-content focus:outline-none focus:ring-2 focus:ring-action/40"
            aria-label="Cerrar"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-5 rounded-[1.5rem] border border-border bg-background/80 px-4 py-4">
          <p className="text-sm leading-6 text-content sm:text-[15px]">{body}</p>
          <p className="mt-3 text-sm leading-6 text-content-muted sm:text-[15px]">{secondary}</p>
        </div>

        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
          <button
            ref={primaryButtonRef}
            type="button"
            onClick={onStart}
            className="inline-flex flex-1 items-center justify-center rounded-2xl bg-action px-4 py-3 text-sm font-bold text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)] transition-all hover:bg-action/85 focus:outline-none focus:ring-2 focus:ring-action/35"
          >
            Empezar recorrido
          </button>
          <button
            type="button"
            onClick={onExplore}
            className="inline-flex flex-1 items-center justify-center rounded-2xl border border-border bg-surface px-4 py-3 text-sm font-bold text-content transition-colors hover:bg-background focus:outline-none focus:ring-2 focus:ring-action/20"
          >
            Explorar por mi cuenta
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-content-muted">
          Luego podrás volver a abrir este recorrido desde ayuda o configuración.
        </p>
      </div>
    </div>
  );
}
