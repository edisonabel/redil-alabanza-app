// Preparation only: no catalog, ChordPro, event or playback writes.
export const REAPER_DRAFT_PREFIX = '[BORRADOR] ';
// Instruction markers (Sube intensidad, Hits…) speak a cue but never start a section.
export const REAPER_INSTRUCTION_PREFIX = '[INSTRUCCIÓN] ';
export const REAPER_INSTRUCTION_PATTERN = /^\[INSTRUCCI[OÓ]N\]\s*/i;
export const REAPER_PACKAGE_VERSION = 1;
export const readReaperSession = (raw) => {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || 'null'); } catch { return null; }
};
const clean = (value = '') => String(value).replace(/[\r\n\t]/g, ' ').trim();
const quote = (value) => `"${clean(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const precise = (value) => Number(value.toFixed(9)).toString();
const normalized = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const reaperTrackName = (track = {}) => clean(track.name || track.sourceFileName || track.id || 'Stem');
export const reaperTrackCategory = (track = {}) => {
  const label = normalized(`${reaperTrackName(track)} ${track.sourceFileName || ''} ${track.id || ''}`);
  if (/(clicktrack|cuetrack|click|clic|metronom|metro)/.test(label)) return '01 Click';
  if (/(guide|guia|talkback|voz guia)/.test(label)) return '02 Guide';
  return '03 Instrumentos';
};
export const safeReaperBaseName = (value = '') => clean(value).normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._ -]/g, '_')
  .replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 100) || 'Cancion';
export const reaperMediaPath = (track, index) => {
  const extension = String(track.sourceFileName || track.url || '').match(/\.(m4a|aac|wav|mp3|flac|ogg)(?:$|[?#])/i)?.[1]?.toLowerCase();
  if (!extension) throw new Error(`No reconozco el formato de “${reaperTrackName(track)}”. Conserva la extensión del archivo original.`);
  return `Media/${reaperTrackCategory(track)}/${String(index + 1).padStart(2, '0')} - ${safeReaperBaseName(reaperTrackName(track))}.${extension}`;
};

export function getReaperDraftMarkers(song = {}) {
  const session = readReaperSession(song.multitrack_session);
  const offset = Number(session?.sectionOffsetSeconds ?? 0);
  if (!Number.isFinite(offset)) throw new Error('El desfase de las secciones no es válido.');
  const rows = Array.isArray(song.section_markers) ? song.section_markers : readReaperSession(song.section_markers);
  const omitted = [];
  const markers = (Array.isArray(rows) ? rows : []).flatMap((marker, index) => {
    const rawTime = marker?.startSec;
    const time = rawTime == null || rawTime === '' ? NaN : Number(rawTime) + offset;
    const name = clean(marker?.sectionName || marker?.name || `Sección ${index + 1}`);
    if (!Number.isFinite(time) || time < 0) { omitted.push(name); return []; }
    return [{ id: index + 1, sectionKey: marker.sectionKey || null, name, timeSeconds: time }];
  });
  // IDs retain the original section order even when draft times are incorrect.
  return { markers, omitted, offset };
}

export function buildPreparedReaperProject({ song, tracks }) {
  if (!tracks?.length) throw new Error('Esta canción no tiene stems para preparar.');
  for (const track of tracks) {
    if (!Number.isFinite(track.durationSeconds) || track.durationSeconds <= 0) {
      throw new Error(`No pude medir la duración de “${reaperTrackName(track)}”. No generaré un proyecto con audio recortado.`);
    }
    if (!/^Media\/(01 Click|02 Guide|03 Instrumentos)\/[^/\\]+\.(m4a|aac|wav|mp3|flac|ogg)$/i.test(track.mediaPath || '')) {
      throw new Error('La ruta del stem no es válida.');
    }
  }
  const drafts = getReaperDraftMarkers(song);
  const duration = Math.max(...tracks.map((track) => track.durationSeconds));
  const bpm = Number(song.bpm);
  const meter = clean(song.metrica).match(/^(\d+)\/(\d+)$/);
  const numerator = meter ? Number(meter[1]) : 4;
  const denominator = meter ? Number(meter[2]) : 4;
  const tempo = Number.isFinite(bpm) && bpm >= 20 && bpm <= 400 ? bpm : 120;
  const validMeter = numerator > 0 && numerator <= 32 && [1, 2, 4, 8, 16, 32].includes(denominator);
  const markers = [...drafts.markers.map((marker) => ({ ...marker, name: `${REAPER_DRAFT_PREFIX}${marker.name}` })),
    { id: 10001, name: `${REAPER_DRAFT_PREFIX}FIN AUDIO`, timeSeconds: duration }];
  const notes = [
    `ALABANZA_MAPA_V1:${clean(song.id)}`,
    `Canción: ${clean(song.titulo)}`,
    'Marcadores BORRADOR: corrige y confirma cada entrada con el asistente.',
    'Tempo y compás iniciales pendientes de verificación. No mover ni estirar los audios.',
    `Desfase de origen ya aplicado a los marcadores: ${drafts.offset} s. No volver a sumarlo.`,
    ...tracks.map((track) => `ALABANZA_MEDIA_V1:${encodeURIComponent(track.mediaPath)}:${precise(track.durationSeconds)}`),
  ];
  const sourceType = (path) => ({ wav: 'WAVE', mp3: 'MP3', flac: 'FLAC', ogg: 'VORBIS' }[path.split('.').at(-1).toLowerCase()] || 'VIDEO');
  const lines = [
    '<REAPER_PROJECT 0.1 "7.82" 0 0', '  <NOTES 0 2', ...notes.map((line) => `    |${line}`), '  >',
    '  RIPPLE 0', '  TIMELOCKMODE 0', '  TEMPOENVLOCKMODE 0', '  PLAYRATE 1 0 0.25 4',
    `  TEMPO ${tempo} ${validMeter ? numerator : 4} ${validMeter ? denominator : 4} 0`,
    '  SAMPLERATE 44100 0 0', '  MASTER_VOLUME 0.251188643150958', '  MASTER_NCH 2',
    '  MASTERHWOUT 0 0 1 0 0 0 0 -1',
    '  <METRONOME 6 2', '    VOL 0.25 0.125', '    BEATLEN 4', '  >',
    ...markers.map((marker) => `  MARKER ${marker.id} ${precise(marker.timeSeconds)} ${quote(marker.name)} 0 0 1`),
  ];
  const musicCount = tracks.filter((track) => reaperTrackCategory(track) === '03 Instrumentos').length;
  for (const track of tracks) {
    const category = reaperTrackCategory(track);
    const gain = category === '03 Instrumentos' ? 0.5 / Math.sqrt(Math.max(musicCount, 1)) : 0.35;
    lines.push('  <TRACK', `    NAME ${quote(reaperTrackName(track))}`, '    BEAT 0',
      `    VOLPAN ${precise(gain)} 0 -1 -1 1`, '    NCHAN 2', '    MUTESOLO 0 0 0', '    MAINSEND 1 0',
      '    <ITEM', '      POSITION 0', '      SOFFS 0', `      LENGTH ${precise(track.durationSeconds)}`,
      '      LOOP 0', '      BEAT 0', '      VOLPAN 1 0 1 -1', '      PLAYRATE 1 1 0 -1 0 0.0025',
      '      FADEIN 1 0 0', '      FADEOUT 1 0 0', `      NAME ${quote(reaperTrackName(track))}`,
      `      <SOURCE ${sourceType(track.mediaPath)}`, `        FILE ${quote(track.mediaPath)}`, '      >', '    >', '  >');
  }
  lines.push('>');
  return {
    projectText: `${lines.join('\n')}\n`,
    manifest: {
      version: REAPER_PACKAGE_VERSION, songId: String(song.id || ''), title: clean(song.titulo),
      draft: true, sectionOffsetApplied: drafts.offset, durationSeconds: duration,
      tempoUnconfirmed: tempo, meterUnconfirmed: `${validMeter ? numerator : 4}/${validMeter ? denominator : 4}`,
      markers: drafts.markers, omittedMarkers: drafts.omitted,
      tracks: tracks.map((track) => ({ name: reaperTrackName(track), mediaPath: track.mediaPath, durationSeconds: track.durationSeconds })),
    },
  };
}

// Decode metadata, not the whole multitrack PCM. Revoke the temporary URL on every path.
export const measureReaperBlobDuration = (blob, name, timeoutMs = 20000) => new Promise((resolve, reject) => {
  const audio = document.createElement('audio');
  const url = URL.createObjectURL(blob);
  let timer;
  const finish = (error) => {
    clearTimeout(timer);
    audio.onloadedmetadata = audio.onerror = null;
    const duration = audio.duration;
    audio.removeAttribute('src');
    audio.load();
    URL.revokeObjectURL(url);
    if (error) reject(error); else resolve(duration);
  };
  audio.preload = 'metadata';
  audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration > 0 ? null : new Error(`Duración inválida en “${name}”.`));
  audio.onerror = () => finish(new Error(`Este navegador no pudo leer “${name}”. Prueba con Chrome; no se generó un RPP incompleto.`));
  timer = setTimeout(() => finish(new Error(`Se agotó el tiempo al medir “${name}”. Puedes reintentar.`)), timeoutMs);
  audio.src = url;
});
