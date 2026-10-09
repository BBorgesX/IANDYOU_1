const $ = id => document.getElementById(id);
const form = $('meeting-form');
const personalForm = $('participant-form');
const modes = { car: '🚗 Carro', uber: '🚕 Uber', bus: '🚌 Ônibus', subway: '🚇 Metrô', walk: '🚶 A pé', transit: '🚇 Transporte público' };
const clock = at => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(at);
let session = null, credential = null, invite = null, serverOffset = 0;
let busy = false, pollBusy = false, ready = false, placesAvailable = false, personalDirty = false;
let notified = false, timer, poller, routePoller, positionSender, usage;
let gpsId = null, gpsPoint = null, gpsGeneration = 0, queuedLocation, locationSending = false;
let gpsObservedAt = 0;
const selections = new Map();
const status = text => { $('live-status').textContent = text; };
const serverNow = () => Date.now() + serverOffset;

async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Meetsync-Client': '1', ...(credential ? { 'X-Meeting-Token': credential } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(55000),
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('Abra o MeetSync pelo endereço do servidor para conectar os aparelhos.'); }
  if (!response.ok) throw Object.assign(new Error(data.error || 'Não foi possível realizar esta ação.'), { status: response.status });
  return data;
}
function connection(text, unavailable = false) {
  $('connection-status').textContent = text;
  $('connection-status').classList.toggle('unavailable', unavailable);
}
async function refreshUsage() {
  const config = await api('/api/config');
  ready = config.googleMapsConfigured;
  placesAvailable = config.placesConfigured && config.placesUsage.remaining > 0;
  usage = config.routeUsage;
  $('cost-status').textContent = (config.paidGoogleDisabled ? 'Consultas de rota desativadas. ' :
    'Rotas neste servidor hoje: ' + usage.used + '/' + usage.limit + '. ') +
    'Sugestões: ' + config.placesUsage.used + '/' + config.placesUsage.limit + '. ' +
    'As cotas do Google também precisam estar configuradas: os contadores locais podem reiniciar.';
  return config;
}
function linkFor(id, viewer, token) {
  const url = new URL(location.pathname, location.origin);
  url.hash = new URLSearchParams({ meeting: id, token, viewer });
  return url.href;
}
function creator() { return Number($('identity').value); }
function setLocked(locked) { for (const control of form.elements) control.disabled = locked; }
function syncGPSControls() {
  const active = gpsId !== null;
  const fresh = active && gpsPoint && Date.now() - gpsObservedAt <= 60000;
  for (const prefix of ['setup', 'personal']) {
    $(prefix + '-gps').hidden = active;
    $(prefix + '-stop-gps').hidden = !active;
  }
  if (!session) $('origin-' + ['a', 'b'][creator()]).required = !fresh;
  $('my-origin').required = !fresh;
}
function gpsStatus(text) {
  $('setup-gps-status').textContent = text;
  $('personal-gps-status').textContent = text;
  syncGPSControls();
}
function updateIdentity() {
  const viewer = creator();
  ['a', 'b'].forEach((key, i) => {
    $('identity').options[i].textContent = $('name-' + key).value.trim() || 'Pessoa ' + key.toUpperCase();
    $('origin-fields-' + key).hidden = i !== viewer;
    $('origin-' + key).disabled = i !== viewer;
    $('transport-' + key).disabled = i !== viewer;
    $('origin-' + key).required = i === viewer && !gpsPoint;
    $('role-' + key).textContent = i === viewer ? 'Seus dados' : 'Quem você convida';
    $('participant-hint-' + key).textContent = i === viewer ? 'Informe sua origem ou use seu GPS.' : 'Esta pessoa escolhe a origem e o transporte ao aceitar o convite.';
  });
}
function ownInput(originId, modeId) {
  const location = gpsId !== null && Date.now() - gpsObservedAt <= 60000 ? gpsPoint : null;
  const selected = selections.get(originId);
  return { origin: $(originId).value.trim(), mode: $(modeId).value,
    location, gpsConsent: Boolean(location), placeId: location ? null : selected?.placeId ?? null };
}
function planInput() {
  const viewer = creator();
  const participants = ['a', 'b'].map((key, i) => ({
    name: $('name-' + key).value.trim(),
    ...(i === viewer ? ownInput('origin-' + key, 'transport-' + key) : { origin: '', mode: 'bus' }),
  }));
  return { destination: $('destination').value.trim(), destinationPlaceId: selections.get('destination')?.placeId ?? null, creator: viewer, participants };
}
function accept(data) {
  if (session && data.id === session.id && data.version < session.version) return;
  const firstLoad = !session || data.id !== session.id;
  session = data;
  serverOffset = data.serverNow - Date.now();
  $('result-destination').textContent = data.plan.destination;
  data.plan.participants.forEach((p, i) => {
    const key = ['a', 'b'][i];
    $('name-' + key).value = p.name;
    $('summary-' + key).textContent = p.name + (data.accepted[i] ? ' · ' + modes[p.mode] : ' · aguardando confirmação');
  });
  $('destination').value = data.plan.destination;
  $('identity').value = String(data.viewer);
  $('viewer-label').textContent = 'Você está como ' + data.plan.participants[data.viewer].name;
  $('personal-title').textContent = data.accepted[data.viewer] ? 'Sua origem e seu transporte' : 'Aceite o convite com seus dados';
  $('save-profile').textContent = data.accepted[data.viewer] ? 'Salvar minha origem e meu transporte' : 'Aceitar convite e calcular meu trajeto';
  const p = data.plan.participants[data.viewer];
  if (firstLoad || !personalDirty) {
    $('my-origin').value = p.origin;
    $('my-transport').value = data.accepted[data.viewer] ? p.mode : '';
    if (p.placeId) selections.set('my-origin', { placeId: p.placeId, description: p.origin });
  }
  const maps = new URL('https://www.google.com/maps/dir/');
  maps.search = new URLSearchParams({ api: '1', origin: p.location ? p.location.latitude + ',' + p.location.longitude : p.origin,
    destination: data.plan.destination, travelmode: ['car', 'uber'].includes(p.mode) ? 'driving' : p.mode === 'walk' ? 'walking' : 'transit' });
  $('open-maps').href = maps.href;
  $('open-maps').hidden = !p.origin && !p.location;
  $('plan-mode').textContent = 'Cada pessoa escolhe o próprio transporte';
  setLocked(true);
  $('start-button').textContent = 'Encontro criado';
  $('session-actions').hidden = false;
  $('invite-block').hidden = !invite;
  if (invite) { $('invite-link').value = invite; $('invite-label').textContent = 'Envie o convite para ' + data.plan.participants[1 - data.viewer].name; }
  syncGPSControls(); tick();
}
function tick() {
  if (!session) return;
  const now = serverNow();
  const { plan, viewer, departedAt, arrivalAt, recommendedDepartureAt } = session;
  const first = departedAt.findIndex(at => at !== null);
  const own = plan.participants[viewer];
  $('depart-button').disabled = busy || !session.accepted[viewer] || (!own.origin && !own.location) || departedAt[viewer] !== null || session.status === 'ended';
  $('save-profile').disabled = busy || session.status === 'ended';
  $('end-button').disabled = busy;
  $('depart-button').textContent = busy ? 'Atualizando…' : departedAt[viewer] === null ? 'Estou saindo agora →' : 'Você saiu às ' + clock(departedAt[viewer]) + ' ✓';
  const cooldown = Math.max(0, Math.ceil((session.nextRefreshAt - now) / 1000));
  $('refresh-button').disabled = busy || cooldown > 0 || !ready || usage?.remaining === 0 || session.status === 'ended';
  $('refresh-button').textContent = cooldown > 0 ? 'Próxima atualização em ' + cooldown + ' s' : 'Atualizar previsões';
  $('refresh-status').textContent = usage?.remaining === 0 ? 'Cota local atingida. As últimas previsões continuam visíveis; novas rotas estão bloqueadas.' :
    'Último cálculo: ' + clock(session.lastRefreshAt) + '. Atualização automática a cada 2 minutos, dentro da cota.';
  session.routes.forEach((route, i) => {
    const key = ['a', 'b'][i];
    const remaining = departedAt[i] !== null ? Math.max(0, (arrivalAt[i] - now) / 1000) : route?.durationSeconds;
    $('duration-' + key).textContent = route ? Math.ceil(remaining / 60) + ' min' : 'Pendente';
    const gps = plan.participants[i].location;
    const stale = gps && now - session.locationUpdatedAt[i] > 90000;
    $('route-note-' + key).textContent = !route ? 'A pessoa informa sua origem no convite.' :
      (route.note ? route.note + ' ' : '') + (gps ? (stale ? 'GPS sem posição recente. ' : 'Origem por GPS. ') : 'Origem por endereço. ') +
      'Rota calculada às ' + clock(session.routeUpdatedAt[i]) + '.';
  });
  const comparison = session.comparison;
  $('comparison-block').hidden = comparison.differenceSeconds === null;
  $('comparison-label').textContent = comparison.basis === 'depart-now' ? 'SE OS DOIS SAÍREM AGORA' : 'DIFERENÇA PREVISTA DE CHEGADA';
  const difference = comparison.differenceSeconds;
  $('arrival-difference').textContent = difference === 0 ? 'Mesmo horário' : difference < 60 ? 'Menos de 1 min' : Math.ceil(difference / 60) + ' min';
  $('waiting-person').textContent = comparison.waitingParticipant === null ? 'Ninguém precisará esperar se as previsões se mantiverem.' :
    plan.participants[comparison.waitingParticipant].name + ' chega primeiro e deverá esperar no ponto combinado.';
  $('arrival-time').textContent = session.predictedArrivalAt.map((at, i) => plan.participants[i].name + ': ' + (at === null ? 'pendente' : clock(at))).join(' · ');
  if (session.status === 'ended') {
    $('first-departure').textContent = 'Encontro encerrado.';
    $('second-departure').textContent = 'O compartilhamento de GPS e as atualizações foram encerrados.';
    $('countdown-block').hidden = true; $('invite-block').hidden = true; personalForm.hidden = true;
    $('depart-button').hidden = true; $('refresh-button').hidden = true;
    $('end-button').disabled = false; $('end-button').textContent = 'Criar novo encontro';
    clearInterval(poller); clearInterval(timer); clearInterval(routePoller); clearInterval(positionSender);
    stopGPS(false); return;
  }
  if (session.routes.some(route => !route)) {
    $('first-departure').textContent = 'Aguardando a origem da outra pessoa.';
    $('second-departure').textContent = 'Cada pessoa confirma seu endereço ou GPS e seu transporte. A sincronização fica completa quando os dois trajetos estiverem disponíveis.';
    $('countdown-block').hidden = true; return;
  }
  if (first === -1) {
    const durations = session.routes.map(route => route.durationSeconds);
    const diff = Math.ceil(Math.abs(durations[0] - durations[1]) / 60);
    const index = durations[0] >= durations[1] ? 0 : 1;
    $('recommendation-label').textContent = 'PLANO DE SAÍDA';
    $('first-departure').textContent = diff === 0 ? 'Vocês podem sair juntos.' : plan.participants[index].name + ' sai primeiro.';
    $('second-departure').textContent = diff === 0 ? 'Os trajetos têm duração semelhante.' : plan.participants[1 - index].name + ' aguarda aproximadamente ' + diff + ' min após essa saída.';
    $('countdown-block').hidden = true; return;
  }
  if (departedAt.every(at => at !== null)) {
    $('recommendation-label').textContent = 'OS DOIS A CAMINHO';
    $('first-departure').textContent = 'Encontro em andamento.';
    $('second-departure').textContent = 'A diferença de chegada acima considera as últimas previsões. Quem chega antes espera no ponto fixo.';
    $('countdown-block').hidden = true; return;
  }
  const waiting = 1 - first;
  const remaining = Math.max(0, Math.ceil((recommendedDepartureAt[waiting] - now) / 1000));
  $('recommendation-label').textContent = 'SINCRONIZAÇÃO ATIVA';
  $('first-departure').textContent = plan.participants[first].name + ' já saiu.';
  $('second-departure').textContent = remaining > 0 ? plan.participants[waiting].name + ' deve sair às ' + clock(recommendedDepartureAt[waiting]) + '.' : plan.participants[waiting].name + ', saia agora para o ponto combinado!';
  $('countdown-block').hidden = false;
  $('countdown-label').textContent = remaining > 0 ? plan.participants[waiting].name + ' sai em' : 'Hora de sair';
  $('countdown').textContent = String(Math.floor(remaining / 60)).padStart(2, '0') + ':' + String(remaining % 60).padStart(2, '0');
  if (remaining === 0 && viewer === waiting && !notified) {
    notified = true;
    if ('Notification' in window && Notification.permission === 'granted') new Notification('MeetSync — hora de sair', { body: 'Vá para ' + plan.destination + '. A outra pessoa já está a caminho.' });
  }
}
async function flushLocation() {
  if (queuedLocation === undefined || locationSending || busy || document.hidden || !session || session.status === 'ended' || !session.accepted[session.viewer]) return;
  if (queuedLocation !== null && Date.now() - gpsObservedAt > 60000) {
    queuedLocation = undefined;
    gpsStatus('GPS sem posição recente. Atualize seu endereço manualmente ou reative o GPS.');
    return;
  }
  const point = queuedLocation; queuedLocation = undefined; locationSending = true;
  try { accept(await api('/api/meetings/' + session.id + '/location', { location: point, gpsConsent: point !== null })); }
  catch (error) { if (queuedLocation === undefined) queuedLocation = point; gpsStatus('Posição ainda não enviada: ' + error.message); }
  finally { locationSending = false; }
}
function stopGPS(send = true, message = 'GPS parado neste aparelho. Você pode informar seu endereço manualmente.') {
  gpsGeneration++;
  if (gpsId !== null) navigator.geolocation.clearWatch(gpsId);
  gpsId = null; gpsPoint = null; gpsObservedAt = 0;
  if (send && session?.status !== 'ended' && (session?.plan.participants[session.viewer].location || locationSending || busy)) { queuedLocation = null; flushLocation(); }
  else queuedLocation = undefined;
  gpsStatus(message);
}
function startGPS() {
  if (gpsId !== null) return;
  if (!navigator.geolocation || !window.isSecureContext) { gpsStatus('GPS indisponível. Abra por HTTPS ou digite seu endereço manualmente.'); return; }
  const generation = ++gpsGeneration;
  gpsStatus('Aguardando sua permissão e a posição deste aparelho…');
  gpsId = navigator.geolocation.watchPosition(position => {
    if (generation !== gpsGeneration) return;
    gpsPoint = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
    gpsObservedAt = Math.min(Date.now(), position.timestamp || Date.now());
    selections.delete(session ? 'my-origin' : 'origin-' + ['a', 'b'][creator()]);
    gpsStatus('GPS ativo neste aparelho · precisão aproximada de ' + Math.round(position.coords.accuracy) + ' m. Sua posição é compartilhada após confirmar seus dados.');
    if (session?.accepted[session.viewer]) queuedLocation = gpsPoint;
  }, error => {
    if (generation !== gpsGeneration) return;
    if (error.code === 1) stopGPS(true, 'Permissão de GPS negada. Digite seu endereço para continuar.');
    else gpsStatus('GPS temporariamente indisponível. Aguardando nova posição; você pode digitar seu endereço para continuar.');
  }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
  syncGPSControls();
}
async function refreshRoutes() {
  if (!session || busy || !ready || document.hidden || session.status === 'ended' || serverNow() < session.nextRefreshAt || usage?.remaining === 0) return;
  busy = true; tick();
  try {
    const previous = [...session.routeUpdatedAt];
    const data = await api('/api/meetings/' + session.id + '/refresh', {});
    const updated = data.routeUpdatedAt.some((at, i) => at !== previous[i]);
    accept(data);
    status(updated ? 'Previsões atualizadas. Confira a diferença de chegada.' : 'Últimas previsões preservadas. Durante a viagem, informe seu endereço atual ou compartilhe GPS recente para recalcular.');
  }
  catch (error) {
    status('Não foi possível recalcular: ' + error.message + ' As últimas previsões permanecem visíveis.');
    try { accept(await api('/api/meetings/' + session.id)); } catch {}
  } finally { busy = false; tick(); flushLocation(); refreshUsage().catch(() => {}); }
}
function startUpdates() {
  clearInterval(timer); clearInterval(poller); clearInterval(routePoller); clearInterval(positionSender);
  timer = setInterval(tick, 1000);
  poller = setInterval(async () => {
    if (!session || busy || pollBusy || document.hidden || session.status === 'ended') return;
    pollBusy = true;
    try { accept(await api('/api/meetings/' + session.id)); connection('Encontro conectado · cada pessoa controla seu GPS e seu transporte'); }
    catch (error) { connection('Atualização interrompida: ' + error.message, true); }
    finally { pollBusy = false; }
  }, 2500);
  routePoller = setInterval(refreshRoutes, 10000);
  positionSender = setInterval(flushLocation, 15000);
}

function autocomplete(id) {
  const input = $(id), list = $(id + '-suggestions'), hint = $(id + '-hint');
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id); input.setAttribute('aria-expanded', 'false');
  list.setAttribute('role', 'listbox');
  let timeout, version = 0, predictions = [], index = -1, lastQuery = '';
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  const choose = prediction => {
    input.value = prediction.description; selections.set(id, prediction);
    if (id !== 'destination') { if (gpsId !== null) stopGPS(); personalDirty = Boolean(session); }
    hint.textContent = 'Endereço selecionado no Google.'; close(); version++;
  };
  input.addEventListener('input', () => {
    selections.delete(id); close(); clearTimeout(timeout);
    if (id !== 'destination' && gpsId !== null) stopGPS();
    const query = input.value.trim(); const current = ++version;
    if (query.length < 4) { hint.textContent = 'Digite pelo menos 4 caracteres para buscar sugestões.'; return; }
    if (!placesAvailable) { hint.textContent = 'Sugestões desativadas ou sem saldo. O endereço completo digitado também funciona.'; return; }
    timeout = setTimeout(async () => {
      if (current !== version || input.disabled || document.activeElement !== input || query === lastQuery) return;
      lastQuery = query;
      try {
        const data = await api('/api/places/autocomplete', { input: query });
        if (current !== version || document.activeElement !== input) return;
        predictions = data.predictions; index = -1; list.replaceChildren();
        predictions.forEach((prediction, i) => {
          const option = document.createElement('button'); option.type = 'button'; option.role = 'option'; option.id = id + '-option-' + i;
          option.textContent = prediction.description; option.setAttribute('aria-selected', 'false');
          option.addEventListener('mousedown', event => event.preventDefault());
          option.addEventListener('click', () => choose(prediction)); list.append(option);
        });
        if (predictions.length) {
          const logo = document.createElement('img'); logo.src = '/src/google-attribution.png'; logo.alt = 'Powered by Google'; list.append(logo);
          list.hidden = false; input.setAttribute('aria-expanded', 'true'); hint.textContent = 'Selecione uma sugestão ou mantenha seu endereço digitado.';
        } else hint.textContent = 'Nenhuma sugestão encontrada. Digite o endereço completo.';
      } catch (error) { if (current === version) hint.textContent = error.message; }
    }, 700);
  });
  input.addEventListener('keydown', event => {
    if (list.hidden) return;
    if (event.key === 'Escape') { close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); index = (index + (event.key === 'ArrowDown' ? 1 : predictions.length - 1)) % predictions.length;
      [...list.querySelectorAll('button')].forEach((option, i) => option.setAttribute('aria-selected', String(i === index)));
      input.setAttribute('aria-activedescendant', id + '-option-' + index);
    }
    if (event.key === 'Enter' && index >= 0) { event.preventDefault(); choose(predictions[index]); }
  });
  input.addEventListener('blur', () => { clearTimeout(timeout); setTimeout(close, 150); });
  input.addEventListener('focus', () => {
    if (predictions.length && input.value.trim() === lastQuery && !selections.has(id)) {
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
    }
  });
}
['destination', 'origin-a', 'origin-b', 'my-origin'].forEach(autocomplete);
$('identity').addEventListener('change', () => { stopGPS(false); updateIdentity(); });
for (const key of ['a', 'b']) $('name-' + key).addEventListener('input', updateIdentity);
for (const prefix of ['setup', 'personal']) {
  $(prefix + '-gps').addEventListener('click', startGPS);
  $(prefix + '-stop-gps').addEventListener('click', () => stopGPS());
}
personalForm.addEventListener('input', () => { personalDirty = true; $('personal-error').textContent = ''; });
form.addEventListener('submit', async event => {
  event.preventDefault();
  syncGPSControls();
  if (busy || session || !form.reportValidity()) return;
  if (!ready) { $('form-error').textContent = 'O responsável precisa configurar e ativar Google Routes no servidor.'; return; }
  const input = planInput(); busy = true; setLocked(true); $('start-button').textContent = 'Criando encontro…';
  try {
    const data = await api('/api/meetings', input);
    credential = data.tokens[data.viewer]; invite = linkFor(data.id, 1 - data.viewer, data.tokens[1 - data.viewer]);
    history.replaceState(null, '', linkFor(data.id, data.viewer, credential));
    try { sessionStorage.setItem('invite-' + data.id + '-' + data.viewer, invite); } catch {}
    accept(data); startUpdates();
    status('Envie o convite. A outra pessoa informa sua origem e escolhe o transporte no próprio aparelho.');
    $('result-title').closest('section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { $('form-error').textContent = error.message; setLocked(false); updateIdentity(); $('start-button').textContent = 'Criar encontro e convite →'; }
  finally { busy = false; tick(); flushLocation(); refreshUsage().catch(() => {}); }
});
personalForm.addEventListener('submit', async event => {
  event.preventDefault();
  syncGPSControls();
  if (busy || !session || !personalForm.reportValidity()) return;
  busy = true; tick(); $('personal-error').textContent = '';
  try {
    const data = await api('/api/meetings/' + session.id + '/profile', ownInput('my-origin', 'my-transport'));
    personalDirty = false; accept(data); status('Seus dados foram confirmados. O outro aparelho recebe sua previsão.');
  } catch (error) { $('personal-error').textContent = error.message; }
  finally { busy = false; tick(); flushLocation(); refreshUsage().catch(() => {}); }
});
$('depart-button').addEventListener('click', async () => {
  if (!session || busy || session.departedAt[session.viewer] !== null) return;
  busy = true; tick();
  try { accept(await api('/api/meetings/' + session.id + '/depart', {})); status('Saída confirmada. O outro aparelho recebe o horário recomendado.'); }
  catch (error) { status(error.message + ' Sua saída não foi registrada.'); }
  finally { busy = false; tick(); flushLocation(); refreshUsage().catch(() => {}); }
});
$('refresh-button').addEventListener('click', refreshRoutes);
$('copy-invite').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('invite-link').value); $('copy-invite').textContent = 'Convite copiado ✓'; }
  catch { $('invite-link').focus(); $('invite-link').select(); status('Copie o link selecionado e envie à outra pessoa.'); }
});
$('notifications-button').addEventListener('click', async () => {
  if (!('Notification' in window)) { status('Acompanhe os avisos nesta página. Este navegador não oferece notificações.'); return; }
  try { status(await Notification.requestPermission() === 'granted' ? 'Avisos ativados. Mantenha esta página aberta.' : 'Aviso do sistema não autorizado. O aviso na página continua ativo.'); }
  catch { status('Acompanhe os avisos nesta página.'); }
});
$('end-button').addEventListener('click', async () => {
  if (!session || busy) return;
  if (session.status === 'ended') { location.href = location.pathname; return; }
  busy = true;
  try { accept(await api('/api/meetings/' + session.id + '/end', {})); }
  catch (error) { status(error.message); }
  finally { busy = false; tick(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); flushLocation(); refreshRoutes(); } });
window.addEventListener('pagehide', () => stopGPS(false));
async function initialize() {
  updateIdentity(); syncGPSControls();
  if (!['http:', 'https:'].includes(location.protocol)) { connection('Abra o MeetSync pelo endereço do servidor para conectar os aparelhos.', true); return; }
  try {
    const config = await refreshUsage();
    connection(ready ? 'Google Routes configurado · cada pessoa controla sua origem e transporte' : config.googleRoutesEnabled ? 'Falta configurar a chave Google no servidor.' : 'Cálculo de rotas desativado pelo responsável para controlar custos.', !ready);
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has('meeting') && params.has('token')) {
      credential = params.get('token');
      const data = await api('/api/meetings/' + params.get('meeting'));
      try { invite = sessionStorage.getItem('invite-' + data.id + '-' + data.viewer); } catch {}
      accept(data); startUpdates(); status('Convite conectado. Confirme seus dados neste aparelho antes de sair.');
    }
  } catch (error) { connection(error.message, true); }
}
initialize();
