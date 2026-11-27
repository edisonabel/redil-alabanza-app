// Pure helpers for the rehearsal sequence player (ModoEnsayoSecuencia).
// They classify a song's multitrack stems into musician-facing groups,
// compute per-track gains for each practice mode and map section markers
// onto the ChordPro sheet. No React, no audio: safe to unit test in Node.
import { categorizeStemName, STEM_CATEGORIES } from './stemCategories.ts';
import { normalizeSectionLabel } from './sectionVisuals.ts';

// What plays: the multitrack sequence or the reference recording.
export const REHEARSAL_SOURCES = ['secuencia', 'original'];

// What happens to "my instrument" inside the sequence.
export const REHEARSAL_PART_MODES = ['normal', 'aumentada', 'aislada', 'muteada'];

export const REHEARSAL_PART_MODE_HINTS = {
  normal: 'Toda la secuencia, como suena en vivo.',
  aumentada: 'Tu instrumento más fuerte para aprenderlo.',
  aislada: 'Solo tu instrumento con click y guía, para sacar el arreglo.',
  muteada: 'Sin tu instrumento: tócalo tú con la banda.',
};

// Event role code -> stem categories that belong to that musician.
export const ROLE_PART_CATEGORIES = {
  bateria: ['drums', 'percussion', 'cymbals'],
  bajo: ['bass', 'synthBass'],
  piano: ['piano', 'keys', 'organ', 'synth'],
  teclado: ['piano', 'keys', 'organ', 'synth'],
  teclados: ['piano', 'keys', 'organ', 'synth'],
  guitarra_electrica: ['electric'],
  guitarra_acustica: ['acoustic'],
  guitarra: ['electric', 'acoustic'],
  coro: ['vocals', 'choir'],
};

export const REHEARSAL_GROUPS = [
  { id: 'click', label: 'Click', categories: ['click', 'cues'], control: true },
  { id: 'guia', label: 'Guía', categories: ['guide'], control: true },
  { id: 'bateria', label: 'Batería', categories: ['drums', 'percussion', 'cymbals'] },
  { id: 'bajo', label: 'Bajo', categories: ['bass', 'synthBass'] },
  { id: 'teclas', label: 'Teclas', categories: ['piano', 'keys', 'organ', 'synth', 'pads'] },
  { id: 'guitarras', label: 'Guitarras', categories: ['acoustic', 'electric', 'banjo', 'mandolin', 'ukulele'] },
  { id: 'orquesta', label: 'Orquesta', categories: ['violin', 'strings', 'brass', 'woodwinds'] },
  { id: 'voces', label: 'Voces', categories: ['vocals', 'choir'] },
  { id: 'otros', label: 'Otros', categories: ['sequence', 'misc', 'unknown'] },
];

const GROUP_BY_CATEGORY = new Map(
  REHEARSAL_GROUPS.flatMap((group) => group.categories.map((category) => [category, group])),
);

// Gain multipliers for the "learn" (aumentada) mode.
export const AUMENTADA_PART_BOOST = 1.8;
export const AUMENTADA_OTHERS_DUCK = 0.45;
export const MAX_TRACK_GAIN = 2;
export const MAX_GROUP_LEVEL = 1.5;

const PAD_NAME_RE = /(^|[^a-z])pad+s?([^a-z]|$)/i;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const toFiniteNumber = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

/**
 * Turns persisted Live Director tracks into rehearsal tracks with a group.
 * Disabled tracks and tracks without a playable URL are dropped.
 */
export const classifyRehearsalTracks = (tracks = []) => (
  (Array.isArray(tracks) ? tracks : [])
    .filter((track) => track && track.id && track.enabled !== false)
    .map((track) => {
      const url = String(track.optimizedUrl || track.url || track.iosUrl || track.nativeUrl || '').trim();
      if (!url) return null;
      const byFile = categorizeStemName(String(track.sourceFileName || ''));
      const byName = byFile !== 'unknown' ? byFile : categorizeStemName(String(track.name || ''));
      // "03 Padd", "Pads 2": pads named outside the catalog are still pads.
      const category = byName === 'unknown' && PAD_NAME_RE.test(`${track.name || ''} ${track.sourceFileName || ''}`) ? 'pads' : byName;
      const group = GROUP_BY_CATEGORY.get(category) || GROUP_BY_CATEGORY.get('unknown');
      return {
        id: String(track.id),
        name: String(track.name || track.id),
        url,
        sourceFileName: track.sourceFileName || '',
        baseVolume: clamp(toFiniteNumber(track.volume, 0.75), 0, MAX_TRACK_GAIN),
        // A stem silenced in the live mix (someone plays it live) still needs a
        // level when it is your part to raise or isolate: its category default.
        partVolume: toFiniteNumber(track.volume, 0.75) > 0.05
          ? clamp(toFiniteNumber(track.volume, 0.75), 0, MAX_TRACK_GAIN)
          : clamp(toFiniteNumber(STEM_CATEGORIES[category]?.volume, 0.75), 0, MAX_TRACK_GAIN),
        category,
        groupId: group.id,
        isControl: Boolean(group.control),
        activityEnvelope: track.activityEnvelope || null,
      };
    })
    .filter(Boolean)
);

