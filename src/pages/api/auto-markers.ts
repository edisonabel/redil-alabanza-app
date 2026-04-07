import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { splitSectionIntoCues } from '../../utils/splitSectionIntoCues';
import { getSectionKind } from '../../utils/sectionVisuals';

export const prerender = false;

const rawSupabaseUrl =
  import.meta.env.SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  import.meta.env.PUBLIC_SUPABASE_URL ||
  process.env.PUBLIC_SUPABASE_URL ||
  '';
const supabaseUrl = rawSupabaseUrl.replace(/\/$/, '');
const supabaseServiceRoleKey =
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';
const openAiApiKey =
  import.meta.env.OPENAI_API_KEY ||
  process.env.OPENAI_API_KEY ||
  '';
const whisperModel =
  import.meta.env.OPENAI_WHISPER_MODEL ||
  process.env.OPENAI_WHISPER_MODEL ||
  'whisper-1';

const authClient = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
  : null;

const DRIVE_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
  'drive.usercontent.google.com',
]);

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

type SectionPayload = {
  name?: string;
  firstLine?: string;
  lines?: string[];
};

type TranscriptWord = {
  word: string;
  start: number;
  end: number;
};

type TranscriptResponse = {
  text?: string;
  duration?: number;
  words?: TranscriptWord[];
};

type SuggestedMarkerMethod =
  | 'whisper-match'
  | 'hybrid-structure'
  | 'interpolated'
  | 'no-match'
  | 'no-lyrics';

type SuggestedMarker = {
  sectionName: string;
  startSec: number | null;
  confidence: number;
  method: SuggestedMarkerMethod;
  cueMarkers?: number[];
};

type PhraseMatch = {
  startSec: number;
  confidence: number;
  matchCount: number;
  searchWordCount: number;
};

const MIN_SECTION_PROGRESS_SEC = 1;
const MIN_REPEAT_PROGRESS_SEC = 4;
const MIN_MATCH_CONFIDENCE = 0.4;
const MATCH_CONFIDENCE_TIE_WINDOW = 0.12;

