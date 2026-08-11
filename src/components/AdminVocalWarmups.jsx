import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  FileAudio,
  Loader2,
  Mic2,
  PencilLine,
  Play,
  Plus,
  Search,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

const MAX_MP3_BYTES = 150 * 1024 * 1024;
const EMPTY_FORM = {
  titulo: '',
  orden: 0,
  activo: true,
  file: null,
};

const sortWarmups = (items = []) => [...items].sort((left, right) => (
  Number(left?.orden || 0) - Number(right?.orden || 0)
  || String(left?.titulo || '').localeCompare(String(right?.titulo || ''), 'es', { sensitivity: 'base' })
));

const normalizeSearch = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const isMp3File = (file) => {
  if (!file) return false;
  const fileName = String(file.name || '').toLowerCase();
  const fileType = String(file.type || '').toLowerCase();
  return fileName.endsWith('.mp3') || fileType === 'audio/mpeg' || fileType === 'audio/mp3';
};

const getApiError = async (response, fallback) => {
  const body = await response.json().catch(() => null);
  return body?.error || fallback;
};

export default function AdminVocalWarmups({ createSignal = 0, onCountChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const createSignalRef = useRef(createSignal);
  const dialogRef = useRef(null);
  const titleInputRef = useRef(null);

  const visibleItems = useMemo(() => {
    const query = normalizeSearch(search);
    if (!query) return items;
    return items.filter((item) => normalizeSearch(item?.titulo).includes(query));
  }, [items, search]);

  const nextOrder = useMemo(() => (
    items.length > 0
      ? Math.min(9999, Math.max(...items.map((item) => Number(item?.orden || 0))) + 10)
      : 10
  ), [items]);

  const loadWarmups = async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: queryError } = await supabase
        .from('calentamientos_vocales')
        .select('id, titulo, mp3_url, archivo_nombre, orden, activo, created_at, updated_at')
        .order('orden', { ascending: true })
        .order('titulo', { ascending: true });

      if (queryError) throw queryError;
      setItems(sortWarmups(data || []));
    } catch (loadError) {
      const detail = String(loadError?.message || 'No se pudo abrir la biblioteca.');
      const isPendingMigration = /calentamientos_vocales|schema cache|does not exist/i.test(detail);
      if (isPendingMigration) {
        console.warn('La biblioteca de calentamientos espera la migración 041.');
      } else {
        console.error('No se pudieron cargar los calentamientos vocales:', loadError);
      }
      setError(isPendingMigration ? 'Falta aplicar la migración 041 para habilitar esta biblioteca.' : detail);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWarmups();
  }, []);

  useEffect(() => {
    onCountChange?.(items.length);
  }, [items.length, onCountChange]);

  const openNew = () => {
    setEditingItem(null);
    setForm({ ...EMPTY_FORM, orden: nextOrder });
    setFeedback('');
    setModalOpen(true);
  };

  useEffect(() => {
    if (createSignal === createSignalRef.current) return;
    createSignalRef.current = createSignal;
    openNew();
  }, [createSignal, nextOrder]);

  const openEdit = (item) => {
    setEditingItem(item);
    setForm({
      titulo: String(item?.titulo || ''),
      orden: Number(item?.orden || 0),
      activo: Boolean(item?.activo),
      file: null,
    });
    setFeedback('');
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingItem(null);
    setFeedback('');
  };

  useEffect(() => {
    if (!modalOpen || typeof document === 'undefined') return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => titleInputRef.current?.focus());

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) {
        closeModal();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ) || []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [modalOpen, saving]);

  const selectFile = (file) => {
    if (!file) return;
    if (!isMp3File(file)) {
      setFeedback('Selecciona un archivo MP3.');
      return;
    }
    if (file.size > MAX_MP3_BYTES) {
      setFeedback('El MP3 no puede superar 150 MB.');
      return;
    }
    setForm((previous) => ({ ...previous, file }));
    setFeedback('');
  };

  const uploadMp3 = async (file, warmupId) => {
    const response = await fetch('/api/get-upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warmupId,
        purpose: 'calentamiento',
        fileName: file.name,
        fileType: file.type || 'audio/mpeg',
        fileSize: file.size,
      }),
    });
    if (!response.ok) {
      throw new Error(await getApiError(response, 'No se pudo preparar la subida.'));
    }

    const { presignedUrl, publicUrl } = await response.json();
    const uploadResponse = await fetch(presignedUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type || 'audio/mpeg' },
    });
    if (!uploadResponse.ok) throw new Error('No se pudo subir el MP3.');
    return publicUrl;
  };

  const deleteStoredFile = async (itemId, fileUrl) => {
    if (!itemId || !fileUrl) return;
    const response = await fetch('/api/delete-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ warmupId: itemId, fileUrl }),
    });
    if (!response.ok) {
      throw new Error(await getApiError(response, 'No se pudo eliminar el MP3 anterior.'));
    }
  };

  const saveWarmup = async (event) => {
    event.preventDefault();
    const title = String(form.titulo || '').trim();
    const order = Math.max(0, Math.min(9999, Number(form.orden) || 0));
    if (!title) {
      setFeedback('Escribe el nombre del calentamiento.');
      return;
    }
    if (!editingItem && !form.file) {
      setFeedback('Selecciona el MP3 del calentamiento.');
      return;
    }

    setSaving(true);
    setFeedback('');
    let createdItem = null;
    let uploadedUrl = '';

    try {
      if (editingItem) {
        let nextMp3Url = String(editingItem.mp3_url || '');
        let nextFileName = String(editingItem.archivo_nombre || '');
        if (form.file) {
          uploadedUrl = await uploadMp3(form.file, editingItem.id);
          nextMp3Url = uploadedUrl;
          nextFileName = form.file.name;
        }

        const payload = {
          titulo: title,
          orden: order,
          activo: Boolean(form.activo),
          mp3_url: nextMp3Url || null,
          archivo_nombre: nextFileName || null,
        };
        const { data, error: updateError } = await supabase
          .from('calentamientos_vocales')
          .update(payload)
          .eq('id', editingItem.id)
          .select('id, titulo, mp3_url, archivo_nombre, orden, activo, created_at, updated_at')
          .single();
        if (updateError) throw updateError;

        setItems((previous) => sortWarmups(previous.map((item) => (
          item.id === editingItem.id ? data : item
        ))));

        if (uploadedUrl && editingItem.mp3_url && editingItem.mp3_url !== uploadedUrl) {
          deleteStoredFile(editingItem.id, editingItem.mp3_url).catch((cleanupError) => {
            console.warn('No se pudo limpiar el MP3 reemplazado:', cleanupError);
          });
        }
        setSuccessMessage('Calentamiento actualizado.');
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('calentamientos_vocales')
          .insert([{
            titulo: title,
            orden: order,
            activo: false,
          }])
          .select('id, titulo, mp3_url, archivo_nombre, orden, activo, created_at, updated_at')
          .single();
        if (insertError) throw insertError;
        createdItem = inserted;

        uploadedUrl = await uploadMp3(form.file, inserted.id);
        const { data, error: updateError } = await supabase
          .from('calentamientos_vocales')
          .update({
            mp3_url: uploadedUrl,
            archivo_nombre: form.file.name,
            activo: Boolean(form.activo),
          })
          .eq('id', inserted.id)
          .select('id, titulo, mp3_url, archivo_nombre, orden, activo, created_at, updated_at')
          .single();
        if (updateError) throw updateError;

        setItems((previous) => sortWarmups([...previous, data]));
        setSuccessMessage('Calentamiento publicado.');
      }

      setModalOpen(false);
      setEditingItem(null);
      window.setTimeout(() => setSuccessMessage(''), 3200);
    } catch (saveError) {
      console.error('No se pudo guardar el calentamiento:', saveError);
      if (createdItem?.id) {
        if (uploadedUrl) {
          await deleteStoredFile(createdItem.id, uploadedUrl).catch(() => {});
        }
        await supabase.from('calentamientos_vocales').delete().eq('id', createdItem.id);
      }
      setFeedback(String(saveError?.message || 'No se pudo guardar el calentamiento.'));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget?.id) return;
    setDeleting(true);
    try {
      if (deleteTarget.mp3_url) {
        await deleteStoredFile(deleteTarget.id, deleteTarget.mp3_url);
      }
      const { error: deleteError } = await supabase
        .from('calentamientos_vocales')
        .delete()
        .eq('id', deleteTarget.id);
      if (deleteError) throw deleteError;

      setItems((previous) => previous.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
      setSuccessMessage('Calentamiento eliminado.');
      window.setTimeout(() => setSuccessMessage(''), 3200);
    } catch (deleteError) {
      console.error('No se pudo eliminar el calentamiento:', deleteError);
      setError(String(deleteError?.message || 'No se pudo eliminar el calentamiento.'));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const playWarmup = (item) => {
    if (!item?.mp3_url) return;
    window.dispatchEvent(new CustomEvent('play-pro-audio', {
      detail: {
        url: item.mp3_url,
        title: item.titulo || 'Calentamiento',
        artist: 'Calentamiento vocal',
        autoPlay: true,
      },
    }));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] md:px-4">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.25rem] border border-border bg-surface/95 shadow-[0_18px_38px_-24px_rgba(15,23,42,0.32)]">
        <div className="shrink-0 border-b border-border bg-surface/95 p-3 backdrop-blur-xl md:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-black text-content">Biblioteca vocal</h2>
              <p className="mt-0.5 text-sm text-content-muted">Ejercicios disponibles en Herramientas.</p>
            </div>
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar calentamiento"
                aria-label="Buscar calentamiento"
                className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-sm text-content outline-none placeholder:text-content-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </div>
          </div>
        </div>

        {successMessage && (
          <div role="status" className="mx-3 mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5 text-sm font-semibold text-emerald-500 md:mx-4">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {successMessage}
          </div>
        )}

        {error && (
          <div role="alert" className="mx-3 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-sm font-semibold text-red-500 md:mx-4">
            <span>{error}</span>
            <button type="button" onClick={loadWarmups} className="min-h-9 rounded-lg border border-red-500/25 px-3 text-xs font-bold hover:bg-red-500/10">
              Reintentar
            </button>
          </div>
        )}

        <div className="admin-warmup-list min-h-0 flex-1 overflow-y-auto bg-background/70 p-3 pb-[calc(env(safe-area-inset-bottom)+5rem)] md:p-4">
          {loading ? (
            <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-content-muted">
              <Loader2 className="h-8 w-8 animate-spin text-brand" />
              <p className="text-sm font-semibold">Cargando calentamientos...</p>
            </div>
          ) : visibleItems.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {visibleItems.map((item) => (
                <article key={item.id} className="flex min-w-0 flex-col rounded-2xl border border-border bg-surface p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                      <Mic2 className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-black text-content" title={item.titulo}>{item.titulo}</h3>
                          <p className="mt-0.5 truncate text-xs text-content-muted" title={item.archivo_nombre || 'MP3 cargado'}>
                            {item.archivo_nombre || 'MP3 cargado'} · Orden {item.orden}
                          </p>
                        </div>
                        <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${item.activo ? 'bg-emerald-500/10 text-emerald-500' : 'bg-content-muted/10 text-content-muted'}`}>
                          {item.activo ? 'Activo' : 'Oculto'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 border-t border-border pt-3">
                    <button
                      type="button"
                      onClick={() => playWarmup(item)}
                      disabled={!item.mp3_url}
                      className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-brand/25 bg-brand/10 px-3 text-sm font-bold text-brand transition-colors hover:bg-brand/15 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Play className="h-4 w-4 fill-current" />
                      Probar
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(item)}
                      className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-border bg-background text-content-muted transition-colors hover:border-brand/30 hover:text-brand"
                      aria-label={`Editar ${item.titulo}`}
                    >
                      <PencilLine className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(item)}
                      className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 text-red-500 transition-colors hover:bg-red-500/10"
                      aria-label={`Eliminar ${item.titulo}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface px-6 text-center">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                <FileAudio className="h-7 w-7" />
              </span>
              <p className="mt-4 font-black text-content">{search ? 'No encontramos ejercicios' : 'Aún no hay calentamientos'}</p>
              <p className="mt-1 max-w-sm text-sm text-content-muted">
                {search ? 'Prueba con otro nombre.' : 'Sube el primer MP3 para iniciar la biblioteca.'}
              </p>
              {!search && !error && (
                <button type="button" onClick={openNew} className="mt-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white">
                  <Plus className="h-4 w-4" />
                  Nuevo ejercicio
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {modalOpen && (
        <div
          className="fixed inset-x-0 z-[90] flex items-end justify-center bg-slate-950/72 backdrop-blur-md sm:items-center sm:p-4"
          style={{
            top: 'var(--app-modal-viewport-offset-top, 0px)',
            bottom: 'auto',
            height: 'var(--app-modal-viewport-height, 100dvh)',
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="warmup-dialog-title"
            className="flex w-full flex-col overflow-hidden rounded-t-[1.65rem] border border-border bg-surface shadow-2xl sm:max-w-xl sm:rounded-[1.65rem]"
            style={{ maxHeight: 'min(48rem, calc(var(--app-modal-viewport-height, 100dvh) - 0.75rem))' }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 pb-4 pt-5 sm:px-6">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand">Calentamiento vocal</p>
                <h2 id="warmup-dialog-title" className="mt-1 text-xl font-black text-content sm:text-2xl">
                  {editingItem ? 'Editar ejercicio' : 'Nuevo ejercicio'}
                </h2>
              </div>
              <button type="button" onClick={closeModal} disabled={saving} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-content-muted hover:text-content disabled:opacity-50" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={saveWarmup} className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-background/70 px-4 py-5 sm:px-6">
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Nombre *</span>
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={form.titulo}
                    onChange={(event) => {
                      setForm((previous) => ({ ...previous, titulo: event.target.value }));
                      setFeedback('');
                    }}
                    maxLength={120}
                    placeholder="Ej. Vocalización en cinco notas"
                    className="mt-2 h-12 w-full rounded-xl border border-border bg-surface px-4 text-base font-semibold text-content outline-none placeholder:font-normal placeholder:text-content-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                </label>

                <div>
                  <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Archivo MP3 {editingItem ? '' : '*'}</span>
                  <div className={`mt-2 flex min-h-[5rem] items-center gap-3 rounded-xl border p-3 ${form.file || editingItem?.mp3_url ? 'border-emerald-500/25 bg-emerald-500/10' : 'border-border bg-surface'}`}>
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                      {form.file || editingItem?.mp3_url ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <FileAudio className="h-5 w-5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-content">
                        {form.file?.name || editingItem?.archivo_nombre || (editingItem?.mp3_url ? 'MP3 actual' : 'Selecciona el MP3')}
                      </p>
                      <p className="mt-0.5 text-xs text-content-muted">Máximo 150 MB.</p>
                    </div>
                    <label className="inline-flex min-h-[42px] shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-bold text-content transition-colors hover:border-brand/30 hover:text-brand">
                      <UploadCloud className="h-4 w-4" />
                      <span className="hidden sm:inline">{editingItem?.mp3_url || form.file ? 'Cambiar' : 'Elegir'}</span>
                      <input type="file" hidden accept="audio/mpeg,.mp3" onChange={(event) => {
                        selectFile(event.target.files?.[0]);
                        event.target.value = '';
                      }} />
                    </label>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Orden</span>
                    <input
                      type="number"
                      min="0"
                      max="9999"
                      value={form.orden}
                      onChange={(event) => setForm((previous) => ({ ...previous, orden: event.target.value }))}
                      className="mt-2 h-12 w-full rounded-xl border border-border bg-surface px-4 text-base text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                    />
                  </label>
                  <label className="mt-6 flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 sm:mt-6">
                    <span>
                      <span className="block text-sm font-bold text-content">Visible</span>
                      <span className="block text-xs text-content-muted">Mostrar en Herramientas</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={form.activo}
                      onChange={(event) => setForm((previous) => ({ ...previous, activo: event.target.checked }))}
                      className="h-5 w-5 rounded border-border accent-brand"
                    />
                  </label>
                </div>

                {feedback && <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-sm font-semibold text-red-500">{feedback}</p>}
              </div>

              <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-surface/95 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-xl sm:flex-row sm:justify-end sm:px-6 sm:pb-4">
                <button type="button" onClick={closeModal} disabled={saving} className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-bold text-content disabled:opacity-50">
                  Cancelar
                </button>
                <button type="submit" disabled={saving || !String(form.titulo || '').trim() || (!editingItem && !form.file)} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                  {saving ? 'Guardando...' : editingItem ? 'Guardar cambios' : 'Publicar ejercicio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/72 p-4 backdrop-blur-md">
          <div role="alertdialog" aria-modal="true" aria-labelledby="delete-warmup-title" className="w-full max-w-md rounded-[1.5rem] border border-border bg-surface p-5 shadow-2xl sm:p-6">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
              <Trash2 className="h-5 w-5" />
            </span>
            <h2 id="delete-warmup-title" className="mt-4 text-xl font-black text-content">¿Eliminar calentamiento?</h2>
            <p className="mt-2 text-sm leading-6 text-content-muted">Se eliminarán “{deleteTarget.titulo}” y su MP3. Esta acción no se puede deshacer.</p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleting} className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-bold text-content disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={confirmDelete} disabled={deleting} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-red-500 px-4 text-sm font-bold text-white disabled:opacity-50">
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .admin-warmup-list {
          overscroll-behavior: contain;
          scrollbar-gutter: stable;
          scrollbar-width: thin;
          scrollbar-color: rgba(13, 148, 136, 0.78) rgba(148, 163, 184, 0.12);
        }
        .admin-warmup-list::-webkit-scrollbar { width: 8px; }
        .admin-warmup-list::-webkit-scrollbar-track { background: rgba(148, 163, 184, 0.12); }
        .admin-warmup-list::-webkit-scrollbar-thumb { border-radius: 999px; background: rgba(13, 148, 136, 0.78); }
      `}</style>
    </div>
  );
}
