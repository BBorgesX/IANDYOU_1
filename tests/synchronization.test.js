import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSync, calculateDeparture } from '../src/engine/synchronization.js';

test('35 e 20: A sai agora, B espera 15 minutos e ambos chegam em 35', () => {
  assert.deepEqual(calculateSync(35, 20), { firstParticipant: 'A', differenceMinutes: 15, departureOffsets: [0, 15], arrivalOffsetMinutes: 35 });
});

test('contador parte da saída real, não do início da sessão', () => {
  const time = 1000000;
  assert.equal(calculateDeparture(35, 20, time, time).remainingSeconds, 900);
  assert.equal(calculateDeparture(35, 20, time, time + 60000).remainingSeconds, 840);
  assert.equal(calculateDeparture(35, 20, time, time + 900000).remainingSeconds, 0);
});
test('saída tardia informa atraso, sem contador negativo', () => {
  const result = calculateDeparture(35, 20, 1000000, 1000000 + 1200000);
  assert.equal(result.remainingSeconds, 0);
  assert.equal(result.delaySeconds, 300);
});
test('se a pessoa com trajeto curto sair primeiro, a outra sai agora com diferença prevista', () => {
  const result = calculateDeparture(20, 35, 1000000, 1000000);
  assert.equal(result.remainingSeconds, 0);
  assert.equal(result.delaySeconds, 900);
});
test('B sai primeiro quando seu trajeto é mais longo', () => {
  const plan = calculateSync(12, 30);
  assert.equal(plan.firstParticipant, 'B');
  assert.deepEqual(plan.departureOffsets, [18, 0]);
});
test('tempos iguais permitem saída simultânea', () => {
  const plan = calculateSync(20, 20);
  assert.equal(plan.firstParticipant, 'BOTH');
  assert.equal(plan.differenceMinutes, 0);
  assert.deepEqual(plan.departureOffsets, [0, 0]);
});
test('rejeita valores ausentes, não numéricos e fora do limite', () => {
  for (const invalid of [0, -5, 1441, NaN, Infinity, undefined, null, '35']) {
    assert.throws(() => calculateSync(invalid, 20), RangeError);
    assert.throws(() => calculateSync(20, invalid), RangeError);
  }
});
test('os horários calculados igualam a chegada nos dois trajetos', () => {
  for (const [a, b] of [[1, 1440], [1440, 1], [8, 8], [35, 20], [17, 42]]) {
    const plan = calculateSync(a, b);
    assert.equal(a + plan.departureOffsets[0], plan.arrivalOffsetMinutes);
    assert.equal(b + plan.departureOffsets[1], plan.arrivalOffsetMinutes);
  }
});
