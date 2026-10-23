import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, CheckCircle2, Clock3, Download, FileAudio2, FileUp, LoaderCircle, Music2, RefreshCw, Upload, XCircle } from 'lucide-react';
import { formatReaperTime } from '../utils/reaperProjectParser.js';

const getSession = (raw) => {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
};

const trackName = (track = {}) => String(track.name || track.sourceFileName || track.id || 'Stem').trim() || 'Stem';
const normalize = (value = '') => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const categoryFor = (track) => {
  const label = normalize(`${trackName(track)} ${track.sourceFileName || ''} ${track.id || ''}`);
  if (/(clicktrack|cuetrack|click|clic|metronom|metro)/.test(label)) return '01 Click';
  if (/(guide|guia|talkback|voz guia)/.test(label)) return '02 Guide';
  return '03 Instrumentos';
};
const safeStemName = (track, index) => {
  const extension = String(track.sourceFileName || track.url || '').match(/\.(m4a|aac|wav|mp3|flac|ogg)(?:$|\?)/i)?.[1]?.toLowerCase() || 'm4a';
  const cleanName = trackName(track).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '') || `Stem ${index + 1}`;
  return `${String(index + 1).padStart(2, '0')} - ${cleanName}.${extension}`;
};
const formatSize = (bytes = 0) => {
  if (!bytes) return 'Tamaño pendiente';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
};
const formatDate = (value) => value ? new Date(value).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '';

