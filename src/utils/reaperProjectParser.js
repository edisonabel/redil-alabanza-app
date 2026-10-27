import { getReaperDraftMarkers, readReaperSession, REAPER_INSTRUCTION_PATTERN } from './reaperPreparation.js';

const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const decodeReaperString = (value = '') => String(value || '').replace(/\\([\\"])/g, '$1');
const markerName = (value = '') => String(value).replace(/^\[BORRADOR\]\s*/i, '').trim();
const identity = (value) => markerName(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const special = (value) => /^(uno|fin audio)$/i.test(markerName(value));

export function parseReaperProject(source = '') {
  const text = String(source || '').replace(/^\uFEFF/, '');
  if (!/^\s*<REAPER_PROJECT\b/m.test(text)) throw new Error('El archivo no parece ser un proyecto válido de REAPER (.RPP).');
  const stack = [];
  const markers = [];
  const instructions = [];
  const tempoMap = [];
  const items = [];
  const originalMedia = [];
  let tempo = null, meter = null, songId = null, track = '', item = null, playRate = 1;
  let invalidMarkerCount = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('<')) {
      const chunk = line.match(/^<(\S+)/)?.[1];
      stack.push(chunk);
      if (chunk === 'TRACK') track = '';
      if (chunk === 'ITEM') item = { position: 0, length: 0, rate: 1, sourceOffset: 0, source: '', track };
      continue;
    }
    if (line === '>') {
      if (stack.at(-1) === 'ITEM' && item) { items.push(item); item = null; }
      stack.pop();
      continue;
    }
    const parent = stack.at(-1);
    if (parent === 'NOTES') {
      const match = line.match(/^\|ALABANZA_MAPA_V1:([^\s]+)$/);
      if (match) songId = match[1];
      const media = line.match(/^\|ALABANZA_MEDIA_V1:([^:]+):([\d.]+)$/);
      if (media) {
        try { originalMedia.push({ source: decodeURIComponent(media[1]), durationSeconds: Number(media[2]) }); } catch { /* Unknown metadata remains unverified. */ }
      }
    }
    if (parent === 'TRACK' && line.startsWith('NAME ')) track = decodeReaperString(line.slice(5).replace(/^"|"$/g, ''));
    if (parent === 'ITEM' && item) {
      const pair = line.match(/^(POSITION|LENGTH|PLAYRATE|SOFFS)\s+([^\s]+)/);
      if (pair) {
        const key = { POSITION: 'position', LENGTH: 'length', PLAYRATE: 'rate', SOFFS: 'sourceOffset' }[pair[1]];
        item[key] = Number(pair[2]);
      }
    }
    if (parent === 'SOURCE' && item && line.startsWith('FILE ')) item.source = decodeReaperString(line.slice(5).replace(/^"|"$/g, ''));
    if (parent === 'TEMPOENVEX' && line.startsWith('PT ')) {
      const values = line.split(/\s+/);
      const time = Number(values[1]), bpm = Number(values[2]), signature = Number(values[4] || 0);
      if (Number.isFinite(time) && Number.isFinite(bpm)) tempoMap.push({
        timeSeconds: time, tempo: bpm, linear: Number(values[3]) === 0,
        meter: signature > 0 ? `${signature & 65535}/${signature >>> 16}` : null,
      });
    }
    if (parent !== 'REAPER_PROJECT') continue;
    const tempoMatch = line.match(new RegExp(`^TEMPO\\s+(${NUMBER})\\s+(\\d+)\\s+(\\d+)\\b`));
    if (tempoMatch) { tempo = Number(tempoMatch[1]); meter = `${tempoMatch[2]}/${tempoMatch[3]}`; }
    if (line.startsWith('PLAYRATE ')) playRate = Number(line.split(/\s+/)[1]);
    if (!line.startsWith('MARKER ')) continue;
    const match = line.match(new RegExp(`^MARKER\\s+(-?\\d+)\\s+(${NUMBER})\\s+(?:"((?:[^"\\\\]|\\\\.)*)"|(\\S+))(.*)$`));
    if (!match) { invalidMarkerCount++; continue; }
    const position = Number(match[2]);
    const name = decodeReaperString(match[3] ?? match[4] ?? '').trim();
    const flags = Number(match[5].trim().split(/\s+/)[0] || 0);
    // Actual REAPER regions use MARKER lines too: bit 1 identifies their start.
    if ((flags & 1) || !name) continue;
    if (!Number.isFinite(position) || position < 0) { invalidMarkerCount++; continue; }
    // Instruction markers are spoken cues only: kept apart so they never start or move a section.
    if (REAPER_INSTRUCTION_PATTERN.test(name)) {
      const cue = name.replace(REAPER_INSTRUCTION_PATTERN, '').trim();
      if (cue) instructions.push({ id: Number(match[1]), name: cue, timeSeconds: position });
      continue;
    }
    markers.push({ id: Number(match[1]), name, timeSeconds: position, draft: /^\[BORRADOR\]/i.test(name) });
  }
  if (stack.length) throw new Error('El RPP está incompleto: vuelve a guardarlo en REAPER.');
  markers.sort((left, right) => left.timeSeconds - right.timeSeconds || left.id - right.id);
  instructions.sort((left, right) => left.timeSeconds - right.timeSeconds || left.id - right.id);
  return { tempo, meter, markers, instructions, markerCount: markers.length, tempoMap, items, originalMedia, playRate, songId, invalidMarkerCount };
}

export function reviewReaperProject(project, song) {
  const issues = [];
  const add = (code, message) => issues.push({ code, message });
  const sections = project.markers.filter((marker) => !special(marker.name));
  const drafts = project.markers.filter((marker) => marker.draft);
  const original = getReaperDraftMarkers(song);
  const remaining = [...original.markers];
  const comparisons = sections.map((marker) => {
    const originalIndex = remaining.findIndex((row) => identity(row.name) === identity(marker.name));
    const before = originalIndex < 0 ? null : remaining.splice(originalIndex, 1)[0];
    return { name: markerName(marker.name), beforeSeconds: before?.timeSeconds ?? null,
      afterSeconds: marker.timeSeconds, deltaSeconds: before ? marker.timeSeconds - before.timeSeconds : null };
  });
  const uno = project.markers.find((marker) => identity(marker.name) === 'uno' && !marker.draft);
  const end = project.markers.find((marker) => identity(marker.name) === 'fin audio' && !marker.draft);
  if (!project.markers.length) add('empty', 'No hay marcadores de sección.');
  if (!sections.length) add('no-sections', 'Añade al menos una sección musical.');
  if (drafts.length) add('drafts', `Faltan ${drafts.length} marcadores por confirmar en el asistente de REAPER.`);
  if (!uno) add('uno', 'Falta el marcador UNO confirmado en el primer tiempo real.');
  if (!end) add('end', 'Falta FIN AUDIO confirmado al terminar la cola del audio.');
  if (project.invalidMarkerCount) add('invalid', 'Hay marcadores con posiciones inválidas.');
  if (!project.tempo || !project.meter) add('tempo', 'No se pudo leer el tempo o compás inicial del proyecto.');
  if (project.playRate !== 1 || project.items.some((item) => item.rate !== 1 || item.position !== 0 || item.sourceOffset !== 0 || !(item.length > 0))) {
    add('audio-moved', 'Se movió, recortó o cambió la velocidad de algún audio. Los tiempos ya no corresponden a los stems originales.');
  }
  if (!project.items.length) add('no-media', 'El RPP no contiene los audios de referencia.');
  const normalizedPath = (path) => String(path).replace(/\\/g, '/');
  for (const item of project.items) {
    const source = project.originalMedia?.find((row) => normalizedPath(row.source) === normalizedPath(item.source));
    if (!source) add('unverified-media', `No se pudo comprobar la duración original de “${item.track || item.source}”.`);
    else if (Math.abs(source.durationSeconds - item.length) > 0.05) add('trimmed', `Se recortó o amplió “${item.track || item.source}” respecto al audio original.`);
  }
  if (project.songId && project.songId !== String(song.id)) add('song', 'Este proyecto fue preparado para otra canción.');
  if (!project.songId) add('unbound', 'Proyecto externo: comprueba que corresponde a esta canción.');
  for (const name of ['uno', 'fin audio']) {
    if (project.markers.filter((marker) => identity(marker.name) === name).length > 1) add('duplicate-anchor', `Hay más de un marcador ${name.toUpperCase()}.`);
  }
  const times = new Set(), ids = new Set(), names = new Set();
  for (const marker of sections) {
    const timeKey = marker.timeSeconds.toFixed(6), nameKey = identity(marker.name);
    if (times.has(timeKey)) add('duplicate-time', `Más de una sección empieza en ${formatReaperTime(marker.timeSeconds)}.`);
    if (names.has(nameKey)) add('duplicate-name', `El nombre “${markerName(marker.name)}” se repite; numera las apariciones para distinguirlas.`);
    if (ids.has(marker.id)) add('duplicate-id', `Hay dos marcadores con el número ${marker.id}.`);
    times.add(timeKey); names.add(nameKey); ids.add(marker.id);
    if (end && marker.timeSeconds >= end.timeSeconds) add('outside', `“${markerName(marker.name)}” empieza después de FIN AUDIO.`);
  }
  for (const cue of project.instructions || []) {
    if ((uno && cue.timeSeconds < uno.timeSeconds) || (end && cue.timeSeconds >= end.timeSeconds)) {
      add('instruction-outside', `La instrucción “${cue.name}” está fuera de UNO–FIN AUDIO; no se dirá.`);
    }
  }
  const audioEnd = Math.max(0, ...project.items.map((item) => item.position + item.length));
  if (end && audioEnd && Math.abs(end.timeSeconds - audioEnd) > 0.05) add('tail', 'FIN AUDIO no coincide con el final de los ítems; revisa la cola y evita recortar el audio.');
  if (end && uno && uno.timeSeconds >= end.timeSeconds) add('range', 'UNO debe estar antes de FIN AUDIO.');
  if (remaining.length) add('removed', `Se quitaron o renombraron ${remaining.length} secciones respecto al borrador; revisa que sea intencional.`);
  const missingUntimed = original.omitted.filter((name) => !sections.some((marker) => identity(marker.name) === identity(name)));
  if (missingUntimed.length) add('untimed-source', `Faltan secciones que no tenían tiempo válido: ${missingUntimed.join(', ')}.`);
  const firstTempo = project.tempoMap[0];
  const variableTempo = firstTempo && project.tempoMap.some((point) => Math.abs(point.tempo - firstTempo.tempo) > 0.000001 || (point.meter && point.meter !== (firstTempo.meter || project.meter)) || point.linear);
  if (variableTempo) add('tempo-map', 'Hay cambios internos de tempo o compás. Se conservan en el RPP, pero Live Director todavía no importa ese mapa variable.');
  const session = readReaperSession(song.multitrack_session);
  if (project.items.length && session?.tracks?.length && project.items.length !== session.tracks.length) add('media-count', 'La cantidad de audios del RPP difiere de los stems de la canción.');
  const knownOrder = sections.map((marker) => original.markers.findIndex((row) => identity(row.name) === identity(marker.name))).filter((index) => index >= 0);
  if (knownOrder.some((index, i) => i > 0 && index < knownOrder[i - 1])) add('order', 'El orden de las secciones cambió respecto al borrador. Comprueba las entradas.');
  return { status: issues.length ? 'needs-review' : 'checks-passed', issues, comparisons,
    confirmedSections: sections.filter((marker) => !marker.draft).length, draftCount: drafts.length,
    unoSeconds: uno?.timeSeconds ?? null, endSeconds: end?.timeSeconds ?? null,
    scope: 'multitrack-only', appliedToPlayback: false };
}

export const safeReaperProjectName = (value = '') => {
  const cleaned = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '').slice(0, 120);
  return `${cleaned.replace(/\.rpp$/i, '') || 'proyecto-reaper'}.RPP`;
};
export const formatReaperTime = (seconds = 0) => {
  const totalSeconds = Math.round(Math.max(0, Number(seconds) || 0) * 1000) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${(totalSeconds - minutes * 60).toFixed(3).padStart(6, '0')}`;
};
