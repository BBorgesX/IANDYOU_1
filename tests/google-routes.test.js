import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleRoutes} from '../src/services/google-routes.js';

test('Google Routes: envia endereço, transporte, trânsito e recebe duração em segundos', async () => {
 let request;
 const route=createGoogleRoutes({allowPaidRequests:true,budget:{reserve:async()=>{}},apiKey:'test-only-key', fetchImpl:async(url, options)=>{request={url,options};return new Response(JSON.stringify({routes:[{duration:'2100s',distanceMeters:12000}]}));}});
 const result=await route({origin:'Pituba, Salvador',destination:'Shopping da Bahia, Salvador',mode:'car',departureAt:Date.now()+3600000});
 assert.equal(request.url,'https://routes.googleapis.com/directions/v2:computeRoutes');
 assert.equal(request.options.headers['X-Goog-Api-Key'],'test-only-key');
 assert.equal(request.options.headers['X-Goog-FieldMask'],'routes.duration,routes.distanceMeters');
 const payload=JSON.parse(request.options.body);
 assert.deepEqual(payload.origin,{address:'Pituba, Salvador'});
 assert.equal(payload.travelMode,'DRIVE');
 assert.equal(payload.routingPreference,'TRAFFIC_AWARE');
 assert.ok(payload.departureTime);
 assert.equal(result.durationSeconds,2100);
 assert.equal(result.source,'Google Maps');
});
test('transporte público envia TRANSIT e caminhada omite horário e trânsito',async()=>{
 for(const [mode,expected] of [['walk','WALK'],['transit','TRANSIT']]) {
  let body;
  const route=createGoogleRoutes({allowPaidRequests:true,budget:{reserve:async()=>{}},apiKey:'test-only-key',fetchImpl:async(_,opts)=>{body=JSON.parse(opts.body);return new Response(JSON.stringify({routes:[{duration:'1200.5s'}]}));}});
  const result=await route({origin:'A',destination:'B',mode,departureAt:Date.now()});
  assert.equal(body.travelMode,expected);
  assert.equal(body.routingPreference,undefined);
  assert.equal(!!body.departureTime,mode==='transit');
  assert.equal(result.durationSeconds,1200.5);
 }
});
test('chave ausente não gera tempos falsos nem realiza requisição',async()=>{
 const route=createGoogleRoutes({allowPaidRequests:true,budget:{reserve:async()=>{}},apiKey:'',fetchImpl:()=>{throw new Error('Não deveria consultar');}});
 await assert.rejects(()=>route({mode:'car'}),e=>e.status===503 && /GOOGLE_MAPS_API_KEY/.test(e.message));
});
test('erros de acesso, quota, rede, rotas ausentes e duração inválida são explícitos',async()=>{
 for(const status of [403,429,500]) {
  const route=createGoogleRoutes({allowPaidRequests:true,budget:{reserve:async()=>{}},apiKey:'test-only-key',fetchImpl:async()=>new Response('{}',{status})});
  await assert.rejects(()=>route({origin:'A',destination:'B',mode:'car',departureAt:Date.now()}));
 }
 for(const body of [{routes:[]},{routes:[{duration:'invalid'}]},{routes:[{duration:'0s'}]}]) {
  const route=createGoogleRoutes({allowPaidRequests:true,budget:{reserve:async()=>{}},apiKey:'test-only-key',fetchImpl:async()=>new Response(JSON.stringify(body))});
  await assert.rejects(()=>route({origin:'A',destination:'B',mode:'car',departureAt:Date.now()}));
 }
});

test('padrão bloqueia Google mesmo com chave presente, antes de reservar quota ou consultar',async()=>{
 let calls=0,reservations=0;
 const route=createGoogleRoutes({apiKey:'test-only-key',budget:{reserve:async()=>{reservations++;}},fetchImpl:async()=>{calls++;throw new Error('Não pode consultar');}});
 await assert.rejects(()=>route({origin:'A',destination:'B',mode:'car',departureAt:Date.now()}),/desativadas no servidor/);
 assert.equal(calls,0);
 assert.equal(reservations,0);
});

test('GPS, Uber, ônibus e metrô enviam pontos e filtros próprios ao Google', async () => {
 for (const mode of ['uber', 'bus', 'subway']) {
  let request;
  const route = createGoogleRoutes({ allowPaidRequests: true, apiKey: 'test-only-key', budget: { reserve: async () => {} }, fetchImpl: async (_, options) => {
   request = JSON.parse(options.body);
   return new Response(JSON.stringify({ routes: [{ duration: '900s', legs: [{ steps: [{ transitDetails: { transitLine: { vehicle: { type: mode === 'bus' ? 'BUS' : 'SUBWAY' } } } }] }] }] }));
  } });
  const result = await route({ origin: '', location: { latitude: -12.98, longitude: -38.45 }, destination: 'Shopping', destinationPlaceId: 'place-id', mode, departureAt: Date.now() });
  assert.deepEqual(request.origin, { location: { latLng: { latitude: -12.98, longitude: -38.45 } } });
  assert.deepEqual(request.destination, { placeId: 'place-id' });
  if (mode === 'uber') { assert.equal(request.travelMode, 'DRIVE'); assert.equal(request.routingPreference, 'TRAFFIC_AWARE'); assert.match(result.note, /motorista/); }
  else { assert.equal(request.travelMode, 'TRANSIT'); assert.deepEqual(request.transitPreferences.allowedTravelModes, [mode === 'bus' ? 'BUS' : 'SUBWAY']); }
 }
});

test('metrô não aceita silenciosamente trajeto de ônibus; alternativa compatível é selecionada', async () => {
 const candidate = type => ({ duration: '900s', legs: [{ steps: [{ transitDetails: { transitLine: { vehicle: { type } } } }] }] });
 const options = { allowPaidRequests: true, apiKey: 'test-only-key', budget: { reserve: async () => {} } };
 const input = { origin: 'A', destination: 'B', mode: 'subway', departureAt: Date.now() };
 const wrong = createGoogleRoutes({ ...options, fetchImpl: async () => new Response(JSON.stringify({ routes: [candidate('BUS')] })) });
 await assert.rejects(() => wrong(input), /compatível com metrô/);
 const alternative = createGoogleRoutes({ ...options, fetchImpl: async () => new Response(JSON.stringify({ routes: [candidate('BUS'), { ...candidate('SUBWAY'), duration: '1200s' }] })) });
 assert.equal((await alternative(input)).durationSeconds, 1200);
});
