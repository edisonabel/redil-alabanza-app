// Canciones sin stems: la pista virtual de click (M4A de silencio armado al vuelo), la sesión de click
// y el proyecto REAPER hecho sobre el MP3 de la canción.
import assert from 'node:assert/strict';
import { buildClickCarrierUrl, buildSilentAacMp4, isClickCarrierUrl, readClickCarrierSeconds } from '../src/utils/silentClickCarrier.js';
import { buildClickOnlySession, isClickOnlySession } from '../src/utils/liveDirectorClickOnlySession.js';
import { buildPreparedReaperProject, reaperMediaPath } from '../src/utils/reaperPreparation.js';
import { parseReaperProject, reviewReaperProject } from '../src/utils/reaperProjectParser.js';

// URL de la pista: duración con hasta 3 decimales, entre 1 s y 30 min.
assert.equal(buildClickCarrierUrl(214.0183), '/api/live-director-click-carrier/214.018.m4a');
assert.equal(readClickCarrierSeconds('/api/live-director-click-carrier/214.018.m4a'), 214.018);
assert.equal(readClickCarrierSeconds('https://alabanzaredilestadio.com/api/live-director-click-carrier/90.m4a?v=1'), 90);
for (const bad of ['', '/api/live-director-click-carrier/0.5.m4a', '/api/live-director-click-carrier/1801.m4a', '/lab-media/0/0.m4a', '/api/live-director-click-carrier/abc.m4a']) {
  assert.equal(isClickCarrierUrl(bad), false, bad);
}
assert.equal(buildClickCarrierUrl(0), '');

// El M4A: cajas válidas, audio a partir del byte 65536 (la primera descarga del motor es solo
// encabezado) y cuadros de 1024 muestras que cubren toda la duración.
const bytes = buildSilentAacMp4(214.018);
const view = new DataView(bytes.buffer);
const boxes = [];
for (let offset = 0; offset < bytes.length;) {
  const size = view.getUint32(offset), type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
  boxes.push({ type, offset, size }); offset += size;
}
assert.deepEqual(boxes.map(box => box.type), ['ftyp', 'moov', 'free', 'mdat']);
const mdat = boxes.at(-1);
assert.equal(mdat.offset + 8, 64 * 1024, 'El audio empieza después de los primeros 64 KB');
assert.equal(mdat.offset + mdat.size, bytes.length);
const frames = Math.ceil(214.018 * 48000 / 1024);
assert.equal(mdat.size - 8, frames * 4, 'Un cuadro de silencio de 4 bytes por cada 1024 muestras');
assert.ok(frames * 1024 / 48000 - 214.018 < 1024 / 48000);
const text = new TextDecoder('latin1').decode(bytes.slice(0, 2048));
assert.ok(text.includes('mp4a') && text.includes('esds') && text.includes('soun'));
assert.ok(bytes.length < 200 * 1024, `5 minutos o menos pesan poco: ${bytes.length}`);
assert.throws(() => buildSilentAacMp4(0.2));

// La sesión de click: una sola pista virtual con la duración de FIN AUDIO.
const session = buildClickOnlySession({
  songId: 'song-1', songTitle: 'Oh tu fidelidad', finAudioSeconds: 214.018, appliedAt: '2026-10-27T00:00:00.000Z',
  sectionMarkers: [{ id: 'reaper-1', sectionName: 'Intro', startSec: 0 }],
  reaperTiming: { source: 'reaper-rpp', tempo: 75, meter: '4/4', unoSeconds: 0, finAudioSeconds: 214.018, appliedAt: '2026-10-27T00:00:00.000Z' },
});
assert.equal(session.tracks.length, 1); assert.equal(session.tracks[0].name, 'Click');
assert.equal(session.tracks[0].url, '/api/live-director-click-carrier/214.018.m4a');
assert.equal(isClickOnlySession(session), true);
assert.equal(isClickOnlySession({ tracks: [...session.tracks, { url: 'https://stems.alabanzaredilestadio.com/a.m4a' }] }), false, 'Con stems reales no es de solo click');
assert.throws(() => buildClickOnlySession({ songId: 's', songTitle: '', finAudioSeconds: null, appliedAt: '', sectionMarkers: [], reaperTiming: {} }));

// Proyecto sobre el MP3: el MP3 final es la única pista de referencia, el RPP queda vinculado y, ya
// marcado (UNO, secciones y FIN AUDIO), el servidor no tiene nada que bloquear aunque no haya stems.
const reference = { id: 'referencia-mp3', name: 'Canción (referencia)', url: '/api/mp3-proxy?src=https%3A%2F%2Fstems.alabanzaredilestadio.com%2F1778980074403_oh_tu_fidelidad&v=3', sourceFileName: 'referencia.mp3' };
const mediaPath = reaperMediaPath(reference, 0);
assert.match(mediaPath, /\.mp3$/, 'El RPP referencia un archivo .mp3 aunque la URL no lo diga');
const song = { id: 'song-1', titulo: 'Oh tu fidelidad', section_markers: [{ sectionName: 'Intro', startSec: 0 }, { sectionName: 'Verso 1', startSec: 17 }], multitrack_session: null };
const { projectText } = buildPreparedReaperProject({ song, tracks: [{ ...reference, mediaPath, durationSeconds: 214.018 }] });
assert.match(projectText, /ALABANZA_MAPA_V1:song-1/);
const marked = projectText.replaceAll('[BORRADOR] ', '').replace(/  MARKER 1 /, '  MARKER 50 0 "UNO" 0 0 1\n  MARKER 1 ');
const review = reviewReaperProject(parseReaperProject(marked), song);
const blockers = ['drafts', 'uno', 'end', 'invalid', 'tempo', 'audio-moved', 'no-media', 'unverified-media', 'trimmed', 'song', 'unbound', 'duplicate-anchor', 'duplicate-time', 'duplicate-name', 'duplicate-id', 'outside', 'tail', 'range', 'tempo-map', 'media-count'];
assert.deepEqual(review.issues.filter(issue => blockers.includes(issue.code)).map(issue => issue.code), [], JSON.stringify(review.issues));
console.log('click carrier: URL, M4A (audio after the first 64 KB), click-only session and MP3 reference project passed.');
