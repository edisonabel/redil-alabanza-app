const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';

const decodeReaperString = (value = '') => String(value || '').replace(/\\([\\"])/g, '$1');

export function parseReaperProject(source = '') {
  const text = String(source || '').replace(/^\uFEFF/, '');
  if (!/^\s*<REAPER_PROJECT\b/m.test(text)) {
    throw new Error('El archivo no parece ser un proyecto válido de REAPER (.RPP).');
  }

  const tempoMatch = text.match(new RegExp(`^\\s*TEMPO\\s+(${NUMBER})\\s+(\\d+)\\s+(\\d+)\\b`, 'm'));
  const markers = [];
  const markerPattern = /^\s*MARKER\s+(-?\d+)\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s+(?:"((?:[^"\\]|\\.)*)"|(\S+))(.*)$/gm;
  let match;
  while ((match = markerPattern.exec(text))) {
    const position = Number(match[2]);
    const name = decodeReaperString(match[3] ?? match[4] ?? '').trim();
    if (!name || !Number.isFinite(position) || position < 0) continue;
    markers.push({ id: Number(match[1]), name, timeSeconds: Math.round(position * 1000) / 1000 });
  }

  markers.sort((left, right) => left.timeSeconds - right.timeSeconds || left.id - right.id);
  return {
    tempo: tempoMatch ? Number(tempoMatch[1]) : null,
    meter: tempoMatch ? `${tempoMatch[2]}/${tempoMatch[3]}` : null,
    markers,
    markerCount: markers.length,
  };
}

export const safeReaperProjectName = (value = '') => {
  const cleaned = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 120);
  return `${cleaned.replace(/\.rpp$/i, '') || 'proyecto-reaper'}.RPP`;
};

export const formatReaperTime = (seconds = 0) => {
  const totalSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(totalSeconds / 60);
  const remaining = totalSeconds - minutes * 60;
  return `${minutes}:${remaining.toFixed(3).padStart(6, '0')}`;
};
