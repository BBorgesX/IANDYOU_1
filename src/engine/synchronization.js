export function calculateSync(etaA, etaB) {
  for (const eta of [etaA, etaB]) {
    if (typeof eta !== 'number' || !Number.isFinite(eta) || eta <= 0 || eta > 1440) {
      throw new RangeError('Informe tempos entre 1 e 1440 minutos.');
    }
  }
  return {
    firstParticipant: etaA === etaB ? 'BOTH' : etaA > etaB ? 'A' : 'B',
    differenceMinutes: Math.abs(etaA - etaB),
    departureOffsets: [Math.max(etaA, etaB) - etaA, Math.max(etaA, etaB) - etaB],
    arrivalOffsetMinutes: Math.max(etaA, etaB),
  };
}

export function calculateDeparture(departedEta, waitingEta, departedAt, now) {
  calculateSync(departedEta, waitingEta);
  if (![departedAt, now].every(Number.isFinite)) throw new RangeError('Horário inválido.');
  const expectedArrivalAt = departedAt + departedEta * 60000;
  const departureAt = expectedArrivalAt - waitingEta * 60000;
  return {
    expectedArrivalAt,
    departureAt,
    remainingSeconds: Math.max(0, Math.ceil((departureAt - now) / 1000)),
    delaySeconds: Math.max(0, Math.ceil((now - departureAt) / 1000)),
  };
}
