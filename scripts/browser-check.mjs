import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const routes = [], errors = [], predictions = [];
const budget = { status: async () => ({ remaining: 999, limit: 999, used: 0 }) };
const server = createServer({ configured: true, placesConfigured: true, budget, autocompleteBudget: budget, refreshIntervalMs: 300,
  getRoute: async input => { routes.push(input); return { durationSeconds: input.mode === 'bus' ? 1200 : input.mode === 'subway' ? 1800 : input.location?.latitude === -12.97 ? 900 : 2100, source: 'Google Maps' }; },
  getPredictions: async input => { predictions.push(input); return [{ placeId: 'test-centro', description: 'Centro, Salvador - BA' }]; },
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const directory = await mkdtemp(join(tmpdir(), 'meetsync-chrome-'));
const env = Object.fromEntries(['PATH', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'LANG'].filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
const chrome = spawn(process.env.CHROME_BIN || '/usr/bin/chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking', '--no-first-run', '--user-data-dir=' + directory, '--remote-debugging-port=0', 'about:blank'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
let chromeLog = '';
chrome.stderr.on('data', chunk => { chromeLog += chunk.toString(); });
let socket;
try {
  let port;
  for (let i = 0; i < 100; i++) { try { port = Number((await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch {} await sleep(100); }
  if (!port) throw new Error('Chromium não iniciou: ' + chromeLog.slice(-1200));
  const info = await fetch('http://127.0.0.1:' + port + '/json/version').then(response => response.json());
  socket = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let counter = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error))); else entry.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text + ' ' + (message.params.exceptionDetails.exception?.description || ''));
  });
  const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++counter; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  async function page(permission) {
    const { browserContextId } = await cdp('Target.createBrowserContext');
    await cdp('Browser.setPermission', { permission: { name: 'geolocation' }, setting: permission, origin: base, browserContextId });
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    await cdp('Page.enable', {}, sessionId); await cdp('Runtime.enable', {}, sessionId);
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(document, 'hidden', {get:()=>false});" }, sessionId);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    return {
      cdp: (method, params) => cdp(method, params, sessionId),
      evaluate: async expression => {
        const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      },
      navigate: url => cdp('Page.navigate', { url }, sessionId),
    };
  }
  async function wait(page, expression) {
    for (let i = 0; i < 100; i++) { try { if (await page.evaluate(expression)) return; } catch {} await sleep(100); }
    console.log('Últimas rotas controladas:', routes.slice(-4));
    console.log('GPS no navegador:', await page.evaluate("({text:document.getElementById('personal-gps-status')?.textContent,stopHidden:document.getElementById('personal-stop-gps')?.hidden})"));
    throw new Error('Timeout: ' + expression + '; ' + await page.evaluate("document.getElementById('live-status')?.textContent + ' ' + document.getElementById('form-error')?.textContent + ' ' + document.getElementById('personal-error')?.textContent"));
  }
  const click = (page, id) => page.evaluate("document.getElementById(" + JSON.stringify(id) + ").click()");
  const set = (page, id, value) => page.evaluate("(()=>{const e=document.getElementById(" + JSON.stringify(id) + ");e.value=" + JSON.stringify(value) + ";e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()");
  const bruno = await page('granted'), cleide = await page('denied');
  await bruno.cdp('Emulation.setGeolocationOverride', { latitude: -12.98, longitude: -38.45, accuracy: 30 });
  await bruno.navigate(base);
  await wait(bruno, "document.getElementById('connection-status').textContent.includes('configurado')");
  assert.equal(await bruno.evaluate("document.getElementById('origin-fields-b').hidden"), true);
  await click(bruno, 'setup-gps');
  await wait(bruno, "document.getElementById('setup-gps-status').textContent.includes('GPS ativo')");
  await click(bruno, 'start-button');
  await wait(bruno, "!document.getElementById('invite-block').hidden");
  assert.equal(routes.length, 1); assert.equal(routes[0].location.latitude, -12.98);
  const invite = await bruno.evaluate("document.getElementById('invite-link').value");
  await cleide.navigate(invite);
  await wait(cleide, "document.getElementById('viewer-label').textContent.includes('Cleide')");
  assert.equal(await cleide.evaluate("document.getElementById('my-transport').value"), '');
  await click(cleide, 'personal-gps');
  await wait(cleide, "document.getElementById('personal-gps-status').textContent.includes('negada')");
  await cleide.evaluate("document.getElementById('my-origin').focus()");
  await set(cleide, 'my-origin', 'Cent');
  await wait(cleide, "!document.getElementById('my-origin-suggestions').hidden");
  assert.equal(predictions.length, 1);
  await cleide.evaluate("const e=document.getElementById('my-origin');e.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));");
  assert.equal(await cleide.evaluate("document.getElementById('my-origin').value"), 'Centro, Salvador - BA');
  await set(cleide, 'my-transport', 'bus'); await click(cleide, 'save-profile');
  await wait(cleide, "document.getElementById('save-profile').textContent.includes('Salvar')");
  assert.equal(routes[1].mode, 'bus'); assert.equal(routes[1].location, null); assert.equal(routes[1].placeId, 'test-centro');
  await wait(bruno, "document.getElementById('duration-b').textContent.includes('20 min')");
  assert.match(await bruno.evaluate("document.getElementById('waiting-person').textContent"), /Cleide/);
  await click(bruno, 'depart-button');
  await wait(bruno, "document.getElementById('depart-button').textContent.includes('Você saiu')");
  await wait(cleide, "!document.getElementById('countdown-block').hidden");
  await click(cleide, 'depart-button');
  await wait(cleide, "document.getElementById('first-departure').textContent.includes('andamento')");
  assert.match(await cleide.evaluate("document.getElementById('waiting-person').textContent"), /Cleide/);
  await bruno.cdp('Page.bringToFront', {});
  await bruno.cdp('Emulation.setGeolocationOverride', { latitude: -12.97, longitude: -38.45, accuracy: 25 });
  await wait(bruno, "document.getElementById('personal-gps-status').textContent.includes('25 m')");
  await bruno.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  await sleep(700);
  await wait(bruno, "!document.getElementById('refresh-button').disabled");
  await click(bruno, 'refresh-button');
  await wait(bruno, "document.getElementById('duration-a').textContent.includes('15 min')");
  assert.match(await bruno.evaluate("document.getElementById('waiting-person').textContent"), /Bruno/);
  await set(cleide, 'my-transport', 'subway'); await click(cleide, 'save-profile');
  await wait(cleide, "document.getElementById('summary-b').textContent.includes('Metrô')");
  assert.equal(routes.at(-1).mode, 'subway');
  assert.equal(await cleide.evaluate("document.getElementById('summary-a').textContent.includes('Carro')"), true);
  await click(bruno, 'end-button');
  await wait(cleide, "document.getElementById('first-departure').textContent.includes('encerrado')");
  assert.equal(await bruno.evaluate("document.getElementById('personal-stop-gps').hidden"), true);
  assert.equal(await cleide.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
  assert.deepEqual(errors, []);
  console.log('Navegador OK: GPS individual permitido/negado, convite, autocompletar por teclado, transporte próprio, saída compartilhada, ETA por GPS, quem espera, encerramento e layout móvel.');
  console.log('Somente respostas controladas; zero consultas reais ao Google.');
} finally {
  socket?.close(); chrome.kill('SIGTERM');
  await new Promise(resolve => server.close(resolve));
  await sleep(200); await rm(directory, { recursive: true, force: true });
}
