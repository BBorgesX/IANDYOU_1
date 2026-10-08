import { randomBytes } from 'node:crypto';

const token = () => randomBytes(24).toString('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function validatePlan(input) {
  const text = (value, label) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 200) throw fail(`Informe ${label} com até 200 caracteres.`);
    return value.trim();
  };
  if (!input || !Array.isArray(input.participants) || input.participants.length !== 2) throw fail('Informe os dois participantes.');
  return { destination: text(input.destination, 'o destino'), participants: input.participants.map(p => {
    if (!p || !['car', 'walk', 'transit'].includes(p.mode)) throw fail('Selecione o meio de transporte.');
    return { name: text(p.name, 'o nome'), origin: text(p.origin, 'a origem'), mode: p.mode };
  }) };
}

export function createMeetingStore({ getRoute, now = Date.now, maxMeetings = 500 } = {}) {
  const meetings = new Map();
  async function routes(plan, at) {
    return Promise.all(plan.participants.map(p => getRoute({ origin: p.origin, destination: plan.destination, mode: p.mode, departureAt: at })));
  }
  function cleanup() { for (const [id, meeting] of meetings) if (meeting.expiresAt < now()) meetings.delete(id); }
  function find(id, credential) {
    cleanup();
    const meeting = meetings.get(id);
    if (!meeting) throw fail('Encontro encerrado ou expirado. Crie um novo encontro.', 404);
    const viewer = meeting.tokens.indexOf(credential);
    if (viewer === -1) throw fail('Convite inválido. Use o link enviado pela outra pessoa.', 403);
    return { meeting, viewer };
  }
  function snapshot(meeting, viewer) {
    return { id: meeting.id, plan: meeting.plan, routes: meeting.routes, departedAt: meeting.departedAt,
      arrivalAt: meeting.arrivalAt, recommendedDepartureAt: meeting.recommendedDepartureAt,
      version: meeting.version, status: meeting.status, viewer, serverNow: now(), expiresAt: meeting.expiresAt };
  }
  return {
    async create(input) {
      cleanup();
      if (meetings.size >= maxMeetings) throw fail('Servidor ocupado. Tente novamente mais tarde.', 503);
      const plan = validatePlan(input);
      const routeData = await routes(plan, now());
      const id = token();
      const meeting = { id, plan, routes: routeData, tokens: [token(), token()], departedAt: [null, null],
        arrivalAt: [null, null], recommendedDepartureAt: [null, null], version: 1,
        expiresAt: now() + 12 * 3600000, status: 'ready', busy: false };
      meetings.set(id, meeting);
      return { ...snapshot(meeting, 0), tokens: meeting.tokens };
    },
    get(id, credential) { const { meeting, viewer } = find(id, credential); return snapshot(meeting, viewer); },
    async depart(id, credential) {
      const { meeting, viewer } = find(id, credential);
      if (meeting.status === 'ended') throw fail('Este encontro foi encerrado.', 409);
      if (meeting.departedAt[viewer] !== null) return snapshot(meeting, viewer);
      if (meeting.busy) throw fail('Atualizando os trajetos. Aguarde alguns segundos e tente novamente.', 409);
      meeting.busy = true;
      try {
        // A confirmação é capturada antes da consulta; falhas não alteram o encontro.
        const departedAt = now();
        const other = 1 - viewer;
        const nextRoutes = [...meeting.routes];
        if (meeting.departedAt[other] === null) {
          const refreshed = await routes(meeting.plan, departedAt);
          nextRoutes[viewer] = refreshed[viewer];
          nextRoutes[other] = refreshed[other];
          const targetArrival = departedAt + nextRoutes[viewer].durationSeconds * 1000;
          const otherDeparture = Math.max(now(), targetArrival - nextRoutes[other].durationSeconds * 1000);
          if (meeting.plan.participants[other].mode !== 'walk' && otherDeparture > now() + 60000) {
            const p = meeting.plan.participants[other];
            nextRoutes[other] = await getRoute({ origin: p.origin, destination: meeting.plan.destination, mode: p.mode, departureAt: otherDeparture });
          }
        } else {
          const p = meeting.plan.participants[viewer];
          nextRoutes[viewer] = await getRoute({ origin: p.origin, destination: meeting.plan.destination, mode: p.mode, departureAt: departedAt });
        }
        if (meeting.status === 'ended') throw fail('Este encontro foi encerrado durante o cálculo.', 409);
        meeting.routes = nextRoutes;
        meeting.departedAt[viewer] = departedAt;
        meeting.arrivalAt[viewer] = departedAt + nextRoutes[viewer].durationSeconds * 1000;
        if (meeting.departedAt[other] === null) meeting.recommendedDepartureAt[other] = meeting.arrivalAt[viewer] - nextRoutes[other].durationSeconds * 1000;
        meeting.status = meeting.departedAt.every(t => t !== null) ? 'traveling' : 'waiting';
        meeting.version++;
        return snapshot(meeting, viewer);
      } finally { meeting.busy = false; }
    },
    end(id, credential) {
      const { meeting, viewer } = find(id, credential);
      meeting.status = 'ended'; meeting.version++;
      return snapshot(meeting, viewer);
    },
  };
}
