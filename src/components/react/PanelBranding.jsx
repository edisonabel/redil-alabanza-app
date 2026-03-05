import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const hexToRgbString = (hex) => {
  let r = 0, g = 0, b = 0;
  if (hex.length === 4) { r = parseInt(hex[1] + hex[1], 16); g = parseInt(hex[2] + hex[2], 16); b = parseInt(hex[3] + hex[3], 16); }
  else if (hex.length === 7) { r = parseInt(hex[1] + hex[2], 16); g = parseInt(hex[3] + hex[4], 16); b = parseInt(hex[5] + hex[6], 16); }
  return `${r} ${g} ${b}`;
};

const isHexColor = (value) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value || '');

const DEFAULT_COLORS = {
  brand: '#14b8a6',
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

const COLOR_FIELDS = [
  { key: 'brand', label: 'Brand', cssVar: '--color-brand' },
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
  const [saveStatus, setSaveStatus] = useState('');
  const [isDarkPreview, setIsDarkPreview] = useState(false);

  useEffect(() => {
    Object.entries(DEFAULT_COLORS).forEach(([key, value]) => {
      applyColorToDom(key, value);
    });
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadSavedConfig = async () => {
      setIsLoadingConfig(true);

      const { data, error } = await supabase
        .from('configuracion_app')
        .select('colores')
        .eq('id', 1)
        .limit(1);

      if (!isMounted) return;

      if (error) {
        setIsLoadingConfig(false);
        return;
      }

      const savedColors = sanitizeColorConfig(data?.[0]?.colores);
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
    setIsDarkPreview(document.documentElement.classList.contains('dark'));
  }, []);

  const handleDarkModeToggle = () => {
    setIsDarkPreview((prev) => {
      const nextIsDark = !prev;
      document.documentElement.classList.toggle('dark', nextIsDark);
      localStorage.setItem('theme', nextIsDark ? 'dark' : 'light');
      return nextIsDark;
    });
  };

  const handleColorChange = (key, hexValue) => {
    setColors((prev) => ({ ...prev, [key]: hexValue }));
    applyColorToDom(key, hexValue);
    setSaveStatus('');
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus('');

    const { error } = await supabase
      .from('configuracion_app')
      .upsert([{ id: 1, colores: colors }], { onConflict: 'id' });

    if (error) {
      setSaveStatus(`Error al guardar: ${error.message}`);
      setIsSaving(false);
      return;
    }

    setSaveStatus('Configuración guardada correctamente.');
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
          className="mt-6 w-full bg-brand text-white font-ui-strong rounded-xl px-5 py-3 hover:bg-brand/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSaving ? 'Guardando...' : 'Guardar Configuración'}
        </button>

        {saveStatus && (
          <p className={`mt-3 text-sm ${saveStatus.startsWith('Error') ? 'text-danger' : 'text-success'}`}>
            {saveStatus}
          </p>
        )}
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
                ? 'bg-brand text-white border-brand'
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
              <button type="button" className="bg-brand text-white px-5 py-2 rounded-xl font-bold">Principal</button>
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
    </div>
  );
}

