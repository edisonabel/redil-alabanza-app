const VOICE_AUDIO_EXTENSION_RE = /\.(mp3|wav|m4a|aac|ogg|flac|mp4|mpeg|mpga|webm)(\?.*)?$/i;
const VOICE_ENTRY_ARRAY_KEYS = ['entries'];

const serializeVoicePayloadCandidate = (value) => {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';

  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
};

const hasVoiceEntryUrl = (candidate) => {
  if (typeof candidate === 'string') return /^https?:\/\//i.test(candidate.trim());
  if (!candidate || typeof candidate !== 'object') return false;

  return Boolean(
    candidate.url ||
    candidate.link ||
    candidate.href ||
    candidate.src ||
    candidate.audio,
  );
};

const getStructuredVoiceEntries = (parsed) => {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return [];

  for (const key of VOICE_ENTRY_ARRAY_KEYS) {
    if (Array.isArray(parsed[key])) return parsed[key];
  }

  return [];
};

export const getVoicePayloadScore = (value) => {
  const raw = serializeVoicePayloadCandidate(value);
  if (!raw || raw === '-') return 0;

  const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (normalized === 'no esta' || normalized === 'null') return 0;

  if (/^https?:\/\//i.test(raw)) {
    return VOICE_AUDIO_EXTENSION_RE.test(raw) ? 4 : 2;
  }

  if (raw.includes('\n') || raw.includes('|')) {
    const lineUrls = raw
      .split('\n')
      .map((line) => {
        const trimmed = String(line || '').trim();
        if (!trimmed) return '';
        return trimmed.includes('|') ? trimmed.split('|').slice(1).join('|').trim() : trimmed;
      })
      .filter(Boolean);

    if (lineUrls.some((url) => VOICE_AUDIO_EXTENSION_RE.test(url))) return 6;
    return lineUrls.some((url) => /^https?:\/\//i.test(url)) ? 4 : 1;
  }

  try {
    const parsed = typeof value === 'object' && value !== null ? value : JSON.parse(raw);
    if (typeof parsed === 'string') return getVoicePayloadScore(parsed);

    const structuredEntries = getStructuredVoiceEntries(parsed);
    if (structuredEntries.some(hasVoiceEntryUrl)) return 5;

    if (parsed && typeof parsed === 'object') {
      if (hasVoiceEntryUrl(parsed)) return 4;
      if (parsed.legacyUrl || parsed.folder || parsed.drive) return 2;

      const mappedEntries = Object.values(parsed).filter(hasVoiceEntryUrl);
      if (mappedEntries.length > 0) return 5;
    }
  } catch {
    return 1;
  }

  return 1;
};

export const pickPreferredVoicePayload = (...values) => {
  let bestValue = '';
  let bestScore = 0;

  values.forEach((value) => {
    const score = getVoicePayloadScore(value);
    if (score > bestScore) {
      bestScore = score;
      bestValue = value;
    }
  });

  return bestValue || '';
};
