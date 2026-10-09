import { waypoint } from '../location.js';
export class RouteError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

const MODES = { car: 'DRIVE', uber: 'DRIVE', bus: 'TRANSIT', subway: 'TRANSIT', walk: 'WALK', transit: 'TRANSIT' };
const VEHICLES = { bus: ['BUS', 'INTERCITY_BUS', 'TROLLEYBUS'], subway: ['SUBWAY'] };
export function createGoogleRoutes({ apiKey = process.env.GOOGLE_MAPS_API_KEY, fetchImpl = fetch, budget = routeBudget, allowPaidRequests = false } = {}) {
  return async function route({ origin, location, placeId, destination, destinationPlaceId, mode, departureAt }) {
    if (!apiKey) throw new RouteError('Configure GOOGLE_MAPS_API_KEY no servidor e habilite a Routes API no Google Cloud para calcular trajetos reais.', 503);
    if (!allowPaidRequests) throw new RouteError('Consultas ao Google estão desativadas no servidor para controlar custos.', 503);
    if (!MODES[mode]) throw new RouteError('Meio de transporte inválido.', 400);
    const body = {
      origin: waypoint(origin, location, placeId), destination: waypoint(destination, null, destinationPlaceId),
      travelMode: MODES[mode], languageCode: 'pt-BR', units: 'METRIC',
    };
    if (mode !== 'walk') body.departureTime = new Date(Math.max(departureAt, Date.now() + 1000)).toISOString();
    if (MODES[mode] === 'DRIVE') body.routingPreference = 'TRAFFIC_AWARE';
    if (VEHICLES[mode]) {
      body.transitPreferences = { allowedTravelModes: [mode === 'bus' ? 'BUS' : 'SUBWAY'] };
      body.computeAlternativeRoutes = true;
    }
    // Reserva persistida antes de enviar: erros, interrupções e tentativas também contam.
    await budget.reserve();
    let response;
    try {
      response = await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST', headers: {
          'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters' + (VEHICLES[mode] ? ',routes.legs.steps.transitDetails.transitLine.vehicle.type' : ''),
        }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
    } catch { throw new RouteError('Não foi possível acessar o Google Maps. Confira a conexão e tente novamente.'); }
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new RouteError('Google recusou o acesso. Confira a chave, a Routes API habilitada, o faturamento e as restrições da chave.', 503);
      if (response.status === 429) throw new RouteError('Limite de consultas do Google atingido. Tente novamente mais tarde.', 429);
      throw new RouteError('Google não conseguiu calcular este trajeto. Confira os endereços completos e o transporte.');
    }
    let data;
    try { data = await response.json(); } catch { throw new RouteError('Resposta inválida do Google Maps.'); }
    const vehicles = route => (route.legs || []).flatMap(leg => (leg.steps || []).map(step => step.transitDetails?.transitLine?.vehicle?.type).filter(Boolean));
    const result = VEHICLES[mode] ? data.routes?.find(route => {
      const types = vehicles(route);
      return types.length > 0 && types.every(type => VEHICLES[mode].includes(type));
    }) : data.routes?.[0];
    if (!result && VEHICLES[mode]) throw new RouteError('Google não retornou um trajeto compatível com ' + (mode === 'bus' ? 'ônibus' : 'metrô') + ' para estes pontos e horário. Altere os endereços ou escolha outro transporte.');
    const seconds = Number(/^([0-9]+(?:\.[0-9]+)?)s$/.exec(result?.duration)?.[1]);
    if (!result || !Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) throw new RouteError('Nenhuma rota utilizável encontrada. Verifique os endereços e a disponibilidade desse transporte.');
    return { durationSeconds: seconds, distanceMeters: result.distanceMeters ?? null, source: 'Google Maps', calculatedAt: Date.now(),
      ...(mode === 'uber' ? { note: 'Estimativa de carro; não inclui espera pelo motorista do Uber.' } : {}) };
  };
}
import { routeBudget } from './route-budget.js';

