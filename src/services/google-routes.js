export class RouteError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

const MODES = { car: 'DRIVE', walk: 'WALK', transit: 'TRANSIT' };
export function createGoogleRoutes({ apiKey = process.env.GOOGLE_MAPS_API_KEY, fetchImpl = fetch, budget = routeBudget, allowPaidRequests = false } = {}) {
  return async function route({ origin, destination, mode, departureAt }) {
    if (!apiKey) throw new RouteError('Configure GOOGLE_MAPS_API_KEY no servidor e habilite a Routes API no Google Cloud para calcular trajetos reais.', 503);
    if (!allowPaidRequests) throw new RouteError('Consultas ao Google estão desativadas no servidor para controlar custos.', 503);
    if (!MODES[mode]) throw new RouteError('Meio de transporte inválido.', 400);
    const body = {
      origin: { address: origin }, destination: { address: destination },
      travelMode: MODES[mode], languageCode: 'pt-BR', units: 'METRIC',
    };
    if (mode !== 'walk') body.departureTime = new Date(Math.max(departureAt, Date.now() + 1000)).toISOString();
    if (mode === 'car') body.routingPreference = 'TRAFFIC_AWARE';
    // Reserva persistida antes de enviar: erros, interrupções e tentativas também contam.
    await budget.reserve();
    let response;
    try {
      response = await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST', headers: {
          'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
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
    const result = data.routes?.[0];
    const seconds = Number(/^([0-9]+(?:\.[0-9]+)?)s$/.exec(result?.duration)?.[1]);
    if (!result || !Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) throw new RouteError('Nenhuma rota utilizável encontrada. Verifique os endereços e a disponibilidade desse transporte.');
    return { durationSeconds: seconds, distanceMeters: result.distanceMeters ?? null, source: 'Google Maps', calculatedAt: Date.now() };
  };
}
import { routeBudget } from './route-budget.js';

