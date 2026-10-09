import { RouteError } from './google-routes.js';
import { placesBudget } from './route-budget.js';

export function createGooglePlaces({ apiKey = '', enabled = false, budget = placesBudget, fetchImpl = fetch } = {}) {
  return async function autocomplete(input) {
    if (typeof input !== 'string' || input.length > 200) throw new RouteError('Endereço inválido.', 400);
    input = input.trim();
    if (input.length < 4) return [];
    if (!enabled || !apiKey) throw new RouteError('Sugestões do Google desativadas. Digite o endereço completo para continuar.', 503);
    await budget.reserve();
    let response;
    try {
      response = await fetchImpl('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST', headers: {
          'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text',
        },
        body: JSON.stringify({ input, languageCode: 'pt-BR', includedRegionCodes: ['br'], includeQueryPredictions: false }),
        signal: AbortSignal.timeout(10000),
      });
    } catch { throw new RouteError('Sugestões indisponíveis no momento. Digite o endereço completo.'); }
    if (!response.ok) throw new RouteError(response.status === 429 ? 'Cota de sugestões do Google atingida. Digite o endereço completo.' : 'Google recusou as sugestões. Confira Places API (New) e as restrições da chave; o endereço manual continua disponível.', response.status === 429 ? 429 : 503);
    let data;
    try { data = await response.json(); } catch { throw new RouteError('Resposta de sugestões inválida. Digite o endereço completo.'); }
    return (data.suggestions || []).map(item => item.placePrediction).filter(item => typeof item?.placeId === 'string' && typeof item?.text?.text === 'string')
      .slice(0, 5).map(item => ({ placeId: item.placeId, description: item.text.text }));
  };
}
