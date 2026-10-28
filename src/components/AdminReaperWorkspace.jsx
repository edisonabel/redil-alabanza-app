import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, CheckCircle2, Clock3, Download, FileAudio2, FileUp, LoaderCircle, Music2, RefreshCw, Upload, XCircle } from 'lucide-react';
import { formatReaperTime, parseReaperProject, reviewReaperProject } from '../utils/reaperProjectParser.js';
import { resolveFetchableAudioUrl } from '../lib/audio-playback.js';
import { isClickCarrierUrl } from '../utils/silentClickCarrier.js';
import { buildPreparedReaperProject, getReaperDraftMarkers, measureReaperBlobDuration, readReaperSession, reaperMediaPath, reaperTrackCategory, reaperTrackName, safeReaperBaseName } from '../utils/reaperPreparation.js';

const getSession = readReaperSession;
const trackName = reaperTrackName;
const categoryFor = reaperTrackCategory;
const formatSize = (bytes = 0) => {
  if (!bytes) return 'Tamaño pendiente';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
};
const formatDate = (value) => value ? new Date(value).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const APPLY_BLOCKERS = new Set(['drafts', 'uno', 'end', 'invalid', 'tempo', 'audio-moved', 'no-media', 'unverified-media', 'trimmed', 'song', 'unbound', 'duplicate-anchor', 'duplicate-time', 'duplicate-name', 'duplicate-id', 'outside', 'tail', 'range', 'tempo-map', 'media-count']);
// Las canciones sin stems se preparan con su MP3; la pista virtual de click no cuenta como stem.
const stemLabel = (song) => {
  const stems = (song.reaperSession?.tracks || []).filter((track) => !isClickCarrierUrl(track.url)).length;
  return stems ? `${stems} stems` : String(song.mp3 || '').trim() ? 'MP3' : 'sin audio';
};
const isAnchor = (name) => /^(uno|fin audio)$/i.test(String(name || '').replace(/^\[BORRADOR\]\s*/i, '').trim());

