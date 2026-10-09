import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeetingStore } from '../src/meetings.js';
const plan = { destination: 'Shopping', creator: 0, participants: [
  { name: 'Bruno', origin: '', mode: 'car', location: { latitude: -12.98, longitude: -38.45, accuracy: 30 }, gpsConsent: true },
  { name: 'Cleide', origin: '', mode: 'bus' },
] };
const route = async input => ({ durationSeconds: input.mode === 'bus' ? 1200 : input.location?.latitude === -12.97 ? 900 : 2100, source: 'Google Maps' });

test('convite sem origem alheia: cada token atualiza apenas seu transporte e GPS consentido', async () => {
  const store = createMeetingStore({ getRoute: route });
  const m = await store.create(plan);
  assert.equal(m.routes[1], null);
  assert.deepEqual(m.accepted, [true, false]);
  assert.equal(m.comparison.differenceSeconds, null);
  assert.equal(store.get(m.id, m.tokens[1]).plan.participants[1].location, null);
  assert.throws(() => store.location(m.id, m.tokens[1], { location: { latitude: -13, longitude: -38 } }), /Autorize/);
  await store.profile(m.id, m.tokens[1], { origin: 'Centro', mode: 'bus', viewer: 0, name: 'Outra' });
  const state = store.get(m.id, m.tokens[0]);
  assert.equal(state.plan.participants[0].mode, 'car');
  assert.equal(state.plan.participants[1].name, 'Cleide');
  assert.equal(state.plan.participants[1].mode, 'bus');
  assert.equal(state.comparison.waitingParticipant, 1);
  assert.equal(state.comparison.differenceSeconds, 900);
  assert.throws(() => store.location(m.id, 'wrong', { location: null }), e => e.status === 403);
  assert.throws(() => store.location(m.id, m.tokens[1], { location: { latitude: 91, longitude: 0 }, gpsConsent: true }), /inválida/);
  await assert.rejects(() => store.create({ ...plan, participants: [plan.participants[0], { ...plan.participants[1], location: { latitude: 0, longitude: 0 }, gpsConsent: true }] }), /Cada pessoa/);
});

test('GPS sem permissão, endereço vazio e transporte inválido são rejeitados antes de consultar', async () => {
  let calls = 0;
  const store = createMeetingStore({ getRoute: async input => { calls++; return route(input); } });
  await assert.rejects(() => store.create({ ...plan, participants: [{ ...plan.participants[0], gpsConsent: false }, plan.participants[1]] }), /Autorize/);
  await assert.rejects(() => store.create({ ...plan, participants: [{ ...plan.participants[0], location: null }, plan.participants[1]] }), /origem/);
  assert.equal(calls, 0);
  const m = await store.create(plan);
  await assert.rejects(() => store.profile(m.id, m.tokens[1], { origin: 'Centro', mode: 'plane' }), /transporte/);
  assert.equal(calls, 1);
});

test('GPS e refresco recalculam chegada; dois clientes compartilham cooldown e manual não reinicia duração', async () => {
  let at = 1000000, calls = 0;
  const store = createMeetingStore({ now: () => at, getRoute: async input => { calls++; return route(input); } });
  const m = await store.create(plan);
  await store.profile(m.id, m.tokens[1], { origin: 'Centro', mode: 'bus' });
  await store.depart(m.id, m.tokens[0]);
  await store.depart(m.id, m.tokens[1]);
  const before = store.get(m.id, m.tokens[0]);
  const manualArrival = before.arrivalAt[1];
  store.location(m.id, m.tokens[0], { location: { latitude: -12.97, longitude: -38.45 }, gpsConsent: true });
  const initialCalls = calls;
  await store.refresh(m.id, m.tokens[1]);
  assert.equal(calls, initialCalls);
  at += 120000;
  store.location(m.id, m.tokens[0], { location: { latitude: -12.97, longitude: -38.45 }, gpsConsent: true });
  await Promise.all([store.refresh(m.id, m.tokens[0]), store.refresh(m.id, m.tokens[1])]);
  assert.equal(calls, initialCalls + 1);
  const refreshed = store.get(m.id, m.tokens[1]);
  assert.equal(refreshed.arrivalAt[0], at + 900000);
  assert.equal(refreshed.arrivalAt[1], manualArrival);
  assert.equal(refreshed.comparison.waitingParticipant, 0);
  assert.equal(refreshed.comparison.differenceSeconds, 180);
  store.location(m.id, m.tokens[0], { location: null });
  assert.equal(store.get(m.id, m.tokens[1]).plan.participants[0].location, null);
  at += 120000;
  await store.refresh(m.id, m.tokens[0]);
  assert.equal(calls, initialCalls + 1);
  store.end(m.id, m.tokens[1]);
  assert.equal(store.get(m.id, m.tokens[0]).status, 'ended');
  await assert.rejects(() => store.refresh(m.id, m.tokens[0]), e => e.status === 409);
});

test('falha no refresco conserva previsões e impede repetição imediata de consultas', async () => {
  let at = 1000000, fail = false, calls = 0;
  const store = createMeetingStore({ now: () => at, getRoute: async input => { calls++; if (fail) throw new Error('Falha controlada'); return route(input); } });
  const m = await store.create(plan);
  const before = store.get(m.id, m.tokens[0]);
  at += 120000; fail = true;
  await assert.rejects(() => store.refresh(m.id, m.tokens[0]), /Falha controlada/);
  assert.deepEqual(store.get(m.id, m.tokens[0]).routes, before.routes);
  const count = calls;
  await store.refresh(m.id, m.tokens[1]);
  assert.equal(calls, count);
});

test('GPS antigo não recalcula a partir de uma posição desatualizada durante a viagem', async () => {
  let at = 1000000, calls = 0;
  const store = createMeetingStore({ now: () => at, getRoute: async input => { calls++; return route(input); } });
  const m = await store.create(plan);
  await store.depart(m.id, m.tokens[0]);
  const arrival = store.get(m.id, m.tokens[0]).arrivalAt[0], count = calls;
  at += 120000;
  await store.refresh(m.id, m.tokens[0]);
  assert.equal(calls, count);
  assert.equal(store.get(m.id, m.tokens[0]).arrivalAt[0], arrival);
});
