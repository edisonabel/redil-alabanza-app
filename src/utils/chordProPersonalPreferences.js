export const CHORD_PRO_PERSONAL_PREFERENCES_TABLE = 'cancion_chart_preferencias_usuario';
export const CHORD_PRO_PERSONAL_NOTES_MAX_LENGTH = 1000;

export const DEFAULT_CHORD_PRO_PERSONAL_PREFERENCES = Object.freeze({
  personalNotes: '',
  targetTone: '',
  capoFret: 0,
  renderMode: 'chords-lyrics',
  columnCount: 2,
  density: 'complete',
  showSongMap: true,
  showSectionDividers: true,
  pageMode: 'one',
});

/** @typedef {'chords-lyrics' | 'lyrics-only' | 'chords-only'} ChordProPersonalRenderMode */
/** @typedef {'complete' | 'condensed'} ChordProPersonalDensity */
/** @typedef {'one' | 'two'} ChordProPersonalPageMode */
/**
 * @typedef {Object} ChordProPersonalPreferences
 * @property {string} personalNotes
 * @property {string} targetTone
 * @property {number} capoFret
 * @property {ChordProPersonalRenderMode} renderMode
 * @property {1 | 2} columnCount
 * @property {ChordProPersonalDensity} density
 * @property {boolean} showSongMap
 * @property {boolean} showSectionDividers
 * @property {ChordProPersonalPageMode} pageMode
 */

const tones = new Set(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);

/** @param {unknown} value @returns {ChordProPersonalPreferences} */
export const sanitizeChordProPersonalPreferences = (value = {}) => {
  const source = value && typeof value === 'object' ? value : {};
  const rawCapo = Number(source.capoFret ?? source.capo_fret ?? 0);
  const rawTone = String(source.targetTone ?? source.target_tone ?? '').trim();
  const rawNotes = String(source.personalNotes ?? source.personal_notes ?? '').replace(/\r\n?/g, '\n');

  return {
    personalNotes: rawNotes.slice(0, CHORD_PRO_PERSONAL_NOTES_MAX_LENGTH),
    targetTone: tones.has(rawTone) ? rawTone : '',
    capoFret: Number.isFinite(rawCapo) ? Math.max(0, Math.min(7, Math.round(rawCapo))) : 0,
    renderMode: ['chords-lyrics', 'lyrics-only', 'chords-only'].includes(source.renderMode)
      ? /** @type {ChordProPersonalRenderMode} */ (source.renderMode)
      : DEFAULT_CHORD_PRO_PERSONAL_PREFERENCES.renderMode,
    columnCount: Number(source.columnCount) === 1 ? /** @type {1} */ (1) : /** @type {2} */ (2),
    density: source.density === 'condensed'
      ? /** @type {ChordProPersonalDensity} */ ('condensed')
      : /** @type {ChordProPersonalDensity} */ ('complete'),
    showSongMap: source.showSongMap !== false,
    showSectionDividers: source.showSectionDividers !== false,
    pageMode: source.pageMode === 'two'
      ? /** @type {ChordProPersonalPageMode} */ ('two')
      : /** @type {ChordProPersonalPageMode} */ ('one'),
  };
};

export const buildChordProPersonalPreferencesRow = ({ userId, songId, preferences } = {}) => {
  const safePreferences = sanitizeChordProPersonalPreferences(preferences);
  return {
    perfil_id: String(userId || '').trim(),
    cancion_id: String(songId || '').trim(),
    notas_personales: safePreferences.personalNotes,
    preferencias: {
      targetTone: safePreferences.targetTone,
      capoFret: safePreferences.capoFret,
      renderMode: safePreferences.renderMode,
      columnCount: safePreferences.columnCount,
      density: safePreferences.density,
      showSongMap: safePreferences.showSongMap,
      showSectionDividers: safePreferences.showSectionDividers,
      pageMode: safePreferences.pageMode,
    },
  };
};