const stripAccents = (value = '') =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const normalizeText = (value = '') =>
  stripAccents(String(value || '').toLowerCase())
    .replace(/[.,!?;:'"()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const stripChords = (line = '') =>
  String(line || '')
    .replace(/\[([^\]]+)\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const getPhraseSearchWords = (phrase = '') =>
  normalizeText(stripChords(phrase))
    .split(/\s+/)
    .filter((word) => word.length > 1)
    .slice(0, 6);

const buildPhraseFingerprint = (phrase = '') => {
  const searchWords = getPhraseSearchWords(phrase);
  if (searchWords.length > 0) {
    return searchWords.join(' ');
  }

  return normalizeText(stripChords(phrase));
};

const buildCueSearchPhrase = (lines: string[] = []) => {
  const meaningfulLines = (Array.isArray(lines) ? lines : [])
    .map((line) => stripChords(line))
    .filter(Boolean)
    .slice(0, 2);

  return meaningfulLines.join(' ');
};

const countChordTokens = (line = '') => Array.from(String(line || '').matchAll(/\[([^\]]+)\]/g)).length;

const sectionHasLyrics = (section: SectionPayload) =>
  (Array.isArray(section?.lines) ? section.lines : []).some((line) => stripChords(line).length > 0);

const estimateSectionStructureWeight = (section: SectionPayload) => {
  const kind = getSectionKind(String(section?.name || ''));
  const lines = Array.isArray(section?.lines) ? section.lines : [];
  const lyricLines = lines.filter((line) => stripChords(line).length > 0);
  const chordOnlyLines = lines.filter((line) => !stripChords(line).length && countChordTokens(line) > 0);
  const lyricChars = lyricLines.reduce((sum, line) => sum + stripChords(line).replace(/\s+/g, '').length, 0);
  const chordCount = lines.reduce((sum, line) => sum + countChordTokens(line), 0);

  const kindBonusMap = {
    intro: 1.55,
    outro: 1.45,
    interlude: 1.35,
    bridge: 1.15,
    refrain: 1.05,
    vamp: 1.1,
    default: 1,
  } as const;

  const kindBonus = kindBonusMap[kind as keyof typeof kindBonusMap] || 1;
  const base =
    0.8 +
    lyricLines.length * 0.7 +
    chordOnlyLines.length * 0.95 +
    lyricChars * 0.018 +
    chordCount * 0.16;

  return Math.max(base * kindBonus, 0.8);
};

const levenshteinSimilarity = (() => {
  let buffer = new Int32Array(0);

  return (left: string, right: string) => {
    if (!left && !right) return 1;
    if (!left || !right) return 0;

    const a = normalizeText(left);
    const b = normalizeText(right);
    if (!a && !b) return 1;
    if (!a || !b) return 0;
    if (a === b) return 1;

    const rows = a.length + 1;
    const cols = b.length + 1;
    const needed = rows * cols;
    if (buffer.length < needed) {
      buffer = new Int32Array(needed * 2);
    }

    for (let i = 0; i < rows; i += 1) buffer[i * cols] = i;
    for (let j = 0; j < cols; j += 1) buffer[j] = j;

    for (let i = 1; i < rows; i += 1) {
      for (let j = 1; j < cols; j += 1) {
        const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
        buffer[i * cols + j] = Math.min(
          buffer[(i - 1) * cols + j] + 1,
          buffer[i * cols + (j - 1)] + 1,
          buffer[(i - 1) * cols + (j - 1)] + substitutionCost,
        );
      }
    }

    return 1 - (buffer[a.length * cols + b.length] / Math.max(a.length, b.length));
  };
})();

const detectLanguage = (sections: SectionPayload[]) => {
  const allLines = sections.flatMap((section) => [
    section.firstLine || '',
    ...(Array.isArray(section.lines) ? section.lines.map((line) => stripChords(line)) : []),
  ]);
  const allText = normalizeText(allLines.join(' '));
  const spanishWords = [
    'el', 'la', 'los', 'las', 'de', 'en', 'que', 'por', 'es', 'tu', 'mi', 'su', 'para',
    'con', 'se', 'te', 'me', 'un', 'una', 'al', 'del', 'mas', 'pero', 'cuando', 'porque',
    'todo', 'eres', 'señor', 'dios', 'santo', 'jesus', 'gloria', 'aleluya',
  ];
  const englishWords = [
    'the', 'and', 'is', 'in', 'to', 'of', 'my', 'your', 'for', 'with', 'you', 'are', 'we',
    'he', 'she', 'his', 'her', 'our', 'all', 'will', 'that', 'have', 'lord', 'god', 'holy',
    'jesus', 'glory', 'hallelujah',
  ];

  const countTokens = (dictionary: string[]) =>
    dictionary.reduce((count, token) => (
      allText.includes(` ${token} `) || allText.startsWith(`${token} `) || allText.endsWith(` ${token}`)
        ? count + 1
        : count
    ), 0);

  return countTokens(spanishWords) >= countTokens(englishWords) ? 'es' : 'en';
};

const extractGoogleDriveId = (rawUrl = '') => {
  const byPath = rawUrl.match(/\/file\/d\/([^/]+)/i)?.[1];
  if (byPath) return byPath;

  const byQuery = rawUrl.match(/[?&]id=([^&]+)/i)?.[1];
  if (byQuery) return byQuery;

  return '';
};

const buildDriveCandidates = (fileId: string) => ([
  `https://drive.google.com/uc?export=download&id=${fileId}`,
  `https://docs.google.com/uc?export=open&id=${fileId}`,
  `https://drive.usercontent.google.com/download?id=${fileId}&confirm=t`,
]);

const decodeHtmlEntities = (value = '') => (
  String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
);

const decodeDriveEscapedUrl = (value = '') => (
  decodeHtmlEntities(value)
    .replace(/\\u003d/gi, '=')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003f/gi, '?')
    .replace(/\\u002f/gi, '/')
    .replace(/\\x3d/gi, '=')
    .replace(/\\x26/gi, '&')
    .replace(/\\x3f/gi, '?')
    .replace(/\\x2f/gi, '/')
    .replace(/\\\//g, '/')
);

const normalizeCandidateUrl = (rawUrl = '', baseUrl = '') => {
  const decoded = decodeDriveEscapedUrl(rawUrl).trim();
  if (!decoded) return '';

  try {
    return new URL(decoded, baseUrl || 'https://drive.google.com').href;
  } catch {
    return '';
  }
};

const extractCookieHeader = (upstream: Response) => {
  const extendedHeaders = upstream.headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof extendedHeaders.getSetCookie === 'function') {
    const cookies = extendedHeaders
      .getSetCookie()
      .map((item) => item.split(';')[0]?.trim())
      .filter(Boolean);

    if (cookies.length > 0) {
      return cookies.join('; ');
    }
  }

  const rawCookie = upstream.headers.get('set-cookie');
  if (!rawCookie) return '';

  return rawCookie.split(';')[0]?.trim() || '';
};

const extractConfirmationUrl = (html = '', baseUrl = '') => {
  const source = String(html || '');
  if (!source) return '';

  const directMatch = source.match(/"downloadUrl":"([^"]+)"/i);
  if (directMatch?.[1]) {
    return normalizeCandidateUrl(directMatch[1], baseUrl);
  }

  const hrefMatch =
    source.match(/href="([^"]*confirm[^"]*)"/i) ||
    source.match(/href='([^']*confirm[^']*)'/i);
  if (hrefMatch?.[1]) {
    return normalizeCandidateUrl(hrefMatch[1], baseUrl);
  }

  const formMatch = source.match(/<form[^>]+action=["']([^"']+)["'][^>]*>/i);
  if (!formMatch?.[1]) {
    return '';
  }

  const actionUrl = normalizeCandidateUrl(formMatch[1], baseUrl);
  if (!actionUrl) {
    return '';
  }

  const confirmedUrl = new URL(actionUrl);
  const inputRegex = /<input[^>]*type=["']hidden["'][^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/gi;
  let inputMatch: RegExpExecArray | null = null;

  while ((inputMatch = inputRegex.exec(source)) !== null) {
    const [, name, value] = inputMatch;
    if (!name) continue;
    confirmedUrl.searchParams.set(name, decodeDriveEscapedUrl(value));
  }

  return confirmedUrl.href;
};

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const AUDIO_DOWNLOAD_TIMEOUT_MS = 60_000;

const isAudioContentType = (contentType: string) => {
  const ct = contentType.toLowerCase();
  return (
    ct.includes('audio/') ||
    ct.includes('application/octet-stream') ||
    ct.includes('video/') ||
    ct.includes('application/ogg')
  );
};

const fetchAudioResponse = async (
  url: string,
  cookieHeader = '',
  depth = 0,
  signal?: AbortSignal,
): Promise<Response> => {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'user-agent': 'Mozilla/5.0',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    redirect: 'follow',
    signal,
  });

  if (!response.ok) {
    throw new Error(`Error descargando audio: ${response.status}`);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) {
    return response;
  }

  if (depth >= 2) {
    throw new Error('Google Drive siguio respondiendo HTML en vez del audio.');
  }

  const html = await response.text().catch(() => '');
  const confirmUrl = extractConfirmationUrl(html, url);
  if (!confirmUrl || confirmUrl === url) {
    throw new Error('No se pudo resolver la descarga directa del audio.');
  }

  const nextCookieHeader = [cookieHeader, extractCookieHeader(response)]
    .filter(Boolean)
    .join('; ');

  return fetchAudioResponse(confirmUrl, nextCookieHeader, depth + 1, signal);
};

