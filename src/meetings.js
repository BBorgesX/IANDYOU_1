import { randomBytes } from 'node:crypto';
import { validateLocation } from './location.js';

const token = () => randomBytes(24).toString('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const MODES = ['car', 'uber', 'bus', 'subway', 'walk', 'transit'];
function text(value, label, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw fail('Informe ' + label + ' com até 200 caracteres.');
  return value.trim();
}
function participant(input, optional = false) {
  if (!input || !MODES.includes(input.mode)) throw fail('Selecione o meio de transporte.');
  const location = validateLocation(input.location);
  if (location && input.gpsConsent !== true) throw fail('Autorize o compartilhamento do seu GPS neste aparelho.');
  const origin = text(input.origin, 'a origem', optional || Boolean(location));
  if (!optional && !origin && !location) throw fail('Informe seu endereço ou autorize o GPS.');
  return { name: text(input.name, 'o nome'), origin, mode: input.mode, location,
    placeId: text(input.placeId, 'o lugar selecionado', true) || null };
}
export function validatePlan(input) {
  if (!input || !Array.isArray(input.participants) || input.participants.length !== 2) throw fail('Informe os dois participantes.');
  const creator = input.creator ?? 0;
  if (![0, 1].includes(creator)) throw fail('Identidade do criador inválida.');
  const participants = input.participants.map((p, index) => {
    if (index !== creator && p?.location) throw fail('Cada pessoa autoriza o próprio GPS pelo convite.');
    return participant(p, index !== creator);
  });
  return { destination: text(input.destination, 'o destino'), destinationPlaceId: text(input.destinationPlaceId, 'o lugar de encontro', true) || null, participants };
}

export function createMeetingStore({ getRoute, now = Date.now, maxMeetings = 500, refreshIntervalMs = 120000, beforeRoutes = async () => {} } = {}) {
  const meetings = new Map();
  const hasOrigin = p => Boolean(p.origin || p.location);
  const routeInput = (plan, index, departureAt) => ({ ...plan.participants[index], destination: plan.destination, destinationPlaceId: plan.destinationPlaceId, departureAt });
  function cleanup() { for (const [id, meeting] of meetings) if (meeting.expiresAt < now()) meetings.delete(id); }
  function find(id, credential) {
    cleanup();
    const meeting = meetings.get(id);
    if (!meeting) throw fail('Encontro encerrado ou expirado. Crie um novo encontro.', 404);
    const viewer = meeting.tokens.indexOf(credential);
    if (viewer === -1) throw fail('Convite inválido. Use o link enviado pela outra pessoa.', 403);
    return { meeting, viewer };
  }
  function active(meeting) {
    if (meeting.status === 'ended' || meeting.expiresAt < now()) throw fail('Este encontro foi encerrado ou expirou.', 409);
  }
  function mutable(meeting) {
    active(meeting);
    if (meeting.busy) throw fail('Atualizando os trajetos. Aguarde alguns segundos.', 409);
  }
  function sync(meeting) {
    const first = meeting.departedAt.findIndex(at => at !== null);
    meeting.recommendedDepartureAt = [null, null];
    if (first !== -1 && meeting.departedAt[1 - first] === null && meeting.routes[1 - first]) {
      meeting.recommendedDepartureAt[1 - first] = meeting.arrivalAt[first] - meeting.routes[1 - first].durationSeconds * 1000;
    }
    meeting.status = meeting.departedAt.every(at => at !== null) ? 'traveling' : first !== -1 ? 'waiting' : 'ready';
  }
  function snapshot(meeting, viewer) {
    const at = now();
    const predictedArrivalAt = meeting.routes.map((route, i) => !route ? null : meeting.departedAt[i] !== null ? meeting.arrivalAt[i] :
      Math.max(at, meeting.recommendedDepartureAt[i] ?? at) + route.durationSeconds * 1000);
    const differenceSeconds = predictedArrivalAt.every(Number.isFinite) ? Math.abs(predictedArrivalAt[0] - predictedArrivalAt[1]) / 1000 : null;
    return structuredClone({ id: meeting.id, plan: meeting.plan, routes: meeting.routes, accepted: meeting.accepted,
      departedAt: meeting.departedAt, arrivalAt: meeting.arrivalAt, predictedArrivalAt,
      comparison: { differenceSeconds, waitingParticipant: differenceSeconds > 0 ? (predictedArrivalAt[0] < predictedArrivalAt[1] ? 0 : 1) : null,
        basis: meeting.departedAt.every(at => at === null) ? 'depart-now' : 'planned' },
      recommendedDepartureAt: meeting.recommendedDepartureAt, locationUpdatedAt: meeting.locationUpdatedAt,
      routeUpdatedAt: meeting.routeUpdatedAt, lastRefreshAt: meeting.lastRefreshAt, nextRefreshAt: meeting.nextRefreshAt,
      version: meeting.version, status: meeting.status, viewer, serverNow: at, expiresAt: meeting.expiresAt });
  }
  return {
    async create(input) {
      cleanup();
      if (meetings.size >= maxMeetings) throw fail('Servidor ocupado. Tente novamente mais tarde.', 503);
      const plan = validatePlan(input);
      const creator = input.creator ?? 0;
      const at = now();
      await beforeRoutes(plan.participants.filter(hasOrigin).length);
      const routeData = await Promise.all(plan.participants.map((p, i) => hasOrigin(p) ? getRoute(routeInput(plan, i, at)) : null));
      const id = token();
      const meeting = { id, plan, routes: routeData, tokens: [token(), token()],
        accepted: plan.participants.map(hasOrigin), departedAt: [null, null], arrivalAt: [null, null], recommendedDepartureAt: [null, null],
        locationUpdatedAt: plan.participants.map(p => p.location ? at : null), routeUpdatedAt: routeData.map(route => route ? at : null),
        lastRefreshAt: at, nextRefreshAt: at + refreshIntervalMs, version: 1,
        expiresAt: at + 12 * 3600000, status: 'ready', busy: false };
      meetings.set(id, meeting);
      return { ...snapshot(meeting, creator), tokens: [...meeting.tokens] };
    },
    get(id, credential) { const { meeting, viewer } = find(id, credential); return snapshot(meeting, viewer); },
    async profile(id, credential, input) {
      const { meeting, viewer } = find(id, credential);
      mutable(meeting);
      const next = participant({ ...input, name: meeting.plan.participants[viewer].name });
      const previous = meeting.plan.participants[viewer];
      const changed = !meeting.routes[viewer] || JSON.stringify(previous) !== JSON.stringify(next);
      meeting.busy = true;
      try {
        const at = now();
        const plan = { ...meeting.plan, participants: meeting.plan.participants.map((p, i) => i === viewer ? next : p) };
        if (changed) await beforeRoutes(1);
        active(meeting);
        const route = changed ? await getRoute(routeInput(plan, viewer, at)) : meeting.routes[viewer];
        active(meeting);
        meeting.plan = plan;
        meeting.accepted[viewer] = true;
        meeting.routes[viewer] = route;
        meeting.locationUpdatedAt[viewer] = next.location ? at : null;
        if (changed) {
          meeting.routeUpdatedAt[viewer] = at;
          meeting.lastRefreshAt = at;
          if (meeting.departedAt[viewer] !== null) meeting.arrivalAt[viewer] = at + route.durationSeconds * 1000;
        }
        sync(meeting); meeting.version++;
        return snapshot(meeting, viewer);
      } finally { meeting.busy = false; }
    },
    location(id, credential, input) {
      const { meeting, viewer } = find(id, credential);
      mutable(meeting);
      const location = validateLocation(input.location);
      if (location && input.gpsConsent !== true) throw fail('Autorize o compartilhamento do seu GPS neste aparelho.');
      if (location && !meeting.accepted[viewer]) throw fail('Confirme primeiro seu transporte e sua origem.', 409);
      const p = meeting.plan.participants[viewer];
      p.location = location;
      if (location) p.placeId = null;
      meeting.locationUpdatedAt[viewer] = location ? now() : null;
      meeting.version++;
      return snapshot(meeting, viewer);
    },
    async depart(id, credential) {
      const { meeting, viewer } = find(id, credential);
      active(meeting);
      if (meeting.departedAt[viewer] !== null) return snapshot(meeting, viewer);
      mutable(meeting);
      if (!meeting.accepted[viewer] || !hasOrigin(meeting.plan.participants[viewer])) throw fail('Confirme seu transporte e informe a origem antes de sair.', 409);
      meeting.busy = true;
      try {
        const departedAt = now();
        const other = 1 - viewer;
        const nextRoutes = [...meeting.routes];
        const otherKnown = hasOrigin(meeting.plan.participants[other]);
        const required = meeting.departedAt[other] !== null || !otherKnown ? 1 : meeting.plan.participants[other].mode === 'walk' ? 2 : 3;
        await beforeRoutes(required);
        active(meeting);
        if (meeting.departedAt[other] === null && otherKnown) {
          const refreshed = await Promise.all([0, 1].map(i => getRoute(routeInput(meeting.plan, i, departedAt))));
          nextRoutes[viewer] = refreshed[viewer]; nextRoutes[other] = refreshed[other];
          const targetArrival = departedAt + nextRoutes[viewer].durationSeconds * 1000;
          const otherDeparture = Math.max(now(), targetArrival - nextRoutes[other].durationSeconds * 1000);
          if (meeting.plan.participants[other].mode !== 'walk' && otherDeparture > now() + 60000) {
            active(meeting);
            nextRoutes[other] = await getRoute(routeInput(meeting.plan, other, otherDeparture));
          }
        } else nextRoutes[viewer] = await getRoute(routeInput(meeting.plan, viewer, departedAt));
        active(meeting);
        meeting.routes = nextRoutes;
        meeting.departedAt[viewer] = departedAt;
        meeting.arrivalAt[viewer] = departedAt + nextRoutes[viewer].durationSeconds * 1000;
        meeting.routeUpdatedAt[viewer] = departedAt;
        if (meeting.departedAt[other] === null && otherKnown) meeting.routeUpdatedAt[other] = departedAt;
        meeting.lastRefreshAt = departedAt; meeting.nextRefreshAt = departedAt + refreshIntervalMs;
        sync(meeting); meeting.version++;
        return snapshot(meeting, viewer);
      } finally { meeting.busy = false; }
    },
    async refresh(id, credential) {
      const { meeting, viewer } = find(id, credential);
      active(meeting);
      // Duas páginas abertas usam uma só janela de atualização no servidor.
      if (meeting.busy || now() < meeting.nextRefreshAt) return snapshot(meeting, viewer);
      meeting.busy = true;
      const at = now();
      // Tentativas malsucedidas também aguardam a próxima janela, evitando loops de gasto.
      meeting.nextRefreshAt = at + refreshIntervalMs;
      try {
        const indexes = [0, 1].filter(i => hasOrigin(meeting.plan.participants[i]) &&
          (!meeting.routes[i] || at - (meeting.routeUpdatedAt[i] ?? 0) >= refreshIntervalMs) &&
          (meeting.departedAt[i] === null || (meeting.plan.participants[i].location && at - meeting.locationUpdatedAt[i] <= 90000)));
        await beforeRoutes(indexes.length);
        active(meeting);
        const refreshed = await Promise.all(indexes.map(i => getRoute(routeInput(meeting.plan, i,
          meeting.departedAt[i] === null ? Math.max(at, meeting.recommendedDepartureAt[i] ?? at) : at))));
        active(meeting);
        indexes.forEach((i, k) => {
          meeting.routes[i] = refreshed[k]; meeting.routeUpdatedAt[i] = at;
          if (meeting.departedAt[i] !== null) meeting.arrivalAt[i] = at + refreshed[k].durationSeconds * 1000;
        });
        if (indexes.length) meeting.lastRefreshAt = at;
        sync(meeting); meeting.version++;
        return snapshot(meeting, viewer);
      } finally { meeting.busy = false; }
    },
    end(id, credential) {
      const { meeting, viewer } = find(id, credential);
      meeting.status = 'ended'; meeting.plan.participants.forEach(p => { p.location = null; });
      meeting.locationUpdatedAt = [null, null]; meeting.version++;
      return snapshot(meeting, viewer);
    },
  };
}