export default function AdminReaperWorkspace({ songs = [], isAdmin = false }) {
  const eligibleSongs = useMemo(() => (songs || []).map((song) => ({ ...song, reaperSession: getSession(song.multitrack_session) }))
    .sort((a, b) => String(a.titulo || '').localeCompare(String(b.titulo || ''), 'es', { sensitivity: 'base' })), [songs]);
  const [songId, setSongId] = useState('');
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [projects, setProjects] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [activeProjectKey, setActiveProjectKey] = useState('');
  const [excludedMarkerIds, setExcludedMarkerIds] = useState([]);
  const [appliedProjectKey, setAppliedProjectKey] = useState('');
  const [wizardStep, setWizardStep] = useState(1);
  const [packageReady, setPackageReady] = useState(false);
  const fileInputRef = useRef(null);
  const selectedSong = eligibleSongs.find((song) => String(song.id) === String(songId)) || eligibleSongs[0] || null;
  // La pista virtual de click no es un stem: una canción que solo la tiene se trata como sin stems.
  const tracks = (Array.isArray(selectedSong?.reaperSession?.tracks) ? selectedSong.reaperSession.tracks : [])
    .filter((track) => !isClickCarrierUrl(track.url));
  // Sin stems, el proyecto lleva el MP3 final de la canción solo como referencia para marcar los tiempos.
  const referenceTrack = !tracks.length && String(selectedSong?.mp3 || '').trim()
    ? { id: 'referencia-mp3', name: 'Canción (referencia)', url: resolveFetchableAudioUrl(selectedSong.mp3, { preferSameOrigin: true }), sourceFileName: 'referencia.mp3' }
    : null;
  const packageTracks = tracks.length ? tracks : referenceTrack ? [referenceTrack] : [];
  const draftCount = useMemo(() => {
    try { return getReaperDraftMarkers(selectedSong || {}).markers.length; } catch { return 0; }
  }, [selectedSong]);

  // The REAPER helper opens /admin?area=reaper&song=<id>&paso=subir after saving the RPP.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('paso') === 'subir') setWizardStep(3);
  }, []);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('song');
    if (!songId && requested && eligibleSongs.some((song) => String(song.id) === requested)) { setSongId(requested); return; }
    if (!songId && eligibleSongs[0]) setSongId(String(eligibleSongs[0].id));
    if (songId && !eligibleSongs.some((song) => String(song.id) === String(songId))) {
      setSongId(String(eligibleSongs[0]?.id || ''));
    }
  }, [eligibleSongs, songId]);

  useEffect(() => {
    let cancelled = false;
    setProjects([]);
    setAnalysis(null);
    setActiveProjectKey('');
    setExcludedMarkerIds([]);
    setAppliedProjectKey('');
    if (!selectedSong) return () => { cancelled = true; };
    fetch(`/api/admin-reaper-project?songId=${encodeURIComponent(selectedSong.id)}`, { credentials: 'same-origin' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'No pude consultar los proyectos RPP guardados.');
        if (!cancelled) setProjects(Array.isArray(body.projects) ? body.projects : []);
      })
      .catch((error) => { if (!cancelled) setFeedback({ kind: 'error', text: error.message }); });
    return () => { cancelled = true; };
  }, [selectedSong?.id]);

  useEffect(() => {
    if (!analysis) return;
    const isDigno = /digno\s+y\s+santo/i.test(String(selectedSong?.titulo || ''));
    setExcludedMarkerIds(isDigno ? analysis.markers.filter((marker) => !isAnchor(marker.name) && /^outro$/i.test(String(marker.name).replace(/^\[BORRADOR\]\s*/i, '').trim())).map((marker) => marker.id) : []);
    setAppliedProjectKey('');
  }, [analysis?.markers, selectedSong?.id]);

  const downloadStemPackage = async () => {
    if (!selectedSong || packageTracks.length === 0) return;
    setBusy('zip');
    setFeedback(null);
    let totalBytes = 0;
    const maxBytes = 512 * 1024 * 1024;
    const getFile = async (url, label = 'archivo del paquete') => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 120000);
      try {
        const sameOrigin = String(url).startsWith('/') || String(url).startsWith(`${window.location.origin}/`);
        const response = await fetch(url, { mode: 'cors', credentials: sameOrigin ? 'same-origin' : 'omit', cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`No pude descargar “${label}” (HTTP ${response.status}). Reintenta.`);
        if (totalBytes + Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('El paquete supera 512 MB. Usa un proyecto manual para esta canción.');
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No pude leer un archivo del paquete. Reintenta.');
        const chunks = [];
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
              await reader.cancel();
              throw new Error('El paquete supera 512 MB. Usa un proyecto manual para esta canción.');
            }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        const blob = new Blob(chunks, { type: response.headers.get('content-type') || '' });
        if (!blob.size) throw new Error('Uno de los archivos llegó vacío. Reintenta.');
        return blob;
      } finally { window.clearTimeout(timeout); }
    };
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const safeTitle = safeReaperBaseName(selectedSong.titulo);
      const missing = packageTracks.filter((track) => !String(track.url || '').trim()).map(trackName);
      if (missing.length) throw new Error(`A estas pistas les falta el archivo original: ${missing.join(', ')}.`);
      const preparedTracks = [];
      for (let index = 0; index < packageTracks.length; index += 1) {
        const track = packageTracks[index];
        setProgress(`Descargando ${index + 1} de ${packageTracks.length}: ${trackName(track)}`);
        const blob = await getFile(track.url, trackName(track));
        setProgress(`Preparando ${index + 1} de ${packageTracks.length}: ${trackName(track)}`);
        const durationSeconds = await measureReaperBlobDuration(blob, trackName(track));
        const mediaPath = reaperMediaPath(track, index);
        zip.file(`${safeTitle}/${mediaPath}`, blob, { binary: true });
        preparedTracks.push({ ...track, mediaPath, durationSeconds });
      }
      const { projectText, manifest } = buildPreparedReaperProject({ song: selectedSong, tracks: preparedTracks });
      const [assistant, instructions, visualGuide] = await Promise.all([
        getFile('/downloads/Alabanza-Asistente.lua', 'asistente de REAPER'),
        getFile('/downloads/Alabanza-REAPER-Instrucciones.md', 'instrucciones'),
        getFile('/downloads/Alabanza-REAPER-Guia-visual.pdf', 'guía visual'),
      ]);
      const assistantHeader = (await assistant.slice(0, 32).text());
      const instructionsHeader = (await instructions.slice(0, 32).text());
      const pdfHeader = new TextDecoder().decode(await visualGuide.slice(0, 5).arrayBuffer());
      if (!assistantHeader.startsWith('-- Alabanza:') || !instructionsHeader.startsWith('# Guía') || pdfHeader !== '%PDF-') {
        throw new Error('No pude recuperar el asistente o la guía. Recarga la página y reintenta.');
      }
      zip.file(`${safeTitle}/${safeTitle} - revisar.RPP`, projectText);
      zip.file(`${safeTitle}/Alabanza-Asistente.lua`, assistant);
      zip.file(`${safeTitle}/INSTRUCCIONES.md`, instructions);
      zip.file(`${safeTitle}/Guia-visual-REAPER.pdf`, visualGuide);
      zip.file(`${safeTitle}/Mapa-original.json`, JSON.stringify(manifest, null, 2));
      setProgress(`Empaquetando el proyecto y sus ${packageTracks.length} pistas…`);
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${safeTitle} - REAPER preparado.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      setFeedback({ kind: 'success', text: `Listo: RPP, ${tracks.length ? `${tracks.length} stems` : 'el MP3 de referencia'}, asistente y guía visual incluidos. Descomprime el ZIP y abre el RPP.${manifest.omittedMarkers.length ? ` Hay ${manifest.omittedMarkers.length} secciones sin tiempo válido; añádelas en REAPER.` : ''}` });
      setPackageReady(true);
      setWizardStep(2);
    } catch (error) {
      setFeedback({ kind: 'error', text: error?.name === 'AbortError' ? 'Se agotó el tiempo de descarga. Reintenta el paquete.' : error instanceof Error ? error.message : 'Falló la preparación del paquete.' });
    } finally {
      setBusy('');
      setProgress('');
    }
  };

  const inspectSavedProject = async (project) => {
    if (!selectedSong || busy) return;
    setBusy(project.key);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin-reaper-project?key=${encodeURIComponent(project.key)}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('No pude abrir el RPP guardado. Reintenta.');
      const parsed = parseReaperProject(await response.text());
      setAnalysis({ ...parsed, review: reviewReaperProject(parsed, selectedSong) });
      setActiveProjectKey(project.key);
    } catch (error) { setFeedback({ kind: 'error', text: error.message }); }
    finally { setBusy(''); }
  };

  const uploadProject = async (file) => {
    if (!selectedSong || !file) return;
    setBusy('upload');
    setFeedback(null);
    setAnalysis(null);
    try {
      const response = await fetch(`/api/admin-reaper-project?songId=${encodeURIComponent(selectedSong.id)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/x-reaper-project',
          'x-file-name': encodeURIComponent(file.name),
        },
        body: file,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo guardar el proyecto REAPER.');
      setAnalysis(body.analysis || null);
      setActiveProjectKey(body.project?.key || '');
      setProjects((previous) => [body.project, ...previous.filter((project) => project.key !== body.project.key)]);
      setFeedback({ kind: 'success', text: `RPP guardado para ${selectedSong.titulo}. La canción y sus marcadores originales no se modificaron.` });
      setWizardStep(3);
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : 'Falló la carga del proyecto.' });
    } finally {
      setBusy('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const applyProjectMap = async () => {
    if (!selectedSong || !analysis || !activeProjectKey || busy) return;
    const blockers = (analysis.review?.issues || []).filter((issue) => APPLY_BLOCKERS.has(issue.code));
    if (blockers.length) {
      setFeedback({ kind: 'error', text: `Antes de aplicar, corrige en REAPER: ${blockers.map((issue) => issue.message).join(' ')}` });
      return;
    }
    const sections = analysis.markers.filter((marker) => !isAnchor(marker.name));
    const isDigno = /digno\s+y\s+santo/i.test(String(selectedSong.titulo || ''));
    const chosen = sections.filter((marker) => !excludedMarkerIds.includes(marker.id) && !(isDigno && /^outro$/i.test(marker.name.trim())));
    if (!chosen.length) {
      setFeedback({ kind: 'error', text: 'Selecciona al menos una sección para aplicar.' });
      return;
    }
    if (isDigno && (chosen.some((marker) => /^outro$/i.test(marker.name.trim())) || !chosen.some((marker) => /^final$/i.test(marker.name.trim())))) {
      setFeedback({ kind: 'error', text: 'Para Digno y Santo, excluye Outro y conserva Final, como indicaste.' });
      return;
    }
    const summary = `Aplicar ${chosen.length} secciones de ${selectedSong.titulo} al multitrack. Esto actualiza solo el mapa de la sesión multitrack; conserva las secciones originales, las letras y los arreglos de eventos.${isDigno ? '\n\nSe excluirá Outro y se conservará Final.' : ''}`;
    if (!window.confirm(summary)) return;
    setBusy('apply');
    setFeedback(null);
    try {
      const response = await fetch('/api/admin-reaper-project', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ songId: selectedSong.id, key: activeProjectKey, markerIds: chosen.map((marker) => marker.id) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo aplicar el mapa al multitrack.');
      setAppliedProjectKey(activeProjectKey);
      setAnalysis((current) => current ? { ...current, review: { ...current.review, appliedToPlayback: true } } : current);
      setFeedback({ kind: 'success', text: `Mapa aplicado a ${selectedSong.titulo}: ${body.sectionMarkers.length} secciones guardadas en su sesión multitrack. Reabre la canción en Live Director para cargar el mapa actualizado.` });
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : 'Falló la aplicación del mapa.' });
    } finally { setBusy(''); }
  };

  if (!isAdmin) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-5 md:px-5">
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <header className="rounded-2xl border border-border bg-surface px-4 py-4 shadow-sm md:px-6">
          <div className="flex items-center gap-2 text-brand"><Music2 className="h-4 w-4" /><p className="text-[11px] font-bold uppercase tracking-[0.18em]">Herramientas de administrador</p></div>
          <h2 className="mt-1 text-xl font-bold text-content md:text-2xl">Preparar secciones en REAPER</h2>
          <nav aria-label="Pasos para preparar un proyecto de REAPER" className="mt-4 grid grid-cols-3 gap-2">
            {[['1', 'Preparar'], ['2', 'Editar en REAPER'], ['3', 'Subir y aplicar']].map(([number, title], index) => {
              const step = index + 1;
              const active = wizardStep === step;
              const complete = step === 1 ? packageReady : step === 2 ? Boolean(analysis && activeProjectKey) : false;
              return <button key={number} type="button" onClick={() => setWizardStep(step)} aria-current={active ? 'step' : undefined} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-2 py-2 text-xs font-bold transition sm:text-sm ${active ? 'border-brand bg-brand/10 text-brand' : complete ? 'border-emerald-500/25 bg-emerald-500/5 text-content' : 'border-border bg-background/50 text-content-muted hover:text-content'}`}>
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] ${active ? 'bg-brand text-white' : complete ? 'bg-emerald-600 text-white' : 'bg-border text-content-muted'}`}>{complete ? '✓' : number}</span><span>{title}</span>
              </button>;
            })}
          </nav>
        </header>

        {wizardStep === 1 && <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-content">Descarga el proyecto de la canción</h3>
              <p className="mt-1 max-w-2xl text-sm text-content-muted">Recibirás un ZIP con sus stems, el RPP y el asistente listos para REAPER.</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />No altera el original</span>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(15rem,0.75fr)]">
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-content">Canción del repertorio</span>
              <select value={selectedSong?.id || ''} onChange={(event) => { setSongId(event.target.value); setFeedback(null); setPackageReady(false); }} disabled={!eligibleSongs.length || Boolean(busy)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-semibold text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60" aria-label="Canción para preparar en REAPER">
                {eligibleSongs.length ? eligibleSongs.map((song) => <option key={song.id} value={song.id}>{song.titulo} · {stemLabel(song)}</option>) : <option value="">No hay canciones disponibles</option>}
              </select>
            </label>
            <div className="flex items-end">
              <button type="button" onClick={downloadStemPackage} disabled={!selectedSong || !packageTracks.length || Boolean(busy)} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50">
                {busy === 'zip' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                {busy === 'zip' ? 'Preparando proyecto…' : tracks.length || !referenceTrack ? 'Descargar proyecto + stems' : 'Descargar proyecto (MP3)'}
              </button>
            </div>
          </div>

          {selectedSong && <details className="mt-3 rounded-xl border border-border bg-background/45 p-3">
            <summary className="cursor-pointer text-xs font-bold text-content">Ver stems incluidos ({tracks.length})</summary>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold text-content">{tracks.length} pistas · {draftCount} entradas iniciales</p>
              <p className="text-xs text-content-muted">{tracks.filter((track) => categoryFor(track) === '01 Click').length} Click · {tracks.filter((track) => categoryFor(track) === '02 Guide').length} Guide · {tracks.filter((track) => categoryFor(track) === '03 Instrumentos').length} instrumentos</p>
            </div>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {tracks.map((track, index) => <div key={`${track.id}-${index}`} className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-surface/70 px-2.5 py-2">
                <FileAudio2 className="h-4 w-4 shrink-0 text-brand" />
                <span className="truncate text-xs font-medium text-content" title={trackName(track)}>{String(index + 1).padStart(2, '0')} · {trackName(track)}</span>
                <span className="ml-auto shrink-0 text-[10px] text-content-muted">{categoryFor(track).replace(/^\d+ /, '')}</span>
              </div>)}
            </div>
          </details>}
          {progress && <p role="status" className="mt-3 text-xs font-medium text-content-muted">{progress}</p>}
          <div className="mt-4 flex justify-end"><button type="button" onClick={() => setWizardStep(2)} className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-content hover:border-brand/40 hover:text-brand">Continuar al paso 2</button></div>
        </section>}

        {wizardStep === 2 && <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm md:p-6">
          <h3 className="text-lg font-bold text-content">Edita las entradas en REAPER</h3>
          <p className="mt-1 text-sm text-content-muted">Abre el RPP del ZIP, confirma UNO y las secciones con el asistente, y guarda.</p>
          <a href="/downloads/Alabanza-REAPER-Guia-visual.pdf" download className="mt-4 flex min-h-14 items-center justify-between gap-3 rounded-xl border border-brand/20 bg-brand/[0.045] px-4 py-3 text-sm font-bold text-brand hover:bg-brand/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"><span className="inline-flex items-center gap-2"><Download className="h-4 w-4" />Descargar guía visual paso a paso</span><span className="shrink-0 text-xs font-semibold text-content-muted">PDF · capturas de REAPER</span></a>
          <details className="mt-3 rounded-xl border border-border bg-background/45 p-3">
            <summary className="cursor-pointer text-sm font-bold text-content">Ver pasos rápidos</summary>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-content-muted">
              <li>Descomprime el ZIP y abre <strong className="text-content">- revisar.RPP</strong>.</li>
              <li>En REAPER: Actions → Show action list → New action → Load ReaScript; carga el asistente y pulsa Run.</li>
              <li>Confirma UNO, mide el tempo con compases completos y confirma cada entrada en su primer tiempo.</li>
              <li>Marca FIN AUDIO al acabar las colas y guarda el RPP.</li>
            </ol>
            <a href="/downloads/Alabanza-REAPER-Instrucciones.md" download className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-bold text-content hover:border-brand/40 hover:text-brand"><Download className="h-3.5 w-3.5" />Descargar referencia en texto</a>
          </details>
          <div className="mt-4 flex justify-between"><button type="button" onClick={() => setWizardStep(1)} className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-content-muted hover:text-content">Volver</button><button type="button" onClick={() => setWizardStep(3)} className="rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand/90">Ya guardé mi RPP</button></div>
        </section>}

        {wizardStep === 3 && <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-brand"><FileUp className="h-4 w-4" /><p className="text-[11px] font-bold uppercase tracking-[0.18em]">Proyecto de REAPER</p></div>
              <h3 className="mt-2 text-lg font-bold text-content">Sube, revisa y aplica el mapa</h3>
              <p className="mt-1 max-w-2xl text-sm text-content-muted">Selecciona el RPP guardado. Confirma el informe y pulsa aplicar para actualizar solo el multitrack.</p>
            </div>
            <input ref={fileInputRef} type="file" accept=".rpp,application/x-reaper-project" className="sr-only" disabled={Boolean(busy)} aria-label="Seleccionar archivo RPP" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadProject(file); }} />
            <div className="flex flex-wrap items-center gap-2">
              <a href="/downloads/Alabanza%20-%20Mapear%20secciones.RPP" download="Alabanza - Mapear secciones.RPP" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3.5 text-sm font-bold text-content transition hover:border-brand/40 hover:text-brand"><Download className="h-4 w-4" />Descargar plantilla vacía</a>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!selectedSong || Boolean(busy)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3.5 text-sm font-bold text-content transition hover:border-brand/40 hover:text-brand disabled:opacity-50">
                {busy === 'upload' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {busy === 'upload' ? 'Revisando y guardando…' : 'Elegir archivo .RPP'}
              </button>
            </div>
          </div>

          {analysis && <div className="mt-4 rounded-xl border border-brand/20 bg-brand/[0.045] p-3.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-bold text-content">
              <span>{analysis.tempo ? `Tempo inicial ${analysis.tempo} BPM` : 'Tempo inicial sin leer'}</span>
              <span>Compás inicial {analysis.meter || 'sin leer'}</span>
              <span>{analysis.markerCount} marcadores</span>
            </div>
            {analysis.review && <div className="mt-3 space-y-3">
              <p className={`rounded-lg border px-3 py-2 text-xs font-semibold ${analysis.review.status === 'checks-passed' ? 'border-emerald-500/25 bg-emerald-500/10 text-content' : 'border-amber-500/25 bg-amber-500/10 text-content'}`} role="status">
                {analysis.review.appliedToPlayback ? 'Mapa aplicado a la sesión multitrack.' : analysis.review.status === 'checks-passed' ? 'Comprobaciones estructurales correctas. Revisa el mapa y aplícalo cuando esté listo.' : 'Hay puntos por revisar en REAPER.'}
              </p>
              {!!analysis.review.issues.length && <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-content-muted">{analysis.review.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>}
              {!!analysis.review.comparisons.length && <details className="rounded-lg border border-border bg-surface/70 p-3">
                <summary className="cursor-pointer text-xs font-bold text-content">Comparar entradas con el mapa actual</summary>
                <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs tabular-nums"><thead><tr className="text-content-muted"><th scope="col" className="py-2 pr-3">Sección</th><th scope="col" className="pr-3">Antes</th><th scope="col" className="pr-3">RPP</th><th scope="col">Cambio</th></tr></thead><tbody>{analysis.review.comparisons.map((row, index) => <tr key={index} className="border-t border-border text-content"><td className="py-2 pr-3">{row.name}</td><td className="whitespace-nowrap pr-3">{row.beforeSeconds == null ? 'Nueva' : formatReaperTime(row.beforeSeconds)}</td><td className="whitespace-nowrap pr-3">{formatReaperTime(row.afterSeconds)}</td><td className="whitespace-nowrap">{row.deltaSeconds == null ? '—' : `${row.deltaSeconds >= 0 ? '+' : ''}${row.deltaSeconds.toFixed(3)} s`}</td></tr>)}</tbody></table></div>
              </details>}
            </div>}
            {analysis.markers?.length ? <ol className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {analysis.markers.map((marker, index) => <li key={`${marker.id}-${index}`} className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface/75 px-2.5 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-semibold text-content" title={marker.name}>{marker.name}</span>
                <span className="shrink-0 tabular-nums text-content-muted">{formatReaperTime(marker.timeSeconds)}</span>
              </li>)}
            </ol> : <p className="mt-2 text-xs text-amber-600">El RPP no contiene marcadores de sección. Puedes guardarlo y añadirlos en REAPER después.</p>}
            {!!analysis.markers?.some((marker) => !isAnchor(marker.name)) && <div className="mt-4 rounded-xl border border-border bg-surface/75 p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-sm font-bold text-content">Secciones que se aplicarán al multitrack</p><p className="mt-1 text-xs leading-relaxed text-content-muted">Esta elección solo cambia la sesión multitrack de la canción. Las secciones originales, letras y arreglos de eventos quedan intactos.</p></div>
                <button type="button" onClick={applyProjectMap} disabled={!activeProjectKey || Boolean(busy) || !analysis.markers.some((marker) => !isAnchor(marker.name) && !excludedMarkerIds.includes(marker.id)) || (analysis.review?.issues || []).some((issue) => APPLY_BLOCKERS.has(issue.code)) || appliedProjectKey === activeProjectKey} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50">
                  {busy === 'apply' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : appliedProjectKey === activeProjectKey ? <CheckCircle2 className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                  {busy === 'apply' ? 'Aplicando mapa…' : appliedProjectKey === activeProjectKey ? 'Mapa aplicado' : 'Aplicar mapa al multitrack'}
                </button>
              </div>
              <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">{analysis.markers.filter((marker) => !isAnchor(marker.name)).map((marker) => {
                const isDigno = /digno\s+y\s+santo/i.test(String(selectedSong?.titulo || ''));
                const checked = !excludedMarkerIds.includes(marker.id) && !(isDigno && /^outro$/i.test(marker.name.trim()));
                return <label key={`apply-${marker.id}`} className={`flex min-h-10 items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${checked ? 'border-brand/20 bg-background/75' : 'border-border bg-background/35 opacity-60'}`}>
                  <input type="checkbox" checked={checked} disabled={Boolean(busy) || appliedProjectKey === activeProjectKey || (isDigno && /^outro$/i.test(marker.name.trim()))} onChange={(event) => setExcludedMarkerIds((current) => event.target.checked ? current.filter((id) => id !== marker.id) : [...current, marker.id])} className="h-4 w-4 accent-brand" />
                  <span className="min-w-0 flex-1 truncate font-semibold text-content">{marker.name.replace(/^\[BORRADOR\]\s*/i, '')}</span><span className="shrink-0 tabular-nums text-content-muted">{formatReaperTime(marker.timeSeconds)}</span>
                </label>;
              })}</div>
              {!!analysis.instructions?.length && <div className="mt-3">
                <p className="text-xs font-bold text-content">Instrucciones ({analysis.instructions.length})</p>
                <p className="mt-0.5 text-xs text-content-muted">Avisos hablados que se aplican con el mapa; no crean ni mueven secciones.</p>
                <ol className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">{analysis.instructions.map((cue) => <li key={`cue-${cue.id}`} className="flex min-h-9 items-center gap-2 rounded-lg border border-border/70 bg-background/50 px-2.5 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate font-semibold text-content">{cue.name}</span><span className="shrink-0 tabular-nums text-content-muted">{formatReaperTime(cue.timeSeconds)}</span>
                </li>)}</ol>
              </div>}
              {/digno\s+y\s+santo/i.test(String(selectedSong?.titulo || '')) && <p className="mt-2 text-xs font-medium text-content-muted">Según tu indicación, <strong>Outro</strong> queda excluido y <strong>Final</strong> se conserva.</p>}
              {(analysis.review?.issues || []).some((issue) => APPLY_BLOCKERS.has(issue.code)) && <p className="mt-2 text-xs font-semibold text-amber-700">El botón se habilitará cuando corrijas los avisos que afectan la integridad del mapa.</p>}
            </div>}
          </div>}

          <div className="mt-4 border-t border-border pt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-content">RPP guardados para {selectedSong?.titulo || 'esta canción'}</p>
              <button type="button" title="Actualizar lista" aria-label="Actualizar lista de proyectos REAPER" onClick={() => selectedSong && fetch(`/api/admin-reaper-project?songId=${encodeURIComponent(selectedSong.id)}`).then((response) => response.json()).then((body) => setProjects(body.projects || [])).catch(() => {})} className="rounded-lg p-1.5 text-content-muted hover:bg-background hover:text-content"><RefreshCw className="h-3.5 w-3.5" /></button>
            </div>
            {projects.length ? <div className="space-y-1.5">{projects.map((project) => <div key={project.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background/50 px-3 py-2">
              <FileAudio2 className="h-4 w-4 shrink-0 text-content-muted" />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-content">{project.fileName}</span>
              <span className="inline-flex items-center gap-1 text-[10px] text-content-muted"><Clock3 className="h-3 w-3" />{formatDate(project.updatedAt)}</span>
              <span className="text-[10px] text-content-muted">{formatSize(project.size)}</span>
              <button type="button" disabled={Boolean(busy)} onClick={() => inspectSavedProject(project)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-bold text-content hover:text-brand disabled:opacity-50">{busy === project.key ? 'Revisando…' : 'Revisar'}</button>
              <a href={`/api/admin-reaper-project?key=${encodeURIComponent(project.key)}`} download={project.fileName} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-bold text-content hover:border-brand/40 hover:text-brand"><Download className="h-3.5 w-3.5" />Descargar</a>
            </div>)}</div> : <p className="rounded-lg bg-background/55 px-3 py-2.5 text-xs text-content-muted">Todavía no hay un proyecto guardado para esta canción.</p>}
          </div>
          <div className="mt-4 flex justify-start"><button type="button" onClick={() => setWizardStep(2)} className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-content-muted hover:text-content">Volver a la guía</button></div>
        </section>}

        {feedback && <div role={feedback.kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl border px-3.5 py-3 text-sm ${feedback.kind === 'error' ? 'border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-300' : 'border-emerald-500/25 bg-emerald-500/10 text-content'}`}>
          {feedback.kind === 'error' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{feedback.text}</span>
        </div>}

      </div>
    </div>
  );
}