const validateAudioResponse = (response: Response) => {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const bytes = Number(contentLength);
    if (Number.isFinite(bytes) && bytes > MAX_AUDIO_BYTES) {
      throw new Error(`Audio excede 25MB (limite actual de la API).`);
    }
  }
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType && !contentType.includes('text/html') && !isAudioContentType(contentType)) {
    throw new Error(`Tipo de contenido inesperado: ${contentType.split(';')[0].trim()}`);
  }
};

const downloadAudioBlob = async (rawUrl: string, requestUrl: URL) => {
  const normalizedUrl = String(rawUrl || '').trim();
  if (!normalizedUrl) {
    throw new Error('Se requiere mp3Url.');
  }

  const targetUrl = new URL(normalizedUrl, requestUrl).href;
  const parsedUrl = new URL(targetUrl);
  const maybeDriveId = extractGoogleDriveId(targetUrl);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AUDIO_DOWNLOAD_TIMEOUT_MS);

  try {
    if (DRIVE_HOSTS.has(parsedUrl.hostname.toLowerCase()) && maybeDriveId) {
      let lastError: Error | null = null;

      for (const candidate of buildDriveCandidates(maybeDriveId)) {
        try {
          const response = await fetchAudioResponse(candidate, '', 0, controller.signal);
          validateAudioResponse(response);
          return await response.blob();
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error || 'Error descargando Google Drive.'));
        }
      }

      throw lastError || new Error('No se pudo descargar el audio desde Google Drive.');
    }

    const response = await fetchAudioResponse(targetUrl, '', 0, controller.signal);
    validateAudioResponse(response);
    return await response.blob();
  } finally {
    clearTimeout(timeoutId);
  }
};

