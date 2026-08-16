import assert from 'node:assert/strict';
import {
  buildCustomSetlistPath,
  decodeCustomSetlistPlaylistId,
  encodeCustomSetlistPlaylistId,
  parseCustomSetlistRouteId,
} from '../src/utils/customSetlistShare.ts';

const playlistId = '6f9619ff-8b86-d011-b42d-00cf4fc964ff';
const token = encodeCustomSetlistPlaylistId(playlistId);

assert.equal(typeof token, 'string');
assert.equal(token.length, 22, 'El token compartido debe ocupar 22 caracteres.');
assert.match(token, /^[A-Za-z0-9_-]{22}$/, 'El token debe ser URL-safe.');
assert.equal(decodeCustomSetlistPlaylistId(token), playlistId);
assert.equal(buildCustomSetlistPath(playlistId), `/ensayo/p-${token}`);
assert.equal(parseCustomSetlistRouteId(`p-${token}`), playlistId);
assert.equal(parseCustomSetlistRouteId(token), null);
assert.equal(decodeCustomSetlistPlaylistId('not-valid'), null);
assert.equal(encodeCustomSetlistPlaylistId('not-a-uuid'), null);

console.log('custom setlist share ID tests passed');
