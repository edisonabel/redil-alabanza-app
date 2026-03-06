import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

const hexToRgbString = (hex) => {
  let r = 0; let g = 0; let b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex[1] + hex[2], 16);
    g = parseInt(hex[3] + hex[4], 16);
    b = parseInt(hex[5] + hex[6], 16);
  }
  return `${r} ${g} ${b}`;
};

const isHexColor = (value) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value || '');

const DEFAULT_COLORS = {
  brand: '#14b8a6',
  action: '#14b8a6',
  danger: '#ef4444',
  success: '#22c55e',
  warning: '#f59e0b',
  info: '#3b82f6',
  accent: '#ec4899',
  neutral: '#64748b',
  overlay: '#0f172a',
  rolDir: '#8b5cf6',
  rolLet: '#f59e0b',
  rolBan: '#14b8a6',
  rolVoc: '#a855f7',
};

const BRANDING_TABLE_CANDIDATES = ['configuracion_app', 'configuracion', 'branding_config'];
const LOCAL_BRANDING_KEY = 'branding_config_cache_v1';

const COLOR_FIELDS = [
  { key: 'brand', label: 'Brand (Fondo)', cssVar: '--color-brand' },
  { key: 'action', label: 'Acción (Botones)', cssVar: '--color-action' },
  { key: 'danger', label: 'Danger', cssVar: '--color-danger' },
  { key: 'success', label: 'Success', cssVar: '--color-success' },
  { key: 'warning', label: 'Warning', cssVar: '--color-warning' },
  { key: 'info', label: 'Info', cssVar: '--color-info' },
  { key: 'accent', label: 'Accent', cssVar: '--color-accent' },
  { key: 'neutral', label: 'Neutral', cssVar: '--color-neutral' },
  { key: 'overlay', label: 'Overlay', cssVar: '--color-overlay' },
  { key: 'rolDir', label: 'Rol Dirección', cssVar: '--color-rol-dir' },
  { key: 'rolLet', label: 'Rol Letras', cssVar: '--color-rol-let' },
  { key: 'rolBan', label: 'Rol Banda', cssVar: '--color-rol-ban' },
  { key: 'rolVoc', label: 'Rol Voces', cssVar: '--color-rol-voc' },
];

const COLOR_VAR_MAP = COLOR_FIELDS.reduce((acc, field) => {
  acc[field.key] = field.cssVar;
  return acc;
}, {});

const isTableNotFoundError = (error) => {
  if (!error) return false;
  const message = String(error.message || '').toLowerCase();
  return error.code === 'PGRST205' || message.includes('could not find the table');
};

const getTableFallbackOrder = (preferredTable) => {
  if (!preferredTable) return BRANDING_TABLE_CANDIDATES;
  return [preferredTable, ...BRANDING_TABLE_CANDIDATES.filter((table) => table !== preferredTable)];
};

const applyColorToDom = (key, hexValue) => {
  const cssVar = COLOR_VAR_MAP[key];
  if (!cssVar || !isHexColor(hexValue)) return;
  document.documentElement.style.setProperty(cssVar, hexToRgbString(hexValue));
};

const sanitizeColorConfig = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const next = { ...DEFAULT_COLORS };
  let hasAny = false;

  COLOR_FIELDS.forEach(({ key }) => {
    const candidate = raw[key];
    if (typeof candidate === 'string' && isHexColor(candidate.trim())) {
      next[key] = candidate.trim();
      hasAny = true;
    }
  });

  return hasAny ? next : null;
};