const findPhraseMatchesInTranscript = (
  words: TranscriptWord[],
  phrase: string,
  startAfter = 0,
  endBefore = Number.POSITIVE_INFINITY,
) => {
  const searchWords = getPhraseSearchWords(phrase);

  if (searchWords.length === 0) {
    return [];
  }

  const candidates: PhraseMatch[] = [];

  for (let i = 0; i < words.length; i += 1) {
    if (words[i].start < startAfter) continue;
    if (Number.isFinite(endBefore) && words[i].start >= endBefore) break;

    let score = 0;
    let matchCount = 0;

    for (let j = 0; j < searchWords.length && i + j < words.length; j += 1) {
      const transcriptWord = normalizeText(words[i + j].word);
      const similarity = levenshteinSimilarity(transcriptWord, searchWords[j]);

      if (similarity > 0.6) {
        score += similarity;
        matchCount += 1;
      }
    }

    const normalizedScore = searchWords.length > 0 ? score / searchWords.length : 0;
    if (matchCount >= Math.ceil(searchWords.length * 0.6) && normalizedScore > MIN_MATCH_CONFIDENCE) {
      const nextCandidate: PhraseMatch = {
        startSec: Math.round(words[i].start),
        confidence: Math.min(1, normalizedScore),
        matchCount,
        searchWordCount: searchWords.length,
      };

      const previousCandidate = candidates[candidates.length - 1];
      if (previousCandidate && Math.abs(previousCandidate.startSec - nextCandidate.startSec) <= 1) {
        if (nextCandidate.confidence > previousCandidate.confidence) {
          candidates[candidates.length - 1] = nextCandidate;
        }
      } else {
        candidates.push(nextCandidate);
      }
    }
  }

  return candidates;
};

const selectPhraseMatch = (
  candidates: PhraseMatch[],
  expectedStartSec: number | null = null,
) => {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const bestConfidence = candidates.reduce((best, candidate) => Math.max(best, candidate.confidence), 0);
  const shortlisted = candidates.filter((candidate) => (
    candidate.confidence >= Math.max(MIN_MATCH_CONFIDENCE, bestConfidence - MATCH_CONFIDENCE_TIE_WINDOW)
  ));

  if (shortlisted.length === 1 || !Number.isFinite(expectedStartSec)) {
    return shortlisted[0] || candidates[0];
  }

  return shortlisted.reduce((bestCandidate, candidate) => {
    const bestDistance = Math.abs((bestCandidate?.startSec ?? 0) - expectedStartSec!);
    const candidateDistance = Math.abs(candidate.startSec - expectedStartSec!);

    if (candidateDistance < bestDistance) return candidate;
    if (candidateDistance > bestDistance) return bestCandidate;
    if (candidate.confidence > (bestCandidate?.confidence ?? 0)) return candidate;
    if (candidate.confidence < (bestCandidate?.confidence ?? 0)) return bestCandidate;
    return candidate.startSec < (bestCandidate?.startSec ?? Infinity) ? candidate : bestCandidate;
  }, shortlisted[0]);
};

const findPreviousDetectedIndex = (markers: SuggestedMarker[], targetIndex: number) => {
  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    if (markers[index]?.startSec != null) return index;
  }

  return -1;
};

const findNextDetectedIndex = (markers: SuggestedMarker[], targetIndex: number) => {
  for (let index = targetIndex + 1; index < markers.length; index += 1) {
    if (markers[index]?.startSec != null) return index;
  }

  return -1;
};

