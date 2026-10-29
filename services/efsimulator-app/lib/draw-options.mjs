/** Read the published contract; card count/title never imply an available mode. */
export function readDrawOptions(pack) {
  const value = pack?.drawOptions;
  const validCost = cost => cost === null || (Number.isSafeInteger(cost) && cost >= 0);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { single, ten, provenance } = value;
  if (!single || single.count !== 1 || typeof single.supported !== 'boolean' || !validCost(single.coinCost)
    || !ten || ten.count !== 10 || typeof ten.supported !== 'boolean' || !validCost(ten.coinCost)
    || ten.minimumRemaining !== 10 || !provenance || typeof provenance.authority !== 'string'
    || typeof provenance.reference !== 'string' || typeof provenance.rule !== 'string') return null;
  return { single, ten };
}

export function drawCostLabel(coinCost) {
  return coinCost === null ? '비용 확인 중' : `${coinCost.toLocaleString('ko-KR')} 코인`;
}

/** The engine can use this guard without guessing support from N or a pack name. */
export function canDrawCount(pack, count, remaining) {
  const options = readDrawOptions(pack);
  if (!options || !Number.isSafeInteger(remaining) || remaining < 1) return false;
  if (count === 1) return options.single.supported;
  if (count === 10) return options.ten.supported && remaining >= options.ten.minimumRemaining;
  return false;
}