export default function PanelBranding() {
  const [colors, setColors] = useState(DEFAULT_COLORS);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isDarkPreview, setIsDarkPreview] = useState(false);
  const [feedbackModal, setFeedbackModal] = useState({
    open: false,
    type: 'success',
    title: '',
    message: '',
  });
  const activeTableRef = useRef(BRANDING_TABLE_CANDIDATES[0]);
  const feedbackTimerRef = useRef(null);

  const showFeedback = (type, title, message) => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }

    setFeedbackModal({
      open: true,
      type,
      title,
      message,
    });

    feedbackTimerRef.current = setTimeout(() => {
      setFeedbackModal((prev) => ({ ...prev, open: false }));
    }, 4200);
  };

  const closeFeedback = () => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    setFeedbackModal((prev) => ({ ...prev, open: false }));
  };

  useEffect(() => {
    Object.entries(DEFAULT_COLORS).forEach(([key, value]) => {
      applyColorToDom(key, value);
    });
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadSavedConfig = async () => {
      setIsLoadingConfig(true);

      let savedColors = null;
      let resolvedTable = null;

      for (const table of getTableFallbackOrder(activeTableRef.current)) {
        const { data, error } = await supabase
          .from(table)
          .select('colores')
          .eq('id', 1)
          .limit(1);

        if (error) {
          if (isTableNotFoundError(error)) continue;
          continue;
        }

        resolvedTable = table;
        savedColors = sanitizeColorConfig(data?.[0]?.colores);
        break;
      }

      if (!savedColors) {
        try {
          const localRaw = localStorage.getItem(LOCAL_BRANDING_KEY);
          savedColors = sanitizeColorConfig(localRaw ? JSON.parse(localRaw) : null);
        } catch {
          // no-op
        }
      }

      if (!isMounted) return;

      if (resolvedTable) {
        activeTableRef.current = resolvedTable;
      }

      if (savedColors) {
        setColors(savedColors);
        Object.entries(savedColors).forEach(([key, value]) => {
          applyColorToDom(key, value);
        });
      }

      setIsLoadingConfig(false);
    };

    loadSavedConfig();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    const syncThemeState = () => {
      setIsDarkPreview(document.documentElement.classList.contains('dark'));
    };
    syncThemeState();
    window.addEventListener('redil:theme-changed', syncThemeState);
    document.addEventListener('astro:page-load', syncThemeState);
    return () => {
      window.removeEventListener('redil:theme-changed', syncThemeState);
      document.removeEventListener('astro:page-load', syncThemeState);
    };
  }, []);

  useEffect(() => () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
  }, []);

  const handleDarkModeToggle = () => {
    setIsDarkPreview((prev) => {
      const nextIsDark = !prev;
      if (window.__REDIL_THEME_MANAGER__?.setTheme) {
        window.__REDIL_THEME_MANAGER__.setTheme(nextIsDark ? 'dark' : 'light');
      } else {
        document.documentElement.classList.toggle('dark', nextIsDark);
        localStorage.setItem('theme', nextIsDark ? 'dark' : 'light');
      }
      return nextIsDark;
    });
  };

  const handleColorChange = (key, hexValue) => {
    setColors((prev) => ({ ...prev, [key]: hexValue }));
    applyColorToDom(key, hexValue);
  };

  const handleSave = async () => {
    setIsSaving(true);

    let savedInTable = null;
    let lastError = null;

    for (const table of getTableFallbackOrder(activeTableRef.current)) {
      const { error } = await supabase
        .from(table)
        .upsert([{ id: 1, colores: colors }], { onConflict: 'id' });

      if (!error) {
        savedInTable = table;
        activeTableRef.current = table;
        break;
      }

      lastError = error;
      if (!isTableNotFoundError(error)) {
        continue;
      }
    }

    if (!savedInTable) {
      try {
        localStorage.setItem(LOCAL_BRANDING_KEY, JSON.stringify(colors));
        showFeedback(
          'warning',
          'Guardado local',
          'Configuración guardada en este dispositivo. Falta crear la tabla de branding en Supabase.',
        );
      } catch {
        const rawError = String(lastError?.message || '');
        const friendlyError = rawError.toLowerCase().includes('no rows returned')
          ? 'Supabase respondió sin filas. Revisa políticas RLS y que exista el registro id = 1.'
          : rawError || 'No se pudo persistir la configuración.';
        showFeedback(
          'error',
          'No se pudo guardar',
          `Error: ${friendlyError}`,
        );
      }
      setIsSaving(false);
      return;
    }

    try {
      localStorage.setItem(LOCAL_BRANDING_KEY, JSON.stringify(colors));
    } catch {
      // no-op
    }

    showFeedback('success', 'Configuración guardada', 'Los colores se guardaron correctamente.');
    setIsSaving(false);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <section className="bg-surface rounded-3xl p-6 border border-border">
        <h2 className="text-2xl font-black tracking-tight text-content">Panel de Branding</h2>
        <p className="text-sm text-content-muted mt-1">Edita la paleta y guarda la configuración white-label.</p>

        <div className="mt-4 flex items-center justify-between rounded-xl bg-background/70 border border-border px-4 py-2">
          <p className="text-xs font-semibold text-content-muted uppercase tracking-wider">Estado</p>
          <p className="text-xs font-semibold text-content">
            {isLoadingConfig ? 'Cargando configuración...' : 'Lista para editar'}
          </p>
        </div>

        <div className="mt-6 space-y-3 max-h-[58vh] overflow-y-auto pr-1">
          {COLOR_FIELDS.map((field) => (
            <div
              key={field.key}
              className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-background/60 px-4 py-3"
            >
              <div>
                <p className="text-sm font-bold text-content">{field.label}</p>
                <p className="text-xs uppercase font-mono text-content-muted">{colors[field.key]}</p>
              </div>
              <input
                type="color"
                value={colors[field.key]}
                onChange={(event) => handleColorChange(field.key, event.target.value)}
                className="h-10 w-14 cursor-pointer rounded-lg border border-border bg-surface p-1"
                aria-label={`Selector de color ${field.label}`}
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="mt-6 w-full bg-action text-white font-ui-strong rounded-xl px-5 py-3 hover:bg-action/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSaving ? 'Guardando...' : 'Guardar Configuración'}
        </button>
      </section>

      <section className="sticky top-8 bg-surface rounded-3xl p-6 border border-border h-fit max-h-[calc(100vh-4rem)] overflow-y-auto">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-content">Vista previa en tiempo real</h2>
            <p className="text-sm text-content-muted mt-1">Replica elementos clave de Inicio, Repertorio, Programación y Equipo.</p>
          </div>

          <button
            type="button"
            onClick={handleDarkModeToggle}
            className={`px-4 py-2 rounded-xl border font-bold text-sm transition-colors ${
              isDarkPreview
                ? 'bg-action text-white border-action'
                : 'bg-background text-content border-border hover:bg-background/70'
            }`}
          >
            {isDarkPreview ? 'Modo oscuro: ON' : 'Modo oscuro: OFF'}
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <article className="rounded-2xl border border-border bg-background/60 p-4">
            <p className="text-xs uppercase tracking-widest font-bold text-content-muted">Botones y badges</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="bg-action text-white px-5 py-2 rounded-xl font-bold">Principal</button>
              <button type="button" className="bg-danger text-white px-5 py-2 rounded-xl font-bold">Peligro</button>
              <button type="button" className="bg-neutral/10 text-neutral px-5 py-2 rounded-xl font-bold">Cancelar</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="bg-danger/10 text-danger px-3 py-1 rounded-full font-bold text-xs">YouTube</span>
              <span className="bg-success/10 text-success px-3 py-1 rounded-full font-bold text-xs">Acordes</span>
              <span className="bg-warning/10 text-warning px-3 py-1 rounded-full font-bold text-xs">Voces</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="bg-rol-dir/10 text-rol-dir px-3 py-1 rounded-full font-bold text-xs">Dirección</span>
              <span className="bg-rol-let/10 text-rol-let px-3 py-1 rounded-full font-bold text-xs">Letras</span>
              <span className="bg-rol-ban/10 text-rol-ban px-3 py-1 rounded-full font-bold text-xs">Banda</span>
              <span className="bg-rol-voc/10 text-rol-voc px-3 py-1 rounded-full font-bold text-xs">Voces</span>
            </div>
          </article>

          <article className="rounded-2xl border border-border bg-background/60 p-4">
            <p className="text-xs uppercase tracking-widest font-bold text-content-muted">Overlay sobre imagen</p>
            <div className="mt-3 relative h-24 rounded-xl border border-border overflow-hidden">
              <div className="absolute inset-0 bg-[url('/icon-512.png')] bg-cover bg-center"></div>
              <div className="absolute inset-0 bg-overlay/65"></div>
              <div className="relative z-10 h-full flex items-end p-3">
                <span className="text-white font-bold text-sm">Texto sobre overlay</span>
              </div>
            </div>
          </article>

          <article className="rounded-2xl border border-border bg-background/60 p-4">
            <p className="text-xs uppercase tracking-widest font-bold text-content-muted">Repertorio (Card)</p>
            <div className="mt-3 rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-black text-content">Grande y Fuerte</h3>
                  <p className="text-content-muted text-sm">Miel San Marcos</p>
                </div>
                <button type="button" className="w-8 h-8 rounded-full bg-info/10 text-info hover:bg-info/20 font-black">+</button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="bg-background border border-border text-content px-2.5 py-1 rounded-full font-semibold">Key: G</span>
                <span className="bg-background border border-border text-content px-2.5 py-1 rounded-full font-semibold">72 BPM</span>
                <span className="bg-background border border-border text-content px-2.5 py-1 rounded-full font-semibold">Hombre</span>
              </div>
            </div>
          </article>
        </div>
      </section>

      {feedbackModal.open && (
        <div
          className="fixed inset-0 z-[140] bg-overlay/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeFeedback}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-surface border border-border shadow-2xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 w-9 h-9 rounded-xl flex items-center justify-center text-white ${
                    feedbackModal.type === 'error'
                      ? 'bg-danger'
                      : feedbackModal.type === 'warning'
                        ? 'bg-warning'
                        : 'bg-success'
                  }`}
                >
                  {feedbackModal.type === 'error' ? '!' : feedbackModal.type === 'warning' ? '?' : 'OK'}
                </div>
                <div>
                  <h3 className="text-base font-black text-content leading-tight">{feedbackModal.title}</h3>
                  <p className="text-sm text-content-muted mt-1 leading-snug">{feedbackModal.message}</p>
                </div>
              </div>
              <button
                type="button"
                className="w-8 h-8 rounded-lg border border-border text-content-muted hover:text-content hover:bg-background transition-colors"
                onClick={closeFeedback}
                aria-label="Cerrar mensaje"
              >
                x
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