/** Groups that actually have tracks, in display order. */
export const listPresentGroups = (classifiedTracks = []) => {
  const present = new Set(classifiedTracks.map((track) => track.groupId));
  return REHEARSAL_GROUPS.filter((group) => present.has(group.id));
};

/**
 * Whether the stems are a real backing sequence to rehearse with: one full
 * "Sequence" stem or at least two instruments besides the pad. Songs uploaded
 * with only click, guide and a pad (or a single instrument) keep the normal
 * rehearsal over the mp3.
 */
export const hasFullRehearsalSequence = (classifiedTracks = []) => {
  const band = classifiedTracks.filter((track) => !track.isControl && track.category !== 'pads');
  return band.some((track) => track.category === 'sequence') || band.length >= 2;
};

/** Tracks the musician can pick as "mi parte" (anything but click/guide). */
export const listPartCandidates = (classifiedTracks = []) => (
  classifiedTracks.filter((track) => !track.isControl)
);

/**
 * Per-track gain for the current practice settings.
 * Original mode returns all zeros: the engine is paused and the reference mp3 plays.
 */
export const computeRehearsalTrackGains = ({
  tracks = [],
  source = 'secuencia',
  partMode = 'normal',
  partTrackIds = [],
  groupLevels = {},
  mutedGroups = {},
} = {}) => {
  const partIds = new Set((Array.isArray(partTrackIds) ? partTrackIds : []).map(String));
  const hasPart = partIds.size > 0;

  return tracks.reduce((gains, track) => {
    const isPart = partIds.has(track.id);
    if (source === 'original') {
      gains[track.id] = 0;
      return gains;
    }
    // Isolating my instrument ignores the group mixer for it: you always hear it.
    // Click and guide stay (with their mixer level/mute) to keep time and form.
    if (hasPart && partMode === 'aislada' && !track.isControl) {
      gains[track.id] = isPart ? Math.round(clamp(track.partVolume ?? track.baseVolume, 0, MAX_TRACK_GAIN) * 1000) / 1000 : 0;
      return gains;
    }
    if (mutedGroups?.[track.groupId]) {
      gains[track.id] = 0;
      return gains;
    }
    const groupLevel = clamp(toFiniteNumber(groupLevels?.[track.groupId], 1), 0, MAX_GROUP_LEVEL);
    let gain = track.baseVolume * groupLevel;

    if (hasPart && !track.isControl) {
      if (partMode === 'aumentada') {
        gain = isPart
          ? (track.partVolume ?? track.baseVolume) * groupLevel * AUMENTADA_PART_BOOST
          : gain * AUMENTADA_OTHERS_DUCK;
      } else if (partMode === 'muteada' && isPart) {
        gain = 0;
      }
    }

    gains[track.id] = Math.round(clamp(gain, 0, MAX_TRACK_GAIN) * 1000) / 1000;
    return gains;
  }, {});
};

/**
 * Picks the stems that match the musician's event roles (e.g. `bajo` -> Bass).
 * Unknown role codes fall back to the stem name catalog (`categorizeStemName`).
 */
export const suggestPartTrackIds = (classifiedTracks = [], roleCodes = []) => {
  const categories = new Set();
  (Array.isArray(roleCodes) ? roleCodes : []).forEach((rawCode) => {
    const code = String(rawCode || '').trim().toLowerCase();
    if (!code) return;
    if (ROLE_PART_CATEGORIES[code]) {
      ROLE_PART_CATEGORIES[code].forEach((category) => categories.add(category));
      return;
    }
    if (code.startsWith('voz_')) return; // Lead/vocal roles sing over the guide; no stem to own.
    const guessed = categorizeStemName(code.replace(/_/g, ' '));
    if (guessed !== 'unknown') categories.add(guessed);
  });
  return classifiedTracks
    .filter((track) => !track.isControl && categories.has(track.category))
    .map((track) => track.id);
};

/**
 * Maps timeline sections (from section markers) to indexes of the ChordPro
 * sheet sections, using the marker's explicit index, then name occurrence,
 * then the next matching name in order.
 */
