import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

const input = { destination: 'Shopping', participants: [
  { name: 'Bruno', origin: 'Pituba', mode: 'car' },
  { name: 'Cleide', origin: 'Centro', mode: 'transit' },
] };
const headers = { 'Content-Type': 'application/json', 'X-Meetsync-Client': '1' };

async function runtime(t, environment, limit = 20) {
  const calls = [];
  let used = 0;
  const budget = {
    status: async () => ({ used, limit, remaining: Math.max(0, limit - used) }),
    reserve: async () => {
      assert.ok(used < limit, 'Reserva deve respeitar o limite');
      used++;
    },
  };
  const server = createServer({ environment, budget, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://routes.googleapis.com/directions/v2:computeRoutes');
    assert.equal(options.headers['X-Goog-Api-Key'], 'test-only-key');
    const body = JSON.parse(options.body);
    calls.push(body);
    return new Response(JSON.stringify({ routes: [{ duration: body.travelMode === 'DRIVE' ? '2100s' : '1200s' }] }));
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = () => fetch(base + '/api/config').then(response => response.json());
  const create = () => fetch(base + '/api/meetings', { method: 'POST', headers, body: JSON.stringify(input) });
  return { calls, base, config, create };
}

test('HTTP: chave presente não habilita Google sem ativação explícita', async t => {
  for (const enabled of [undefined, 'false', 'TRUE']) {
    const app = await runtime(t, { GOOGLE_MAPS_API_KEY: 'test-only-key', GOOGLE_ROUTES_ENABLED: enabled });
    assert.equal((await app.config()).googleMapsConfigured, false);
    assert.equal((await app.create()).status, 503);
    assert.equal(app.calls.length, 0);
    assert.equal((await app.config()).routeUsage.used, 0);
  }
});

test('HTTP: ativação sem chave e limite zero não enviam consultas', async t => {
  const missing = await runtime(t, { GOOGLE_ROUTES_ENABLED: 'true' });
  assert.equal((await missing.config()).googleMapsConfigured, false);
  const response = await missing.create();
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /GOOGLE_MAPS_API_KEY/);
  assert.equal(missing.calls.length, 0);
  const paused = await runtime(t, { GOOGLE_ROUTES_ENABLED: 'true', GOOGLE_MAPS_API_KEY: 'test-only-key' }, 0);
  assert.equal((await paused.create()).status, 429);
  assert.equal(paused.calls.length, 0);
});

test('HTTP: ativação conecta carro e transporte público, saída compartilhada e contador sem expor chave', async t => {
  const app = await runtime(t, { GOOGLE_ROUTES_ENABLED: 'true', GOOGLE_MAPS_API_KEY: 'test-only-key' });
  const config = await app.config();
  assert.equal(config.googleMapsConfigured, true);
  assert.equal(config.paidGoogleDisabled, false);
  assert.ok(!JSON.stringify(config).includes('test-only-key'));
  const response = await app.create();
  assert.equal(response.status, 201);
  const meeting = await response.json();
  assert.ok(!JSON.stringify(meeting).includes('test-only-key'));
  assert.deepEqual(app.calls.map(call => call.travelMode), ['DRIVE', 'TRANSIT']);
  const departure = await fetch(app.base + `/api/meetings/${meeting.id}/depart`, {
    method: 'POST', headers: { ...headers, 'X-Meeting-Token': meeting.tokens[0] }, body: '{}',
  });
  assert.equal(departure.status, 200);
  const cleide = await fetch(app.base + `/api/meetings/${meeting.id}`, {
    headers: { 'X-Meeting-Token': meeting.tokens[1] },
  }).then(response => response.json());
  assert.equal(cleide.status, 'waiting');
  assert.equal(cleide.recommendedDepartureAt[1] - cleide.departedAt[0], 900000);
  assert.equal((await app.config()).routeUsage.used, app.calls.length);
  assert.ok(app.calls.length >= 4 && app.calls.length <= 5);
});
