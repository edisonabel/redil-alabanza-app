import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildChordProPersonalPreferencesRow,
  CHORD_PRO_PERSONAL_NOTES_MAX_LENGTH,
  sanitizeChordProPersonalPreferences,
} from '../src/utils/chordProPersonalPreferences.js';

const sanitized = sanitizeChordProPersonalPreferences({
  personal_notes: `  guitarra entra en coro 2  ${'x'.repeat(1100)}`,
  target_tone: 'F#',
  capo_fret: 12,
  renderMode: 'lyrics-only',
  columnCount: 1,
  density: 'condensed',
  showSongMap: false,
  pageMode: 'two',
});

assert.equal(sanitized.personalNotes.length, CHORD_PRO_PERSONAL_NOTES_MAX_LENGTH);
assert.equal(sanitized.targetTone, 'F#');
assert.equal(sanitized.capoFret, 7);
assert.equal(sanitized.renderMode, 'lyrics-only');
assert.equal(sanitized.columnCount, 1);
assert.equal(sanitized.density, 'condensed');
assert.equal(sanitized.showSongMap, false);
assert.equal(sanitized.pageMode, 'two');

const row = buildChordProPersonalPreferencesRow({
  userId: 'musician-a',
  songId: 'song-1',
  preferences: sanitized,
});
assert.equal(row.perfil_id, 'musician-a');
assert.equal(row.cancion_id, 'song-1');
assert.equal(row.notas_personales, sanitized.personalNotes);
assert.equal(row.preferencias.targetTone, 'F#');
assert.equal(row.preferencias.capoFret, 7);
assert.equal('evento_id' in row, false, 'personal chart preferences must not be scoped to or mutate an event');

const migration = await readFile(new URL('../migrations/056_chordpro_personal_preferences.sql', import.meta.url), 'utf8');
assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
assert.match(migration, /auth\.uid\(\)\s*=\s*perfil_id/i, 'database policy must isolate each musician account');
assert.match(migration, /UNIQUE\s*\(perfil_id,\s*cancion_id\)/i, 'records must be isolated per musician and song');
assert.doesNotMatch(migration, /evento_id/i, 'personal charts must not be stored on a shared event');

const safeDefaults = sanitizeChordProPersonalPreferences({ personalNotes: 42, targetTone: 'H', pageMode: 'auto' });
assert.equal(safeDefaults.personalNotes, '42');
assert.equal(safeDefaults.targetTone, '');
assert.equal(safeDefaults.pageMode, 'one');

console.log('ChordPro personal preferences sanitize correctly and remain per-user/per-song.');
