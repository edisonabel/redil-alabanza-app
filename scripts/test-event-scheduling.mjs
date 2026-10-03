import assert from 'node:assert/strict';
import { canManageEventAssignments, isLeaderForEventMinistry } from '../src/lib/event-management-permissions.js';
import { getInstrumentSlotCount } from '../src/lib/roster-utils.js';
import { getSinFiltrosNotice } from '../src/lib/service-status.js';

for (const allowed of [true, false, null, 'true']) {
  const calls = [];
  const database = { rpc: async (...args) => { calls.push(args); return { data: allowed, error: null }; } };
  assert.equal(await canManageEventAssignments(database, 'event-id'), allowed === true);
  assert.deepEqual(calls, [['can_manage_event_assignments', { evt_id: 'event-id' }]]);
}
const unavailable = new Error('database unavailable');
await assert.rejects(() => canManageEventAssignments({ rpc: async () => ({ error: unavailable }) }, 'event-id'), unavailable);
assert.equal(getInstrumentSlotCount('guitarra_acustica', true), 2);
assert.equal(getInstrumentSlotCount('guitarra_acustica', false), 1);
assert.equal(getInstrumentSlotCount('guitarra_electrica', true), 1);
const canceled = { ministerios: { codigo: 'sin_filtros' }, sin_servicio_motivo: '  Asamblea de miembros  ' };
assert.deepEqual(getSinFiltrosNotice(canceled), { title: 'Este sábado no hay Sin Filtros', reason: 'Asamblea de miembros' });
assert.equal(getSinFiltrosNotice({ ...canceled, ministerios: { codigo: 'alabanza_general' } }), null);
assert.equal(getSinFiltrosNotice({ ...canceled, sin_servicio_motivo: ' ' }), null);
assert.equal(getSinFiltrosNotice({ ...canceled, sin_servicio_motivo: null }), null);
console.log('event scheduling: shared authorization, acoustic capacity, Sin Filtros notices: ok');

assert.equal(isLeaderForEventMinistry({ ministerio_id: 'sf' }, ['sf'], 'general'), true);
assert.equal(isLeaderForEventMinistry({ ministerio_id: 'general' }, ['sf'], 'general'), false);
assert.equal(isLeaderForEventMinistry({ ministerio_id: null }, ['general'], 'general'), true);
assert.equal(isLeaderForEventMinistry({ ministerio_id: null }, ['sf'], 'general'), false);
assert.equal(isLeaderForEventMinistry({}, [], ''), false);
