import { secureRandomInt } from './random.mjs';

export class SimulatorError extends Error {
  constructor(code) { super(code); this.name = 'SimulatorError'; this.code = code; }
}
export const simulatorFail = code => { throw new SimulatorError(code); };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const decimalId = value => typeof value === 'string' && /^\d+$/.test(value);

/** Anonymous Standard slots remain one integer, never invented player records. */
export function validateRemainingPool(pool) {
  if (!pool || typeof pool !== 'object' || !Array.isArray(pool.remainingSpecialIds)
    || pool.remainingSpecialIds.some(id => !decimalId(id))
    || new Set(pool.remainingSpecialIds).size !== pool.remainingSpecialIds.length
    || !integer(pool.remainingStandardCount)
    || !Number.isSafeInteger(pool.remainingSpecialIds.length + pool.remainingStandardCount)) simulatorFail('INVALID_POOL');
  return pool.remainingSpecialIds.length + pool.remainingStandardCount;
}

/** Select each next slot uniformly from [0, remaining), then remove that slot. */
export function drawFromPool(pool, count, { randomInt = secureRandomInt } = {}) {
  const remaining = validateRemainingPool(pool);
  if (!Number.isSafeInteger(count) || count < 1) simulatorFail('INVALID_DRAW_COUNT');
  if (count > remaining) simulatorFail('INSUFFICIENT_REMAINING');
  if (typeof randomInt !== 'function') simulatorFail('RANDOM_INVALID');
  const remainingSpecialIds = [...pool.remainingSpecialIds];
  let remainingStandardCount = pool.remainingStandardCount;
  const results = [];
  for (let index = 0; index < count; index++) {
    const size = remainingSpecialIds.length + remainingStandardCount;
    const slot = randomInt(size);
    if (!Number.isSafeInteger(slot) || slot < 0 || slot >= size) simulatorFail('RANDOM_INVALID');
    if (slot < remainingSpecialIds.length) results.push({ kind: 'special', cardId: remainingSpecialIds.splice(slot, 1)[0] });
    else { remainingStandardCount -= 1; results.push({ kind: 'standard' }); }
  }
  return { remainingSpecialIds, remainingStandardCount, results };
}