const clampMarkerOrder = (markers: SuggestedMarker[]) => {
  let previousStart: number | null = null;

  return markers.map((marker) => {
    if (marker.startSec == null) return marker;

    const safeStart = previousStart == null
      ? marker.startSec
      : Math.max(previousStart + MIN_SECTION_PROGRESS_SEC, marker.startSec);

    previousStart = safeStart;
    return {
      ...marker,
      startSec: safeStart,
    };
  });
};

const buildCueMarkersForSection = ({
  transcriptWords,
  section,
  sectionIndex,
  marker,
  nextSectionStartSec,
}: {
  transcriptWords: TranscriptWord[];
  section: SectionPayload;
  sectionIndex: number;
  marker: SuggestedMarker;
  nextSectionStartSec: number | null;
}) => {
  if (!Array.isArray(section?.lines) || section.lines.length === 0) {
    return [];
  }

  if (!Number.isFinite(marker?.startSec)) {
    return [];
  }

  const sectionStartSec = Number(marker.startSec);
  const sectionEndCap = Number.isFinite(nextSectionStartSec)
    ? Math.max(sectionStartSec + MIN_SECTION_PROGRESS_SEC, Number(nextSectionStartSec))
    : Number.POSITIVE_INFINITY;

  const cueDrafts = splitSectionIntoCues(
    'auto-markers',
    sectionIndex,
    {
      name: String(section?.name || `Seccion ${sectionIndex + 1}`),
      lines: Array.isArray(section?.lines) ? section.lines : [],
    },
    null,
    1,
  );

  if (cueDrafts.length <= 1) {
    return [];
  }

  const sectionDurationGuess = Number.isFinite(sectionEndCap)
    ? Math.max(0, sectionEndCap - sectionStartSec)
    : null;

  const cuePhraseUsageCounts = new Map<string, number>();
  const cuePhraseLastMatchedStart = new Map<string, number>();
  let lastCueStart = sectionStartSec;
  const cueMarkers: number[] = [];

  for (let cueIndex = 1; cueIndex < cueDrafts.length; cueIndex += 1) {
    const cue = cueDrafts[cueIndex];
    const cuePhrase = buildCueSearchPhrase(cue?.rawLines || []);
    if (!cuePhrase) continue;

    const phraseKey = buildPhraseFingerprint(cuePhrase);
    const occurrence = (cuePhraseUsageCounts.get(phraseKey) || 0) + 1;
    cuePhraseUsageCounts.set(phraseKey, occurrence);

    const previousSamePhraseStart = cuePhraseLastMatchedStart.get(phraseKey);
    const repeatAwareFloor = previousSamePhraseStart == null
      ? 0
      : previousSamePhraseStart + Math.max(MIN_REPEAT_PROGRESS_SEC, Math.round(getPhraseSearchWords(cuePhrase).length * 0.75));
    const searchStartSec = Math.max(lastCueStart + MIN_SECTION_PROGRESS_SEC, repeatAwareFloor);
    const expectedStartSec = sectionDurationGuess != null
      ? Math.max(searchStartSec, Math.round(sectionStartSec + ((sectionDurationGuess * cueIndex) / cueDrafts.length)))
      : searchStartSec;

    const directCandidates = findPhraseMatchesInTranscript(
      transcriptWords,
      cuePhrase,
      searchStartSec,
      sectionEndCap,
    );
    const relaxedCandidates = directCandidates.length === 0 && previousSamePhraseStart != null
      ? findPhraseMatchesInTranscript(
        transcriptWords,
        cuePhrase,
        Math.max(lastCueStart + MIN_SECTION_PROGRESS_SEC, previousSamePhraseStart + 1),
        sectionEndCap,
      )
      : [];
    const match = selectPhraseMatch(
      directCandidates.length > 0 ? directCandidates : relaxedCandidates,
      expectedStartSec,
    );

    if (!match) continue;
    if (match.startSec <= sectionStartSec) continue;
    if (Number.isFinite(sectionEndCap) && match.startSec >= sectionEndCap) continue;

    cuePhraseLastMatchedStart.set(phraseKey, match.startSec);
    lastCueStart = match.startSec;
    cueMarkers.push(match.startSec);
  }

  return [...new Set(cueMarkers)]
    .sort((left, right) => left - right)
    .filter((value) => value > sectionStartSec && (!Number.isFinite(sectionEndCap) || value < sectionEndCap));
};

