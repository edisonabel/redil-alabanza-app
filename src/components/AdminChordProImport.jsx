import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardPaste, FileUp, LoaderCircle, ScanText, Search, X, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { hasChordPro } from '../utils/chordProImport.js';

// Importar ChordPro: elegir la canción, pegar la captura (⌘V) y la IA propone el ChordPro para revisar y guardar.
// Abajo, plegada, la revisión de los borradores que genera `npm run chordpro:importar` en la Mac.
// Solo guarda en canciones que siguen sin ChordPro: nunca sobrescribe lo existente.
const STATUS = {
  listo: { label: 'Listo', tone: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  revisar: { label: 'Por revisar', tone: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  omitida: { label: 'Ya tenía ChordPro', tone: 'border-border bg-background text-content-muted' },
  'sin-coincidencia': { label: 'Elige la canción', tone: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  error: { label: 'Error', tone: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300' },
  guardada: { label: 'Guardada', tone: 'border-brand/30 bg-brand/10 text-brand' },
};
/**
 * Guarda solo si la canción sigue sin ChordPro: se vuelve a leer y se escribe únicamente si el valor
 * sigue siendo el leído. Si alguien guardó ChordPro mientras tanto, no se toca.
 */
async function saveChordProGuarded(song, chordpro) {
  const title = song?.titulo || 'la canción';
  const { data: rows, error: readError } = await supabase.from('canciones').select('id, chordpro').eq('id', song.id);
  if (readError) throw readError;
  if (!rows?.length) throw new Error(`No encontré «${title}» en el catálogo.`);
  const existing = rows[0].chordpro ?? null;
  if (hasChordPro(existing)) throw new Error(`«${title}» ya tiene ChordPro: no se sobrescribe.`);
  const query = supabase.from('canciones').update({ chordpro }).eq('id', song.id);
  const { data, error } = await (existing == null ? query.is('chordpro', null) : query.eq('chordpro', existing)).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error(`«${title}» cambió mientras revisabas: no se sobrescribe.`);
}

const fileToPayload = (file) => new Promise((resolve, reject) => {
  const fileReader = new FileReader();
  fileReader.onload = () => resolve({ name: file.name || 'captura.png', type: file.type, data: String(fileReader.result) });
  fileReader.onerror = () => reject(new Error(`No pude leer «${file.name}».`));
  fileReader.readAsDataURL(file);
});
const ACCEPTED = /^(image\/(png|jpeg|webp|heic|tiff)|application\/pdf)$/;

/** Flujo simple: canción → pegar captura(s) → Transcribir con IA → revisar → Guardar. */
function QuickImport({ songs, onSongUpdated }) {
  const [query, setQuery] = useState('');
  const [song, setSong] = useState(null);
  const [files, setFiles] = useState([]);
  const [result, setResult] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const pending = useMemo(() => songs.filter((row) => !hasChordPro(row.chordpro))
    .sort((a, b) => String(a.titulo || '').localeCompare(String(b.titulo || ''), 'es', { sensitivity: 'base' })), [songs]);
  const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const suggestions = query.trim() ? pending.filter((row) => fold(row.titulo).includes(fold(query.trim()))).slice(0, 8) : [];
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);

  const addFiles = (list) => {
    const accepted = [...list].filter((file) => ACCEPTED.test(file.type));
    if (!accepted.length) { setMessage({ kind: 'error', text: 'Pega una imagen (captura) o un PDF.' }); return; }
    setMessage(null); setResult(null);
    setFiles((current) => [...current, ...accepted].slice(0, 8));
  };
  // ⌘V / Ctrl+V en cualquier parte del panel (salvo mientras se escribe en un campo de texto).
  useEffect(() => {
    const onPaste = (event) => {
      if (event.target?.closest?.('textarea, input:not([type="file"])')) return;
      const pasted = [...(event.clipboardData?.files || [])];
      if (pasted.length) { event.preventDefault(); addFiles(pasted); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const transcribe = async (precise = false) => {
    setBusy(precise ? 'preciso' : 'leer'); setMessage(null); setResult(null);
    try {
      const response = await fetch('/api/admin-chordpro-image', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: song.id, precise, files: await Promise.all(files.map(fileToPayload)) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'No se pudo leer la captura.');
      setResult(body); setDraft(body.chordpro || '');
    } catch (error) {
      setMessage({ kind: 'error', text: error.message });
    } finally { setBusy(''); }
  };
  const save = async () => {
    setBusy('guardar'); setMessage(null);
    try {
      const chordpro = draft.trim();
      await saveChordProGuarded(song, chordpro);
      onSongUpdated?.({ ...song, chordpro });
      setMessage({ kind: 'success', text: `ChordPro guardado en «${song.titulo}». Elige la siguiente canción.` });
      setSong(null); setQuery(''); setFiles([]); setResult(null); setDraft('');
    } catch (error) {
      setMessage({ kind: 'error', text: error.message });
    } finally { setBusy(''); }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm md:p-5" data-chordpro-quick="true">
      <h2 className="flex items-center gap-2 text-lg font-bold text-content"><ScanText className="h-5 w-5 text-brand" />Importar ChordPro</h2>
      <p className="mt-1 text-sm text-content-muted">Elige la canción, pega la captura con ⌘V y la IA prepara el ChordPro. Revísalo y guárdalo. Las capturas recortadas solo a la canción leen mejor y gastan menos.</p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-content-muted">1 · Canción</p>
          {song ? (
            <div className="flex h-11 items-center gap-2 rounded-xl border border-brand/30 bg-brand/5 px-3">
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-content">{song.titulo}</span>
              <button type="button" aria-label="Cambiar canción" onClick={() => { setSong(null); setResult(null); }} className="rounded-lg p-1 text-content-muted hover:text-content"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-content-muted" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Busca entre ${pending.length} canciones sin ChordPro`}
                aria-label="Buscar canción" className="h-11 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
              {!!suggestions.length && <ul role="listbox" aria-label="Canciones sin ChordPro" className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
                {suggestions.map((row) => <li key={row.id}><button type="button" role="option" aria-selected="false" onClick={() => { setSong(row); setQuery(''); }}
                  className="block w-full truncate px-3 py-2 text-left text-sm text-content hover:bg-brand/10">{row.titulo}</button></li>)}
              </ul>}
              {query.trim() && !suggestions.length && <p className="mt-1 text-xs text-content-muted">No hay canciones sin ChordPro con ese nombre.</p>}
            </div>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-content-muted">2 · Captura o PDF</p>
          <label onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border bg-background px-3 py-2 text-sm text-content-muted hover:border-brand/40">
            <ClipboardPaste className="h-4 w-4 shrink-0 text-brand" />
            <span>{files.length ? `${files.length} ${files.length === 1 ? 'imagen' : 'imágenes'} · pega o arrastra más si la canción sigue` : 'Pega con ⌘V, arrastra o elige imágenes / PDF'}</span>
            <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/heic,application/pdf" className="sr-only" aria-label="Elegir capturas o PDF"
              onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
          </label>
          {!!files.length && <div className="mt-2 flex flex-wrap gap-2" aria-label="Capturas pegadas">
            {previews.map(({ file, url }, index) => <div key={url} className="relative h-16 w-16 overflow-hidden rounded-lg border border-border bg-background">
              {file.type === 'application/pdf' ? <span className="flex h-full items-center justify-center text-xs font-bold text-content-muted">PDF</span> : <img src={url} alt={`Captura ${index + 1}`} className="h-full w-full object-cover" />}
              <button type="button" aria-label={`Quitar captura ${index + 1}`} onClick={() => { setFiles((current) => current.filter((_, k) => k !== index)); setResult(null); }}
                className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"><X className="h-3 w-3" /></button>
            </div>)}
          </div>}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => transcribe(false)} disabled={!song || !files.length || Boolean(busy)}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white shadow-sm hover:bg-brand/90 disabled:opacity-50">
          {busy === 'leer' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
          {busy === 'leer' ? 'Leyendo con IA…' : '3 · Transcribir con IA'}
        </button>
        {result && <span className="text-xs text-content-muted">{result.stats?.verified}/{result.stats?.lines} líneas con posición verificada · {((result.usage?.input || 0) + (result.usage?.output || 0)).toLocaleString('es')} tokens{result.mode === 'preciso' ? ' · lectura precisa' : ''}</span>}
        {/* El modelo fuerte cuesta varias veces más: solo si quedó algo por revisar y la persona lo pide. */}
        {result && result.mode !== 'preciso' && result.review?.some((row) => row.line) && <button type="button" onClick={() => transcribe(true)} disabled={Boolean(busy)}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-bold text-content hover:border-brand/40 hover:text-brand disabled:opacity-50">
          {busy === 'preciso' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          {busy === 'preciso' ? 'Releyendo…' : 'Releer con más precisión (gasta más tokens)'}
        </button>}
      </div>
      {message && <p role="status" className={`mt-3 rounded-lg border px-3 py-2 text-sm font-semibold ${message.kind === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300' : 'border-emerald-500/25 bg-emerald-500/10 text-content'}`}>{message.text}</p>}

      {result && <div className="mt-4 space-y-3" aria-label="Resultado">
        {!!result.review?.length && <ul className="space-y-1 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-content" aria-label="Por revisar">
          {result.review.map((row, k) => <li key={k} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <span>{row.line ? <strong>Línea {row.line}: </strong> : null}{row.reason}</span></li>)}
        </ul>}
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="max-h-[65vh] overflow-y-auto rounded-xl border border-border bg-background p-2" aria-label="Capturas originales">
            {previews.map(({ file, url }, index) => file.type === 'application/pdf'
              ? <p key={url} className="p-3 text-sm text-content-muted">{file.name || 'PDF'}</p>
              : <img key={url} src={url} alt={`Original ${index + 1}`} className="mb-2 w-full rounded-lg" />)}
          </div>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} aria-label="ChordPro propuesto"
            className="min-h-[50vh] w-full resize-y rounded-xl border border-border bg-background p-3 font-mono text-sm leading-relaxed text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={save} disabled={!draft.trim() || Boolean(busy)}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white shadow-sm hover:bg-brand/90 disabled:opacity-50">
            {busy === 'guardar' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}4 · Guardar en «{song?.titulo}»
          </button>
        </div>
      </div>}
    </div>
  );
}

const storageKey = (bundle) => `alabanza-chordpro-import:${bundle?.createdAt || ''}`;
const readSaved = (bundle) => { try { return JSON.parse(localStorage.getItem(storageKey(bundle)) || '{}'); } catch { return {}; } };

export default function AdminChordProImport({ songs = [], isAdmin = false, onSongUpdated }) {
  const [bundle, setBundle] = useState(null);
  const [selected, setSelected] = useState(0);
  const [drafts, setDrafts] = useState({});
  const [matches, setMatches] = useState({});
  const [saved, setSaved] = useState({});
  const [filter, setFilter] = useState('pendientes');
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState(null);
  const fileRef = useRef(null);

  const songsById = useMemo(() => new Map(songs.map((song) => [String(song.id), song])), [songs]);
  const withoutChordPro = useMemo(() => songs.filter((song) => !hasChordPro(song.chordpro))
    .sort((a, b) => String(a.titulo || '').localeCompare(String(b.titulo || ''), 'es', { sensitivity: 'base' })), [songs]);
  const items = useMemo(() => (bundle?.songs || []).map((row, index) => {
    const matchId = matches[index] ?? row.match?.id ?? '';
    const target = matchId ? songsById.get(String(matchId)) : null;
    const status = saved[index] ? 'guardada' : row.status === 'listo' && !matchId ? 'sin-coincidencia'
      : row.status === 'listo' && row.review?.length ? 'revisar' : row.status === 'sin-coincidencia' && matchId ? (row.review?.length ? 'revisar' : 'listo') : row.status;
    return { ...row, index, matchId, target, status };
  }), [bundle, matches, saved, songsById]);
  const counts = useMemo(() => items.reduce((all, item) => ({ ...all, [item.status]: (all[item.status] || 0) + 1 }), {}), [items]);
  const visible = items.filter((item) => filter === 'todas' || (filter === 'pendientes' ? ['listo', 'revisar', 'sin-coincidencia', 'error'].includes(item.status) : item.status === filter));
  const current = items[selected] || null;

  useEffect(() => { if (bundle) setSaved(readSaved(bundle)); }, [bundle]);

  const loadFile = async (file) => {
    setFeedback(null);
    try {
      const data = JSON.parse(await file.text());
      if (data?.version !== 1 || !Array.isArray(data.songs)) throw new Error('Ese archivo no es un borradores.json de la herramienta de importación.');
      setBundle(data); setDrafts({}); setMatches({}); setFilter('pendientes');
      setSelected(Math.max(0, data.songs.findIndex((row) => row.status !== 'omitida')));
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof SyntaxError ? 'El archivo no es un JSON válido.' : error.message });
    }
  };

  const approve = async (item) => {
    const chordpro = String(drafts[item.index] ?? item.chordpro ?? '').trim();
    if (!item.matchId || !chordpro) return false;
    await saveChordProGuarded({ id: item.matchId, titulo: item.target?.titulo || item.name }, chordpro);
    const next = { ...saved, [item.index]: true };
    setSaved(next);
    try { localStorage.setItem(storageKey(bundle), JSON.stringify(next)); } catch { /* solo comodidad */ }
    onSongUpdated?.({ ...item.target, chordpro });
    return true;
  };
  const approveOne = async () => {
    if (!current) return;
    setBusy('uno'); setFeedback(null);
    try { await approve(current); setFeedback({ kind: 'success', text: `ChordPro guardado en «${current.target?.titulo}».` }); }
    catch (error) { setFeedback({ kind: 'error', text: error.message }); }
    finally { setBusy(''); }
  };
  const ready = items.filter((item) => item.status === 'listo' && item.target && !hasChordPro(item.target.chordpro));
  const approveReady = async () => {
    setBusy('todas'); setFeedback(null);
    let done = 0; const failures = [];
    for (const item of ready) {
      try { if (await approve(item)) done += 1; } catch (error) { failures.push(error.message); }
    }
    setBusy('');
    setFeedback(failures.length ? { kind: 'error', text: `${done} guardadas. ${failures.join(' ')}` } : { kind: 'success', text: `${done} canciones guardadas.` });
  };

  if (!isAdmin) return <p className="p-6 text-sm text-content-muted">Solo un administrador puede importar ChordPro.</p>;

  return (
    <section className="mx-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-6 md:mx-4" data-chordpro-import="true">
      <QuickImport songs={songs} onSongUpdated={onSongUpdated} />
      <details className="rounded-2xl border border-border bg-surface/60 p-4" open={Boolean(bundle)}>
      <summary className="cursor-pointer text-sm font-bold text-content-muted">Importación masiva desde una carpeta (avanzado)</summary>
      <div className="mt-3 flex flex-col gap-3">
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <p className="mt-1 text-sm leading-relaxed text-content-muted">
              En la Mac ejecuta <code className="rounded bg-background px-1">npm run chordpro:importar -- "carpeta"</code> con tus capturas o PDF.
              Luego carga aquí <code className="rounded bg-background px-1">_alabanza/borradores.json</code>, revisa cada canción y apruébala.
              Solo se guarda en canciones sin ChordPro.
            </p>
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Seleccionar borradores.json"
            onChange={(event) => { const file = event.target.files?.[0]; if (file) loadFile(file); event.target.value = ''; }} />
          <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-sm hover:bg-brand/90">
            <FileUp className="h-4 w-4" />{bundle ? 'Cargar otro archivo' : 'Cargar borradores.json'}
          </button>
        </div>
        {bundle && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {['pendientes', 'listo', 'revisar', 'sin-coincidencia', 'guardada', 'omitida', 'error', 'todas'].map((key) => {
            const amount = key === 'todas' ? items.length : key === 'pendientes' ? visibleCount(items) : counts[key] || 0;
            if (!amount && !['pendientes', 'todas'].includes(key)) return null;
            return <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
              className={`rounded-full border px-2.5 py-1 font-semibold ${filter === key ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-background text-content-muted hover:text-content'}`}>
              {key === 'pendientes' ? 'Pendientes' : key === 'todas' ? 'Todas' : STATUS[key].label} · {amount}
            </button>;
          })}
          <span className="flex-1" />
          <button type="button" disabled={!ready.length || Boolean(busy)} onClick={approveReady}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-brand/30 px-3 font-bold text-brand hover:bg-brand/10 disabled:opacity-50">
            {busy === 'todas' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {ready.length === 1 ? 'Aprobar 1 lista sin revisión pendiente' : `Aprobar ${ready.length} listas sin revisión pendiente`}
          </button>
        </div>}
        {feedback && <p role="status" className={`mt-3 rounded-lg border px-3 py-2 text-xs font-semibold ${feedback.kind === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300' : 'border-emerald-500/25 bg-emerald-500/10 text-content'}`}>{feedback.text}</p>}
      </div>

      {bundle && <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <ol className="max-h-[70vh] overflow-y-auto rounded-2xl border border-border bg-surface p-2" aria-label="Canciones importadas">
          {visible.map((item) => <li key={item.index}>
            <button type="button" onClick={() => setSelected(item.index)} aria-current={item.index === selected ? 'true' : undefined}
              className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm ${item.index === selected ? 'bg-brand/10' : 'hover:bg-background'}`}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-content">{item.target?.titulo || item.name}</span>
                <span className="block truncate text-xs text-content-muted">{item.stats ? `${item.stats.verified}/${item.stats.lines} líneas verificadas` : item.notes || item.files?.join(', ')}</span>
              </span>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATUS[item.status]?.tone}`}>{item.review?.length && item.status === 'revisar' ? item.review.length : STATUS[item.status]?.label}</span>
            </button>
          </li>)}
          {!visible.length && <li className="p-3 text-sm text-content-muted">Nada en este filtro.</li>}
        </ol>

        {current && <article className="flex min-h-0 flex-col gap-3 rounded-2xl border border-border bg-surface p-4" aria-label={`Revisión de ${current.name}`}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">{current.files?.join(' · ')}</p>
              <p className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${STATUS[current.status]?.tone}`}>{STATUS[current.status]?.label}</p>
            </div>
            {current.chordpro && current.status !== 'guardada' && <label className="flex min-w-[16rem] flex-col gap-1 text-xs font-semibold text-content-muted">
              Canción del catálogo
              <select value={current.matchId} onChange={(event) => setMatches((all) => ({ ...all, [current.index]: event.target.value }))}
                className="h-10 rounded-xl border border-border bg-background px-3 text-sm font-semibold text-content" aria-label="Canción del catálogo">
                <option value="">Elige la canción…</option>
                {current.target && <option value={current.target.id}>{current.target.titulo}</option>}
                {withoutChordPro.filter((song) => String(song.id) !== String(current.target?.id)).map((song) => <option key={song.id} value={song.id}>{song.titulo}</option>)}
              </select>
            </label>}
          </div>
          {current.status === 'error' && <p className="flex items-center gap-2 text-sm text-red-600"><XCircle className="h-4 w-4" />{current.notes}</p>}
          {current.status === 'omitida' && <p className="text-sm text-content-muted">«{current.match?.titulo}» ya tenía ChordPro, así que no se transcribió ni se gastaron tokens.</p>}
          {!!current.review?.length && current.status !== 'guardada' && <ul className="space-y-1 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-content" aria-label="Por revisar">
            {current.review.map((row, k) => <li key={k} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <span>{row.line ? <strong>Línea {row.line}: </strong> : row.section ? <strong>[{row.section}]: </strong> : null}{row.reason}</span></li>)}
          </ul>}
          {current.chordpro && <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-2">
            <div className="max-h-[62vh] overflow-y-auto rounded-xl border border-border bg-background p-2" aria-label="Imágenes originales">
              {(current.images || []).map((src, k) => <img key={k} src={src} alt={`Original ${k + 1} de ${current.name}`} className="mb-2 w-full rounded-lg" />)}
            </div>
            <textarea value={drafts[current.index] ?? current.chordpro} disabled={current.status === 'guardada'}
              onChange={(event) => setDrafts((all) => ({ ...all, [current.index]: event.target.value }))}
              spellCheck={false} aria-label="ChordPro del borrador"
              className="min-h-[50vh] w-full resize-y rounded-xl border border-border bg-background p-3 font-mono text-sm leading-relaxed text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
          </div>}
          {current.chordpro && current.status !== 'guardada' && <div className="flex flex-wrap items-center justify-end gap-2">
            {current.target && hasChordPro(current.target.chordpro) && <p className="text-xs font-semibold text-amber-700">Esa canción ya tiene ChordPro: elige otra.</p>}
            <button type="button" onClick={approveOne} disabled={!current.matchId || Boolean(busy) || (current.target && hasChordPro(current.target.chordpro))}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-sm hover:bg-brand/90 disabled:opacity-50">
              {busy === 'uno' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Aprobar y guardar
            </button>
          </div>}
        </article>}
      </div>}
      </div>
      </details>
    </section>
  );
}

const visibleCount = (items) => items.filter((item) => ['listo', 'revisar', 'sin-coincidencia', 'error'].includes(item.status)).length;
