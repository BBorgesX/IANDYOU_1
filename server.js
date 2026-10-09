import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createGoogleRoutes } from './src/services/google-routes.js';
import { createMeetingStore } from './src/meetings.js';
import { routeBudget, placesBudget } from './src/services/route-budget.js';
import { createGooglePlaces } from './src/services/google-places.js';

const files = new Map([
  ['/', ['dist/MeetSync.html', 'text/html']],
  ['/src/styles.css', ['src/styles.css', 'text/css']],
  ['/src/app.js', ['src/app.js', 'text/javascript']],
  ['/src/engine/synchronization.js', ['src/engine/synchronization.js', 'text/javascript']],
  ['/src/google-attribution.png', ['src/google-attribution.png', 'image/png']],
]);
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw Object.assign(new Error('Dados excedem o limite permitido.'), { status: 413 });
  }
  try { return JSON.parse(body); } catch { throw Object.assign(new Error('Dados inválidos.'), { status: 400 }); }
}
export function createServer({ getRoute, configured, budget = routeBudget, environment = process.env, fetchImpl = fetch,
  getPredictions, placesConfigured, autocompleteBudget = placesBudget, refreshIntervalMs } = {}) {
  const googleRoutesEnabled = environment.GOOGLE_ROUTES_ENABLED === 'true';
  const apiKey = environment.GOOGLE_MAPS_API_KEY?.trim() ?? '';
  configured ??= googleRoutesEnabled && Boolean(apiKey);
  getRoute ??= createGoogleRoutes({
    apiKey,
    allowPaidRequests: googleRoutesEnabled,
    budget,
    fetchImpl,
  });
  const placesEnabled = environment.GOOGLE_PLACES_ENABLED === 'true';
  const placesKey = environment.GOOGLE_PLACES_API_KEY?.trim() || apiKey;
  placesConfigured ??= placesEnabled && Boolean(placesKey);
  getPredictions ??= createGooglePlaces({ apiKey: placesKey, enabled: placesEnabled, budget: autocompleteBudget, fetchImpl });
  const refreshSeconds = Math.max(120, Math.min(3600, Number.parseInt(environment.ROUTE_REFRESH_SECONDS ?? '120', 10) || 120));
  const store = createMeetingStore({ getRoute, refreshIntervalMs: refreshIntervalMs ?? refreshSeconds * 1000, beforeRoutes: async count => {
    if (count && (await budget.status()).remaining < count) throw Object.assign(new Error('Saldo diário insuficiente para até ' + count + ' consultas. Nenhuma consulta foi iniciada.'), { status: 429 });
  } });
  const requests = new Map();
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'POST') {
          // Cabeçalho e JSON evitam acionamento do encontro por formulários externos.
          if (req.headers['x-meetsync-client'] !== '1' || !req.headers['content-type']?.startsWith('application/json')) return json(res, 403, { error: 'Abra a aplicação para realizar esta ação.' });
          const origin = req.headers.origin;
          if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'Origem de requisição inválida.' });
          const now = Date.now();
          for (const [ip, entry] of requests) if (now > entry.until) requests.delete(ip);
          const ip = req.socket.remoteAddress;
          const entry = requests.get(ip) || { count: 0, until: now + 60000 };
          entry.count++; requests.set(ip, entry);
          if (entry.count > 15) return json(res, 429, { error: 'Muitas consultas. Aguarde um minuto e tente novamente.' });
        }
        if (url.pathname === '/api/config' && req.method === 'GET') return json(res, 200, {
          prototypeVersion: '0.2.0',
          googleMapsConfigured: configured, googleRoutesEnabled, paidGoogleDisabled: !configured, routeUsage: await budget.status(),
          placesConfigured, placesUsage: await autocompleteBudget.status(), routeRefreshSeconds: refreshSeconds,
        });
        if (url.pathname === '/api/places/autocomplete' && req.method === 'POST') {
          const input = await readBody(req);
          return json(res, 200, { predictions: await getPredictions(input.input) });
        }
        if (url.pathname === '/api/meetings' && req.method === 'POST') {
          return json(res, 201, await store.create(await readBody(req)));
        }
        const match = /^\/api\/meetings\/([a-f0-9]{48})(?:\/(depart|end|profile|location|refresh))?$/.exec(url.pathname);
        if (match) {
          const [, id, action] = match;
          const credential = req.headers['x-meeting-token'];
          if (!action && req.method === 'GET') return json(res, 200, store.get(id, credential));
          if (action === 'depart' && req.method === 'POST') {
            return json(res, 200, await store.depart(id, credential));
          }
          if (action === 'profile' && req.method === 'POST') return json(res, 200, await store.profile(id, credential, await readBody(req)));
          if (action === 'location' && req.method === 'POST') return json(res, 200, store.location(id, credential, await readBody(req)));
          if (action === 'refresh' && req.method === 'POST') return json(res, 200, await store.refresh(id, credential));
          if (action === 'end' && req.method === 'POST') return json(res, 200, store.end(id, credential));
        }
        return json(res, 404, { error: 'Não encontrado.' });
      }
      const entry = files.get(url.pathname);
      if (!entry || !['GET', 'HEAD'].includes(req.method)) return res.writeHead(404).end('Não encontrado');
      const body = await readFile(new URL(entry[0], import.meta.url));
      res.writeHead(200, { 'Content-Type': `${entry[1]}; charset=utf-8`, 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) { json(res, error.status || 500, { error: error.status ? error.message : 'Erro no servidor. Tente novamente.' }); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? 'Porta ocupada. Use PORT=3002 npm start ou outra porta disponível.' : 'Não foi possível iniciar o servidor.');
    process.exitCode = 1;
  });
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('MeetSync iniciado na porta', server.address().port));
}
