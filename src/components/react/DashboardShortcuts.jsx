import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import NotificationBell from './NotificationBell.jsx';
import BotonNotificaciones from './BotonNotificaciones.jsx';

export default function DashboardShortcuts({ userId = null }) {
  const [isDark, setIsDark] = useState(false);
  const [target, setTarget] = useState(null);

  useEffect(() => {
    setTarget(document.getElementById('dashboard-shortcuts-slot'));

    const syncThemeState = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };

    syncThemeState();
    window.addEventListener('redil:theme-changed', syncThemeState);
    document.addEventListener('astro:page-load', syncThemeState);

    return () => {
      window.removeEventListener('redil:theme-changed', syncThemeState);
      document.removeEventListener('astro:page-load', syncThemeState);
    };
  }, []);

  const handleOpenOnboarding = () => {
    if (typeof window === 'undefined') return;
    if (typeof window.openOnboarding === 'function') {
      window.openOnboarding();
      return;
    }
    window.__REDIL_OPEN_ONBOARDING_PENDING__ = true;
    window.dispatchEvent(new CustomEvent('redil:open-onboarding'));
  };

  const toggleDarkMode = () => {
    setIsDark((prev) => {
      const next = !prev;
      if (window.__REDIL_THEME_MANAGER__?.setTheme) {
        window.__REDIL_THEME_MANAGER__.setTheme(next ? 'dark' : 'light');
      } else {
        document.documentElement.classList.toggle('dark', next);
        localStorage.setItem('theme', next ? 'dark' : 'light');
      }
      return next;
    });
  };

  if (!target) return null;

  return createPortal(
    <>
      <h2 className="text-lg font-bold text-content tracking-tight mb-3">Atajos</h2>
      <div className="relative overflow-hidden border border-zinc-200/80 rounded-[2rem] p-5 shadow-sm bg-[radial-gradient(circle_at_bottom_left,_rgba(20,184,166,0.05),_transparent_50%),linear-gradient(180deg,_rgba(255,255,255,0.99),_rgba(244,244,245,0.97))] dark:border-white/10 dark:bg-[radial-gradient(circle_at_bottom_left,_rgba(20,184,166,0.12),_transparent_50%),linear-gradient(180deg,_rgba(24,24,27,0.98),_rgba(15,23,42,0.95))] dark:shadow-[0_8px_32px_rgba(2,6,23,0.25)]">
        <div className="grid grid-cols-4 gap-2 sm:gap-3 items-start">
          <a href="/perfil#ausencias" className="flex flex-col items-center gap-2 group min-w-0">
            <div className="w-12 h-12 bg-background border border-border text-content rounded-full flex items-center justify-center group-active:scale-90 transition-transform">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
            </div>
            <span className="text-[10px] sm:text-xs font-semibold text-content text-center leading-tight">Ausencias</span>
          </a>

          <div className="flex flex-col items-center gap-2 group min-w-0">
            <NotificationBell inline direction="up" />
            <span className="text-[10px] sm:text-xs font-semibold text-content text-center leading-tight">Notificaciones</span>
          </div>

          <button type="button" onClick={handleOpenOnboarding} className="flex flex-col items-center gap-2 group min-w-0">
            <div className="w-12 h-12 rounded-full border border-border bg-background text-content flex items-center justify-center transition-colors group-active:scale-90">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3" />
                <path d="M12 17h.01" />
              </svg>
            </div>
            <span className="text-[10px] sm:text-xs font-semibold text-content text-center leading-tight">Ayuda</span>
          </button>

          <button type="button" onClick={toggleDarkMode} className="flex flex-col items-center gap-2 group min-w-0">
            <div className={`w-12 h-12 rounded-full border border-border flex items-center justify-center transition-colors ${isDark ? 'bg-action/20 text-action' : 'bg-background text-content'}`}>
              {isDark ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
              )}
            </div>
            <span className="text-[10px] sm:text-xs font-semibold text-content text-center leading-tight">{isDark ? 'Claro' : 'Oscuro'}</span>
          </button>
        </div>

        <div className="mt-4">
          <BotonNotificaciones userId={userId || null} compact className="w-full" />
        </div>
      </div>
    </>,
    target,
  );
}