const fillMarkerGapWithStructure = ({
  markers,
  sections,
  fromIndex,
  toIndex,
  rangeStartSec,
  rangeEndSec,
  method,
}: {
  markers: SuggestedMarker[];
  sections: SectionPayload[];
  fromIndex: number;
  toIndex: number;
  rangeStartSec: number;
  rangeEndSec: number;
  method: SuggestedMarkerMethod;
}) => {
  const start = Math.max(0, Number(rangeStartSec) || 0);
  const end = Math.max(start, Number(rangeEndSec) || start);
  const indexes: number[] = [];

  for (let index = fromIndex; index <= toIndex; index += 1) {
    if (markers[index]?.startSec == null) {
      indexes.push(index);
    }
  }

  if (indexes.length === 0) return;
  if (end <= start) return;

  const weights = indexes.map((index) => estimateSectionStructureWeight(sections[index]));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return;

  let cursor = start;
  indexes.forEach((index, offset) => {
    const relativeStart = cursor;
    if (offset < indexes.length - 1) {
      cursor += ((end - start) * weights[offset]) / totalWeight;
    } else {
      cursor = end;
    }

    markers[index] = {
      ...markers[index],
      startSec: Math.max(0, Math.round(relativeStart)),
      confidence: Math.max(markers[index]?.confidence || 0, method === 'hybrid-structure' ? 0.5 : 0.3),
      method,
    };
  });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    if (!authClient || !supabaseUrl) {
      return jsonResponse({ error: 'Faltan variables de entorno de Supabase.' }, 500);
    }

    const token = cookies.get('sb-access-token')?.value || '';
    if (!token) {
      return jsonResponse({ error: 'No autenticado.' }, 401);
    }

    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({ error: 'Sesion invalida.' }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const mp3Url = String(body?.mp3Url || '').trim();
    const sections: SectionPayload[] = (Array.isArray(body?.sections) ? body.sections : [])
      .map((section: any) => ({
        name: String(section?.name || '').trim(),
        firstLine: String(section?.firstLine || '').trim(),
        lines: Array.isArray(section?.lines)
          ? section.lines.map((line: any) => String(line || ''))
          : [],
      }))
      .filter((section: any) => section.name);

    if (!mp3Url) {
      return jsonResponse({ error: 'Se requiere mp3Url.' }, 400);
    }

    if (sections.length === 0) {
      return jsonResponse({ error: 'Se requiere al menos una seccion.' }, 400);
    }

    if (!openAiApiKey) {
      return jsonResponse({ error: 'OPENAI_API_KEY no configurada en el servidor.' }, 500);
    }

    const audioBlob = await downloadAudioBlob(mp3Url, new URL(request.url));
    // Comprobación de seguridad si Content-Length no estaba disponible en la descarga
    if (audioBlob.size > MAX_AUDIO_BYTES) {
      return jsonResponse({ error: 'Audio excede 25MB (limite actual de la API).' }, 413);
    }

    const language = detectLanguage(sections);
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.mp3');
    formData.append('model', whisperModel);
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'word');
    formData.append('timestamp_granularities[]', 'segment');
    formData.append('language', language);

    const promptText = sections
      .flatMap((section) => (Array.isArray(section.lines) ? section.lines.map(stripChords) : []))
      .filter((line) => line.trim().length > 0)
      .join(' ')
      .slice(0, 1000);

    if (promptText) {
      formData.append('prompt', promptText);
    }
    formData.append('temperature', '0.2');

    const WHISPER_TIMEOUT_MS = 120_000;
    const RETRYABLE_STATUSES = new Set([429, 503]);
    let whisperResponse: Response | null = null;
    let lastWhisperStatus = 0;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
      const whisperController = new AbortController();
      const whisperTimeoutId = setTimeout(() => whisperController.abort(), WHISPER_TIMEOUT_MS);
      try {
        whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${openAiApiKey}` },
          body: formData,
          signal: whisperController.signal,
        });
      } finally {
        clearTimeout(whisperTimeoutId);
      }
      lastWhisperStatus = whisperResponse.status;
      if (whisperResponse.ok || !RETRYABLE_STATUSES.has(lastWhisperStatus)) break;
    }

    if (!whisperResponse || !whisperResponse.ok) {
      const detail = await whisperResponse?.text().catch(() => '') ?? '';
      console.error('[auto-markers] Whisper error:', lastWhisperStatus, detail.slice(0, 500));
      return jsonResponse({ error: `Error de Whisper API: ${lastWhisperStatus}` }, 502);
    }

    const transcript = await whisperResponse.json() as TranscriptResponse;
    const transcriptWords = Array.isArray(transcript.words)
      ? transcript.words.filter((word) => (
        typeof word?.word === 'string' &&
        Number.isFinite(Number(word?.start)) &&
        Number.isFinite(Number(word?.end))
      )).map((word) => ({
        word: String(word.word || '').trim(),
        start: Number(word.start),
        end: Number(word.end),
      }))
      : [];

    const transcriptPreview = String(transcript.text || '').slice(0, 200);
    const durationSec = Number(transcript.duration) > 0
      ? Math.round(Number(transcript.duration))
      : (transcriptWords[transcriptWords.length - 1]?.end
        ? Math.round(transcriptWords[transcriptWords.length - 1].end)
        : null);

    if (transcriptWords.length === 0) {
      return jsonResponse({
        success: true,
        fallback: 'uniform',
        language,
        durationSec,
        wordCount: 0,
        transcriptPreview,
        markers: sections.map((section) => ({
          sectionName: section.name,
          startSec: null,
          confidence: 0,
          method: 'no-lyrics' as const,
          cueMarkers: [],
        })),
      });
    }

    const phraseUsageCounts = new Map<string, number>();
    const phraseLastMatchedStart = new Map<string, number>();
    const totalSections = sections.length;
    let lastStartSec = 0;
    const suggestedMarkers: SuggestedMarker[] = sections.map((section: any, index: number) => {
      const cleanFirstLine = stripChords(section.firstLine || '');

      if (!cleanFirstLine) {
        return {
          sectionName: section.name,
          startSec: null,
          confidence: 0,
          method: 'no-lyrics',
        };
      }

      const phraseKey = buildPhraseFingerprint(cleanFirstLine);
      const occurrence = (phraseUsageCounts.get(phraseKey) || 0) + 1;
      phraseUsageCounts.set(phraseKey, occurrence);

      const previousSamePhraseStart = phraseLastMatchedStart.get(phraseKey);
      const repeatAwareFloor = previousSamePhraseStart == null
        ? 0
        : previousSamePhraseStart + Math.max(MIN_REPEAT_PROGRESS_SEC, Math.round(getPhraseSearchWords(cleanFirstLine).length * 0.75));
      const searchStartSec = Math.max(lastStartSec + MIN_SECTION_PROGRESS_SEC, repeatAwareFloor);
      const expectedStartSec = durationSec != null
        ? Math.max(searchStartSec, Math.round((durationSec * index) / Math.max(totalSections, 1)))
        : searchStartSec;

      const directCandidates = findPhraseMatchesInTranscript(transcriptWords, cleanFirstLine, searchStartSec);
      const relaxedCandidates = directCandidates.length === 0 && previousSamePhraseStart != null
        ? findPhraseMatchesInTranscript(
          transcriptWords,
          cleanFirstLine,
          Math.max(lastStartSec + MIN_SECTION_PROGRESS_SEC, previousSamePhraseStart + 1),
        )
        : [];
      const match = selectPhraseMatch(
        directCandidates.length > 0 ? directCandidates : relaxedCandidates,
        expectedStartSec,
      );

      if (match) {
        lastStartSec = match.startSec;
        phraseLastMatchedStart.set(phraseKey, match.startSec);
        return {
          sectionName: section.name,
          startSec: match.startSec,
          confidence: Math.max(
            0,
            Math.min(
              1,
              match.confidence - (directCandidates.length === 0 && relaxedCandidates.length > 0 ? 0.05 : 0),
            ),
          ),
          method: 'whisper-match',
        };
      }

      return {
        sectionName: section.name,
        startSec: null,
        confidence: 0,
        method: 'no-match',
      };
    });

    const resolvedDuration = durationSec || 0;
    const firstWordStartSec = transcriptWords[0]?.start ?? 0;
    const lastWordEndSec = transcriptWords[transcriptWords.length - 1]?.end ?? resolvedDuration;

    const firstDetectedIndex = suggestedMarkers.findIndex((marker) => marker.startSec != null);
    if (firstDetectedIndex > 0) {
      fillMarkerGapWithStructure({
        markers: suggestedMarkers,
        sections,
        fromIndex: 0,
        toIndex: firstDetectedIndex - 1,
        rangeStartSec: 0,
        rangeEndSec: Math.max(0, suggestedMarkers[firstDetectedIndex]?.startSec ?? firstWordStartSec),
        method: 'hybrid-structure',
      });
    }

    const lastDetectedIndex = [...suggestedMarkers].reverse().findIndex((marker) => marker.startSec != null);
    const normalizedLastDetectedIndex =
      lastDetectedIndex >= 0 ? suggestedMarkers.length - 1 - lastDetectedIndex : -1;

    if (normalizedLastDetectedIndex >= 0 && normalizedLastDetectedIndex < suggestedMarkers.length - 1) {
      fillMarkerGapWithStructure({
        markers: suggestedMarkers,
        sections,
        fromIndex: normalizedLastDetectedIndex + 1,
        toIndex: suggestedMarkers.length - 1,
        rangeStartSec: Math.max(
          (suggestedMarkers[normalizedLastDetectedIndex]?.startSec ?? 0) + MIN_SECTION_PROGRESS_SEC,
          Math.round(lastWordEndSec),
        ),
        rangeEndSec: resolvedDuration,
        method: 'hybrid-structure',
      });
    }

    for (let index = 0; index < suggestedMarkers.length; index += 1) {
      if (suggestedMarkers[index].startSec != null) continue;

      const previousIndex = findPreviousDetectedIndex(suggestedMarkers, index);
      const nextIndex = findNextDetectedIndex(suggestedMarkers, index);
      if (previousIndex < 0 || nextIndex < 0) continue;

      fillMarkerGapWithStructure({
        markers: suggestedMarkers,
        sections,
        fromIndex: previousIndex + 1,
        toIndex: nextIndex - 1,
        rangeStartSec: (suggestedMarkers[previousIndex]?.startSec ?? 0) + MIN_SECTION_PROGRESS_SEC,
        rangeEndSec: suggestedMarkers[nextIndex]?.startSec ?? resolvedDuration,
        method: 'hybrid-structure',
      });
    }

    for (let index = 0; index < suggestedMarkers.length; index += 1) {
      if (suggestedMarkers[index].startSec != null) continue;

      const previousIndex = findPreviousDetectedIndex(suggestedMarkers, index);
      const nextIndex = findNextDetectedIndex(suggestedMarkers, index);
      const previousSec = previousIndex >= 0 ? suggestedMarkers[previousIndex].startSec || 0 : 0;
      const nextSec = nextIndex >= 0
        ? suggestedMarkers[nextIndex].startSec || resolvedDuration
        : resolvedDuration;

      const sectionCountInsideGap = nextIndex >= 0
        ? nextIndex - previousIndex
        : suggestedMarkers.length - previousIndex - 1;
      const relativePosition = previousIndex >= 0
        ? index - previousIndex
        : index + 1;

      if (sectionCountInsideGap <= 0 || nextSec <= previousSec) {
        continue;
      }

      suggestedMarkers[index] = {
        ...suggestedMarkers[index],
        startSec: Math.round(previousSec + ((nextSec - previousSec) * (relativePosition / sectionCountInsideGap))),
        confidence: 0.3,
        method: 'interpolated',
      };
    }

    const markersWithCueSuggestions = clampMarkerOrder(suggestedMarkers).map((marker, index, source) => {
      const nextSectionStartSec = index < source.length - 1 ? source[index + 1]?.startSec ?? null : durationSec ?? null;
      return {
        ...marker,
        cueMarkers: buildCueMarkersForSection({
          transcriptWords,
          section: sections[index],
          sectionIndex: index,
          marker,
          nextSectionStartSec,
        }),
      };
    });

    return jsonResponse({
      success: true,
      markers: markersWithCueSuggestions,
      language,
      durationSec,
      wordCount: transcriptWords.length,
      transcriptPreview,
    });
  } catch (error) {
    console.error('[auto-markers] Server error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Error desconocido del servidor.',
    }, 500);
  }
};
