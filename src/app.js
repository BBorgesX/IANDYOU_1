const $ = id => document.getElementById(id);
const form = $('meeting-form');
const modes = { car: '🚗 Carro', walk: '🚶 A pé', transit: '🚇 Transporte público' };
const clock = timestamp => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(timestamp);
let session = null;
let credential = null;
let serverOffset = 0;
let busy = false;
let pollBusy = false;
let ready = false;
let invite = null;
let notified = false;
let timer = null;
let poller = null;
let usage = null;
const status = text => { $('live-status').textContent = text; };

async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Meetsync-Client': '1', ...(credential ? { 'X-Meeting-Token': credential } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(55000),
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('Abra o MeetSync pelo servidor para conectar aos trajetos e ao encontro compartilhado.'); }
  if (!response.ok) throw new Error(data.error || 'Não foi possível realizar esta ação.');
  return data;
}
function planInput() {
  const destination = $('destination').value.trim();
  const participants = ['a', 'b'].map(key => ({ name: $(`name-${key}`).value.trim(), origin: $(`origin-${key}`).value.trim(), mode: $(`transport-${key}`).value }));
  if (!destination || participants.some(p => !p.name || !p.origin)) throw new Error('Preencha o destino, os nomes e os endereços de origem.');
  return { destination, participants };
}
function connection(text, unavailable = false) {
  $('connection-status').textContent = text;
  $('connection-status').classList.toggle('unavailable', unavailable);
}
async function refreshUsage() {
  try {
    const config = await api('/api/config');
    usage = config.routeUsage;
    if (config.paidGoogleDisabled) {
      $('cost-status').textContent = 'Consultas pagas ao Google desativadas nesta versão. Não são enviados novos pedidos de rota ao Google.';
      return config;
    }
    if (usage) $('cost-status').textContent = `Consultas de rota hoje: ${usage.used}/${usage.limit}. Criar encontro usa 2; confirmar saída usa de 1 a 3. Ao atingir o limite, novas consultas são bloqueadas.`;
    return config;
  } catch (error) {
    $('cost-status').textContent = 'Não foi possível verificar o limite de consultas. Tente novamente antes de calcular trajetos.';
    throw error;
  }
}
function linkFor(id, viewer, token) {
  const url = new URL(location.pathname, location.origin);
  url.hash = new URLSearchParams({ meeting: id, token, viewer });
  return url.href;
}
function setLocked(locked) { for (const control of form.elements) control.disabled = locked; }
function accept(data) {
  if (session && data.id === session.id && data.version < session.version) return;
  session = data;
  serverOffset = data.serverNow - Date.now();
  $('result-destination').textContent = data.plan.destination;
  data.plan.participants.forEach((p, i) => {
    const key = ['a', 'b'][i];
    $(`name-${key}`).value = p.name;
    $(`origin-${key}`).value = p.origin;
    $(`transport-${key}`).value = p.mode;
    $(`summary-${key}`).textContent = `${p.name} · ${modes[p.mode]}`;
    $(`duration-${key}`).textContent = `${Math.ceil(data.routes[i].durationSeconds / 60)} min`;
  });
  $('destination').value = data.plan.destination;
  $('identity').options[0].textContent = data.plan.participants[0].name;
  $('identity').options[1].textContent = data.plan.participants[1].name;
  $('identity').value = String(data.viewer);
  $('viewer-label').textContent = `Você está como ${data.plan.participants[data.viewer].name}`;
  $('plan-mode').textContent = 'Encontro compartilhado · rotas do Google Maps';
  const p = data.plan.participants[data.viewer];
  const maps = new URL('https://www.google.com/maps/dir/');
  maps.search = new URLSearchParams({ api: '1', origin: p.origin, destination: data.plan.destination, travelmode: { car: 'driving', walk: 'walking', transit: 'transit' }[p.mode] });
  $('open-maps').href = maps.href;
  setLocked(true);
  $('start-button').textContent = 'Encontro criado';
  $('session-actions').hidden = false;
  $('invite-block').hidden = !invite;
  if (invite) {
    $('invite-link').value = invite;
    $('invite-label').textContent = `Envie o convite para ${data.plan.participants[1 - data.viewer].name}`;
  }
  $('countdown-block').hidden = false;
  tick();
}
function tick() {
  if (!session) return;
  const now = Date.now() + serverOffset;
  const { plan, viewer, departedAt, arrivalAt, recommendedDepartureAt } = session;
  const first = departedAt.findIndex(t => t !== null);
  $('depart-button').disabled = busy || departedAt[viewer] !== null || session.status === 'ended';
  $('end-button').disabled = busy || session.status === 'ended';
  $('depart-button').textContent = busy ? 'Atualizando rotas do Google…' : departedAt[viewer] === null ? 'Estou saindo agora →' : `Você saiu às ${clock(departedAt[viewer])} ✓`;
  if (session.status === 'ended') {
    $('first-departure').textContent = 'Encontro encerrado.';
    $('second-departure').textContent = 'A sessão foi encerrada para os dois participantes.';
    $('countdown-block').hidden = true;
    $('invite-block').hidden = true;
    $('depart-button').hidden = true;
    $('end-button').disabled = false;
    $('end-button').textContent = 'Criar novo encontro';
    status('Nenhuma atualização de saída será enviada nesta sessão.');
    clearInterval(poller); clearInterval(timer);
    return;
  }
  if (first === -1) {
    const durations = session.routes.map(r => r.durationSeconds);
    const diff = Math.ceil(Math.abs(durations[0] - durations[1]) / 60);
    const index = durations[0] >= durations[1] ? 0 : 1;
    $('recommendation-label').textContent = 'PLANO DE SAÍDA';
    $('first-departure').textContent = diff === 0 ? 'Vocês podem sair juntos.' : `${plan.participants[index].name} sai primeiro.`;
    $('second-departure').textContent = diff === 0 ? 'Os trajetos têm duração semelhante.' : `${plan.participants[1-index].name} aguarda aproximadamente ${diff} min após essa saída.`;
    $('countdown-label').textContent = 'Aguardando a primeira pessoa confirmar a saída';
    $('countdown').textContent = '—';
    $('arrival-time').textContent = 'Aguardando saída';
    return;
  }
  if (departedAt.every(t => t !== null)) {
    $('recommendation-label').textContent = 'OS DOIS A CAMINHO';
    $('first-departure').textContent = 'Encontro em andamento.';
    const difference = Math.round(Math.abs(arrivalAt[0] - arrivalAt[1]) / 60000);
    $('second-departure').textContent = difference < 1 ? 'Chegadas previstas no mesmo minuto.' : `Diferença prevista: ${difference} min. Quem chegar primeiro espera no ponto fixo.`;
    $('arrival-time').textContent = `${plan.participants[0].name}: ${clock(arrivalAt[0])} · ${plan.participants[1].name}: ${clock(arrivalAt[1])}`;
    $('countdown-block').hidden = true;
    return;
  }
  const waiting = 1 - first;
  const remaining = Math.max(0, Math.ceil((recommendedDepartureAt[waiting] - now) / 1000));
  $('recommendation-label').textContent = 'SINCRONIZAÇÃO ATIVA';
  $('first-departure').textContent = `${plan.participants[first].name} já saiu.`;
  $('second-departure').textContent = remaining > 0 ? `${plan.participants[waiting].name} deve sair às ${clock(recommendedDepartureAt[waiting])}.` : `${plan.participants[waiting].name}, saia agora para o ponto combinado!`;
  $('countdown-label').textContent = remaining > 0 ? `${plan.participants[waiting].name} sai em` : 'Hora de sair';
  $('countdown').textContent = `${String(Math.floor(remaining / 60)).padStart(2,'0')}:${String(remaining % 60).padStart(2,'0')}`;
  $('arrival-time').textContent = clock(arrivalAt[first]);
  if (remaining === 0) {
    const delay = Math.round(Math.max(0, now - recommendedDepartureAt[waiting]) / 60000);
    status(delay > 0 ? `Saia agora. A chegada pode ficar aproximadamente ${delay} min depois da outra pessoa.` : `${plan.participants[waiting].name}, hora de sair!`);
    if (viewer === waiting && !notified) {
      notified = true;
      if ('Notification' in window && Notification.permission === 'granted') new Notification('MeetSync — hora de sair', { body: `Vá para ${plan.destination}. ${plan.participants[first].name} já está a caminho.` });
    }
  }
}
function startUpdates() {
  clearInterval(timer); clearInterval(poller);
  timer = setInterval(tick, 1000);
  poller = setInterval(async () => {
    if (!session || busy || pollBusy || session.status === 'ended') return;
    pollBusy = true;
    try {
      accept(await api(`/api/meetings/${session.id}`));
      connection('Encontro conectado · atualizações automáticas entre os aparelhos');
    } catch(error) { connection(`Atualização interrompida: ${error.message}`, true); }
    finally { pollBusy = false; }
  }, 2500);
}
form.addEventListener('input', () => {
  ['a','b'].forEach((key,i) => { $('identity').options[i].textContent = $(`name-${key}`).value.trim() || `Pessoa ${key.toUpperCase()}`; });
  $('form-error').textContent = '';
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || session || !form.reportValidity()) return;
  if (!ready) { $('form-error').textContent = 'O serviço de rotas precisa estar configurado e conectado para calcular os tempos reais.'; return; }
  busy = true; setLocked(true); $('start-button').textContent = 'Calculando trajetos no Google…';
  try {
    await refreshUsage();
    if (usage?.remaining < 2) throw new Error('Saldo diário insuficiente para calcular os dois trajetos. Nenhuma consulta foi iniciada.');
    const viewer = Number($('identity').value);
    const data = await api('/api/meetings', planInput());
    credential = data.tokens[viewer];
    data.viewer = viewer;
    invite = linkFor(data.id, 1 - viewer, data.tokens[1 - viewer]);
    history.replaceState(null,'', linkFor(data.id, viewer, credential));
    try { sessionStorage.setItem(`invite-${data.id}`, invite); } catch {}
    accept(data);
    status('Envie o convite para a outra pessoa. Ao confirmar sua saída, o outro aparelho ativa a contagem automaticamente.');
    startUpdates();
    $('result-title').closest('section').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(error) {
    $('form-error').textContent = error.message;
    setLocked(false); $('start-button').textContent = 'Calcular trajetos e criar encontro →';
  } finally { busy = false; tick(); refreshUsage().catch(() => {}); }
});
$('depart-button').addEventListener('click', async () => {
  if (!session || busy || session.departedAt[session.viewer] !== null) return;
  busy = true; tick(); status('Consultando as rotas atuais do Google Maps…');
  try { accept(await api(`/api/meetings/${session.id}/depart`, {})); status('Saída confirmada. O outro aparelho recebe a atualização automaticamente.'); }
  catch(error) { status(`${error.message} Sua saída não foi registrada; tente novamente.`); }
  finally { busy = false; tick(); refreshUsage().catch(() => {}); }
});
$('copy-invite').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('invite-link').value); $('copy-invite').textContent = 'Convite copiado ✓'; }
  catch { $('invite-link').focus(); $('invite-link').select(); status('Copie o link selecionado e envie à outra pessoa.'); }
});
$('notifications-button').addEventListener('click', async () => {
  if (!('Notification' in window)) { status('Este navegador não oferece avisos. Acompanhe a contagem nesta página.'); return; }
  try {
    const permission = await Notification.requestPermission();
    status(permission === 'granted' ? 'Avisos ativados. Mantenha esta página aberta.' : 'Aviso do sistema não autorizado. O aviso na página continua ativo.');
  } catch { status('Avisos do sistema indisponíveis. Acompanhe esta página.'); }
});
$('end-button').addEventListener('click', async () => {
  if (!session || busy) return;
  if (session.status === 'ended') { location.href = location.pathname; return; }
  busy = true; tick();
  try { accept(await api(`/api/meetings/${session.id}/end`, {})); }
  catch(error) { status(error.message); }
  finally { busy = false; tick(); }
});
document.addEventListener('visibilitychange', () => { if(!document.hidden) tick(); });
async function initialize() {
  if (!['http:','https:'].includes(location.protocol)) {
    connection('Esta versão com Google Maps e encontro compartilhado precisa ser aberta pelo endereço do servidor. Um arquivo local não conecta os aparelhos.', true);
    return;
  }
  try {
    const config = await refreshUsage();
    ready = config.googleMapsConfigured;
    connection(ready ? 'Serviço de rotas configurado · calcule os trajetos para consultar o Google' : config.paidGoogleDisabled ? 'Google desativado para evitar cobranças. A alternativa gratuita de rotas ainda está em preparação.' : 'Rotas indisponíveis: o responsável precisa configurar a chave do Google Maps no servidor.', !ready);
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has('meeting') && params.has('token')) {
      credential = params.get('token');
      try { invite = sessionStorage.getItem(`invite-${params.get('meeting')}`); } catch {}
      accept(await api(`/api/meetings/${params.get('meeting')}`));
      startUpdates();
      status('Encontro conectado. Confirme apenas a sua saída; o outro participante recebe a atualização.');
    }
  } catch(error) { connection(error.message, true); }
}
initialize();
