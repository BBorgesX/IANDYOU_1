import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGooglePlaces } from '../src/services/google-places.js';
import { createRouteBudget } from '../src/services/route-budget.js';

test('Places: autocompletar filtra Brasil e retorna apenas IDs e descrições, sem chave', async () => {
  let calls = 0, reservations = 0;
  const places = createGooglePlaces({ enabled: true, apiKey: 'test-only-key', budget: { reserve: async () => { reservations++; } }, fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://places.googleapis.com/v1/places:autocomplete');
    assert.equal(options.headers['X-Goog-Api-Key'], 'test-only-key');
    const body = JSON.parse(options.body);
    assert.equal(body.input, 'Shopping'); assert.deepEqual(body.includedRegionCodes, ['br']);
    return new Response(JSON.stringify({ suggestions: [{ placePrediction: { placeId: 'id-one', text: { text: 'Shopping da Bahia, Salvador' }, secret: 'private' } }, { queryPrediction: {} }] }));
  } });
  assert.deepEqual(await places('Sho'), []); assert.equal(calls, 0);
  assert.deepEqual(await places(' Shopping '), [{ placeId: 'id-one', description: 'Shopping da Bahia, Salvador' }]);
  assert.equal(calls, 1); assert.equal(reservations, 1);
});

test('Places bloqueado, sem chave e sem saldo nunca consulta o provedor', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('Não pode consultar'); };
  for (const options of [{ enabled: false, apiKey: 'test-only-key' }, { enabled: true, apiKey: '' }]) {
    await assert.rejects(() => createGooglePlaces({ ...options, fetchImpl })('Shopping'), e => e.status === 503);
  }
  const directory = pathToFileURL((await mkdtemp(join(tmpdir(), 'meetsync-places-'))) + '/');
  const budget = createRouteBudget({ directory, filename: 'google-places-usage.json', limit: 0 });
  await assert.rejects(() => createGooglePlaces({ enabled: true, apiKey: 'test-only-key', budget, fetchImpl })('Shopping'), e => e.status === 429);
  assert.equal(calls, 0);
});

test('contadores separados: erro de Places conta como tentativa sem consumir cota de rotas', async () => {
  const directory = pathToFileURL((await mkdtemp(join(tmpdir(), 'meetsync-places-'))) + '/');
  const routes = createRouteBudget({ directory, limit: 20 });
  const places = createRouteBudget({ directory, filename: 'google-places-usage.json', limit: 1 });
  let calls = 0;
  const autocomplete = createGooglePlaces({ enabled: true, apiKey: 'test-only-key', budget: places, fetchImpl: async () => { calls++; return new Response('{}', { status: 403 }); } });
  await assert.rejects(() => autocomplete('Shopping'), /Places API/);
  await assert.rejects(() => autocomplete('Centro'), e => e.status === 429);
  assert.equal(calls, 1); assert.equal((await places.status()).used, 1); assert.equal((await routes.status()).used, 0);
});