export default function AdminReaperWorkspace({ songs = [], isAdmin = false }) {
  const eligibleSongs = useMemo(() => (songs || []).map((song) => ({ ...song, reaperSession: getSession(song.multitrack_session) }))
    .sort((a, b) => String(a.titulo || '').localeCompare(String(b.titulo || ''), 'es', { sensitivity: 'base' })), [songs]);
  const [songId, setSongId] = useState('');
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [projects, setProjects] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const fileInputRef = useRef(null);
  const selectedSong = eligibleSongs.find((song) => String(song.id) === String(songId)) || eligibleSongs[0] || null;
  const tracks = selectedSong?.reaperSession?.tracks || [];
  const totalDurationLabel = String(selectedSong?.duracion || selectedSong?.duration || '').trim();

  useEffect(() => {
    if (!songId && eligibleSongs[0]) setSongId(String(eligibleSongs[0].id));
    if (songId && !eligibleSongs.some((song) => String(song.id) === String(songId))) {
      setSongId(String(eligibleSongs[0]?.id || ''));
    }
  }, [eligibleSongs, songId]);

  useEffect(() => {
    let cancelled = false;
    setProjects([]);
    setAnalysis(null);
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

  const downloadStemPackage = async () => {
    if (!selectedSong || tracks.length === 0) return;
    setBusy('zip');
    setFeedback(null);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const safeTitle = String(selectedSong.titulo || 'Cancion').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._ -]/g, '_').trim() || 'Cancion';
      const missing = tracks.filter((track) => !String(track.url || '').trim()).map(trackName);
      if (missing.length) throw new Error(`A estas pistas les falta el archivo original: ${missing.join(', ')}.`);
      const manifestRows = [];
      let completed = 0;
      for (let index = 0; index < tracks.length; index += 1) {
        const track = tracks[index];
        setProgress(`Descargando ${index + 1} de ${tracks.length}: ${trackName(track)}`);
        const response = await fetch(track.url, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
        if (!response.ok) throw new Error(`No se pudo descargar “${trackName(track)}” (HTTP ${response.status}). Revisa que su archivo siga disponible.`);
        const blob = await response.blob();
        if (!blob.size) throw new Error(`El archivo “${trackName(track)}” llegó vacío.`);
        const archivePath = `${safeTitle}/${categoryFor(track)}/${safeStemName(track, index)}`;
        zip.file(archivePath, blob, { binary: true });
        manifestRows.push(`- ${categoryFor(track)} / ${safeStemName(track, index)} ← ${trackName(track)}${track.sourceFileName ? ` (${track.sourceFileName})` : ''}`);
        completed += 1;
      }
      const readme = [
        `Paquete REAPER: ${selectedSong.titulo || 'Canción'}`,
        `Tonalidad: ${selectedSong.tonalidad || 'Sin especificar'} · BPM registrado: ${selectedSong.bpm || 'Sin especificar'} · Compás: ${selectedSong.metrica || 'Por confirmar'}`,
        totalDurationLabel ? `Duración registrada: ${totalDurationLabel}` : '',
        '',
        'Los audios son stems originales separados. Importa cada archivo desde 00:00 y conserva su posición relativa; no los mezcles ni cambies el inicio.',
        'Usa Click y Guide en sus pistas propias. Alinea el primer pulso antes de marcar secciones. El RPP se sube aparte en el panel REAPER del administrador.',
        '',
        'Pistas incluidas:',
        ...manifestRows,
      ].filter(Boolean).join('\n');
      zip.file(`${safeTitle}/LEEME - Paquete REAPER.txt`, readme);
      setProgress(`Empaquetando ${completed} pistas…`);
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${safeTitle} - REAPER stems.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      setFeedback({ kind: 'success', text: `Listo: ${completed} stems separados en un solo ZIP.` });
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : 'Falló la descarga del paquete.' });
    } finally {
      setBusy('');
      setProgress('');
    }
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
      setProjects((previous) => [body.project, ...previous.filter((project) => project.key !== body.project.key)]);
      setFeedback({ kind: 'success', text: `RPP guardado para ${selectedSong.titulo}. La canción y sus marcadores originales no se modificaron.` });
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : 'Falló la carga del proyecto.' });
    } finally {
      setBusy('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-5 md:px-5">
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-brand"><Music2 className="h-4 w-4" /><p className="text-[11px] font-bold uppercase tracking-[0.18em]">Herramientas de administrador</p></div>
              <h2 className="mt-2 text-xl font-bold text-content md:text-2xl">Preparar una canción para REAPER</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-content-muted">Descarga todos los stems en un solo paquete ZIP y guarda aquí el RPP con el mapa de secciones. Cada audio permanece en su propia pista.</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />Separado de la canción original</span>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(15rem,0.75fr)]">
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-content">Canción del repertorio</span>
              <select value={selectedSong?.id || ''} onChange={(event) => { setSongId(event.target.value); setFeedback(null); }} disabled={!eligibleSongs.length || Boolean(busy)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-semibold text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60" aria-label="Canción para preparar en REAPER">
                {eligibleSongs.length ? eligibleSongs.map((song) => <option key={song.id} value={song.id}>{song.titulo} · {song.reaperSession?.tracks?.length || 0} stems</option>) : <option value="">No hay canciones disponibles</option>}
              </select>
            </label>
            <div className="flex items-end">
              <button type="button" onClick={downloadStemPackage} disabled={!selectedSong || !tracks.length || Boolean(busy)} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50">
                {busy === 'zip' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                {busy === 'zip' ? 'Preparando ZIP…' : 'Descargar stems para REAPER'}
              </button>
            </div>
          </div>

          {selectedSong && <div className="mt-4 rounded-xl border border-border bg-background/55 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-content">{tracks.length} pistas independientes</p>
              <p className="text-xs text-content-muted">{tracks.filter((track) => categoryFor(track) === '01 Click').length} Click · {tracks.filter((track) => categoryFor(track) === '02 Guide').length} Guide · {tracks.filter((track) => categoryFor(track) === '03 Instrumentos').length} instrumentos</p>
            </div>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {tracks.map((track, index) => <div key={`${track.id}-${index}`} className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-surface/70 px-2.5 py-2">
                <FileAudio2 className="h-4 w-4 shrink-0 text-brand" />
                <span className="truncate text-xs font-medium text-content" title={trackName(track)}>{String(index + 1).padStart(2, '0')} · {trackName(track)}</span>
                <span className="ml-auto shrink-0 text-[10px] text-content-muted">{categoryFor(track).replace(/^\d+ /, '')}</span>
              </div>)}
            </div>
          </div>}
          {progress && <p role="status" className="mt-3 text-xs font-medium text-content-muted">{progress}</p>}
        </section>

        <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-brand"><FileUp className="h-4 w-4" /><p className="text-[11px] font-bold uppercase tracking-[0.18em]">Proyecto de REAPER</p></div>
              <h3 className="mt-2 text-lg font-bold text-content">Subir el mapa de esta canción</h3>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-content-muted">El RPP queda guardado por canción aquí en Administración. Revisamos sus marcadores, tempo y compás sin sobrescribir los datos de reproducción.</p>
            </div>
            <input ref={fileInputRef} type="file" accept=".rpp,application/x-reaper-project" className="sr-only" aria-label="Seleccionar archivo RPP" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadProject(file); }} />
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
            {analysis.markers?.length ? <ol className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {analysis.markers.map((marker, index) => <li key={`${marker.id}-${index}`} className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface/75 px-2.5 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-semibold text-content" title={marker.name}>{marker.name}</span>
                <span className="shrink-0 tabular-nums text-content-muted">{formatReaperTime(marker.timeSeconds)}</span>
              </li>)}
            </ol> : <p className="mt-2 text-xs text-amber-600">El RPP no contiene marcadores de sección. Puedes guardarlo y añadirlos en REAPER después.</p>}
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
              <a href={`/api/admin-reaper-project?key=${encodeURIComponent(project.key)}`} download={project.fileName} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-bold text-content hover:border-brand/40 hover:text-brand"><Download className="h-3.5 w-3.5" />Descargar</a>
            </div>)}</div> : <p className="rounded-lg bg-background/55 px-3 py-2.5 text-xs text-content-muted">Todavía no hay un proyecto guardado para esta canción.</p>}
          </div>
        </section>

        {feedback && <div role={feedback.kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl border px-3.5 py-3 text-sm ${feedback.kind === 'error' ? 'border-red-500/25 bg-red-500/10 text-red-600' : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700'}`}>
          {feedback.kind === 'error' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{feedback.text}</span>
        </div>}

        <aside className="rounded-xl border border-border/80 bg-background/45 px-4 py-3 text-xs leading-relaxed text-content-muted">
          <strong className="text-content">Letras:</strong> guarda la letra y los acordes en ChordPro en la ficha de la canción. El RPP sirve para audio, tempo y marcadores; no hace falta meter la letra dentro del proyecto. Playback usa ChartBuilder para mostrar letras/acordes y sus cues MIDI pueden disparar software externo como ProPresenter.
        </aside>
      </div>
    </div>
  );
}