export const mapTimelineToSheetSections = (timeline = [], sheetSections = [], rawMarkers = []) => {
  const markerById = new Map(
    (Array.isArray(rawMarkers) ? rawMarkers : [])
      .filter((marker) => marker && marker.id)
      .map((marker) => [String(marker.id), marker]),
  );
  const sheetNames = (Array.isArray(sheetSections) ? sheetSections : [])
    .map((section) => normalizeSectionLabel(section?.name || ''));
  let searchFrom = 0;

  return timeline.map((entry, index) => {
    const raw = markerById.get(String(entry.id)) || {};
    const name = normalizeSectionLabel(entry.name || raw.sectionName || '');
    let sheetIndex = Number.isInteger(raw.sectionIndex) && raw.sectionIndex >= 0 && raw.sectionIndex < sheetNames.length
      ? raw.sectionIndex
      : -1;

    if (sheetIndex === -1 && Number.isInteger(raw.sectionOccurrence)) {
      let seen = 0;
      sheetIndex = sheetNames.findIndex((sheetName) => {
        if (sheetName !== name) return false;
        seen += 1;
        return seen === raw.sectionOccurrence;
      });
    }
    if (sheetIndex === -1) {
      sheetIndex = sheetNames.findIndex((sheetName, candidate) => candidate >= searchFrom && sheetName === name);
    }
    if (sheetIndex === -1) {
      sheetIndex = sheetNames.findIndex((sheetName) => sheetName === name);
    }
    if (sheetIndex === -1) {
      sheetIndex = Math.min(index, Math.max(sheetNames.length - 1, 0));
    }
    searchFrom = Math.max(searchFrom, sheetIndex + 1);
    return { ...entry, sheetIndex };
  });
};

export const findTimelineIndexAt = (timeline = [], time = 0) => {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    if (time >= timeline[index].startTime - 0.05) return index;
  }
  return -1;
};

/**
 * Full song length from the stems' activity envelopes. Streaming stems only
 * report the duration they have downloaded so far, so the UI needs this.
 */
export const estimateEnvelopeDuration = (tracks = []) => tracks.reduce((max, track) => {
  const envelope = track?.activityEnvelope;
  const bucketMs = Number(envelope?.bucketMs);
  if (!Array.isArray(envelope?.values) || !(bucketMs > 0)) return max;
  return Math.max(max, (envelope.values.length * bucketMs) / 1000);
}, 0);

/**
 * Combines the activity envelopes of the musical stems into `bars` values (0..1)
 * for a lightweight waveform. Returns [] when no envelope is available.
 */
export const buildCombinedWaveform = (tracks = [], durationSeconds = 0, bars = 120) => {
  const withEnvelope = tracks.filter((track) => (
    !track.isControl &&
    Array.isArray(track.activityEnvelope?.values) &&
    track.activityEnvelope.values.length > 0 &&
    Number(track.activityEnvelope.bucketMs) > 0
  ));
  if (withEnvelope.length === 0 || !(durationSeconds > 0) || bars <= 0) return [];

  const values = Array.from({ length: bars }, (_unused, barIndex) => {
    const startMs = (barIndex / bars) * durationSeconds * 1000;
    const endMs = ((barIndex + 1) / bars) * durationSeconds * 1000;
    let sum = 0;
    withEnvelope.forEach(({ activityEnvelope }) => {
      const { bucketMs, values: buckets } = activityEnvelope;
      const from = Math.floor(startMs / bucketMs);
      const to = Math.max(from + 1, Math.ceil(endMs / bucketMs));
      let peak = 0;
      for (let bucket = from; bucket < to && bucket < buckets.length; bucket += 1) {
        peak = Math.max(peak, Number(buckets[bucket]) || 0);
      }
      sum += peak;
    });
    return sum / withEnvelope.length;
  });
  const max = Math.max(...values, 0.0001);
  return values.map((value) => Math.round((value / max) * 100) / 100);
};

// ---- Per-user preferences (localStorage, phase 1) ----

const PREFS_PREFIX = 'redil:ensayo-secuencia:v1';

export const buildRehearsalMixPrefsKey = ({ userId = '', songId = '' } = {}) => (
  `${PREFS_PREFIX}:${encodeURIComponent(String(userId || 'anon'))}:${encodeURIComponent(String(songId || 'song'))}`
);

export const sanitizeRehearsalMixPrefs = (value = {}, validTrackIds = null) => {
  const valid = validTrackIds ? new Set(validTrackIds.map(String)) : null;
  const partTrackIds = (Array.isArray(value?.partTrackIds) ? value.partTrackIds : [])
    .map(String)
    .filter((id) => !valid || valid.has(id));
  const groupLevels = {};
  const mutedGroups = {};
  REHEARSAL_GROUPS.forEach(({ id }) => {
    if (value?.groupLevels && id in value.groupLevels) {
      groupLevels[id] = clamp(toFiniteNumber(value.groupLevels[id], 1), 0, MAX_GROUP_LEVEL);
    }
    if (value?.mutedGroups?.[id]) mutedGroups[id] = true;
  });
  return {
    source: REHEARSAL_SOURCES.includes(value?.source) ? value.source : 'secuencia',
    partMode: REHEARSAL_PART_MODES.includes(value?.partMode) ? value.partMode : 'normal',
    hasChosenPart: Boolean(value?.hasChosenPart),
    // Sings and the sequence has no vocal stems: nothing to raise or isolate.
    singer: Boolean(value?.singer),
    partTrackIds,
    groupLevels,
    mutedGroups,
    master: clamp(toFiniteNumber(value?.master, 1), 0, 1),
  };
};
