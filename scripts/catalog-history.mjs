import { validateCatalog } from './catalog.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stable = value => JSON.stringify(value, (_key, item) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const equal = (left, right) => stable(left) === stable(right);
const known = value => value !== null && value !== undefined && value !== 'unknown' && (Array.isArray(value) ? value.length > 0 : object(value) ? Object.values(value).some(known) : true);
const losesKnown = (before, after) => known(before) && (!known(after) || (object(before) && Object.entries(before).some(([key, value]) => losesKnown(value, after?.[key]))));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const groups = ['persons', 'cards', 'products', 'other_items'];
const proofFor = (entity, field) => entity.provenance?.[field] ?? (field === 'asset_ids' ? entity.provenance?.image ?? entity.provenance?.name : undefined);

function summarize(catalog) {
  catalog.coverage.complete = false;
  catalog.coverage.scope = `출처 조사·수집 표본: 상품 ${catalog.products.length}개, 선수 카드 ${catalog.cards.length}개. 감독 구성은 수집 범위에서 제외합니다. 게임 전체 구성·현재 판매 여부·지속 갱신은 검증 전입니다.`;
  catalog.coverage.notes = [...new Set(catalog.coverage.notes)];
  return catalog;
}

/**
 * The committed seed is the durable accumulation boundary. Incoming snapshots
 * may cover only one newest-page window; omission never requests deletion.
 * This preserves entity/observation history, not an entire SQLite revision DB.
 */
export function mergeCatalogHistory(canonical, incoming) {
  validateCatalog(incoming);
  if (canonical === undefined || canonical === null) return validateCatalog(summarize(structuredClone(incoming)));
  validateCatalog(canonical);
  const result = structuredClone(canonical);
  const knownObservations = new Set(canonical.observations.map(observation => observation.id));
  const observations = new Map(result.observations.map(observation => [observation.id, observation]));
  for (const observation of incoming.observations) {
    const previous = observations.get(observation.id);
    assert(!previous || equal(previous, observation), `기존 관측 ID를 다른 내용으로 재사용할 수 없습니다: ${observation.id}`);
    if (!previous) { result.observations.push(structuredClone(observation)); observations.set(observation.id, observation); }
  }
  for (const source of incoming.sources) {
    const previous = result.sources.find(item => item.id === source.id);
    assert(!previous || equal(previous, source), `출처 ID의 정의가 달라졌습니다. 별도 검토가 필요합니다: ${source.id}`);
    if (!previous) result.sources.push(structuredClone(source));
  }
  const time = id => Date.parse(observations.get(id)?.observed_at ?? '') || 0;
  const shouldReplace = (before, after, previousProof, nextProof, label) => {
    if (!known(after) || losesKnown(before, after)) return false;
    if (!known(before)) return true;
    if (!nextProof) return false; // No fresh proof was supplied for this scope.
    const previousTime = time(previousProof);
    const nextTime = time(nextProof);
    if (nextTime < previousTime) {
      assert(equal(before, after) || knownObservations.has(nextProof), `새로 제출한 과거 근거로 최신 값을 교체할 수 없습니다: ${label}`);
      return false; // Replaying an already archived bootstrap is harmless.
    }
    if (nextTime === previousTime) {
      assert(equal(before, after), `같은 관측 시점에 상충하는 값을 자동 교체할 수 없습니다: ${label}`);
      return false;
    }
    return true;
  };

  for (const asset of incoming.assets) {
    const index = result.assets.findIndex(item => item.id === asset.id);
    if (index === -1) { result.assets.push(structuredClone(asset)); continue; }
    const previous = result.assets[index];
    assert(previous.url === asset.url && previous.kind === asset.kind, `같은 이미지 ID의 원본 주소·종류를 바꿀 수 없습니다: ${asset.id}`);
    const merged = structuredClone(previous);
    let replaced = false;
    for (const [field, value] of Object.entries(asset)) {
      if (['id', 'url', 'kind', 'observation_id'].includes(field)) continue;
      if (shouldReplace(previous[field], value, previous.observation_id, asset.observation_id, `${asset.id}.${field}`)) { merged[field] = structuredClone(value); replaced = true; }
    }
    if (replaced || (equal(previous.composition, asset.composition) && time(asset.observation_id) > time(previous.observation_id))) merged.observation_id = asset.observation_id;
    result.assets[index] = merged;
  }

  const identity = entity => entity.external_ids.map(external => ({ ...external }));
  const mergeIdentity = (previous, after) => {
    const values = identity(previous);
    for (const external of after.external_ids) {
      const sameKind = values.filter(item => item.source === external.source && item.id_type === external.id_type);
      assert(sameKind.length === 0 || sameKind.some(item => item.value === external.value), `같은 내부 ID의 원본 식별자를 바꿀 수 없습니다: ${previous.id}`);
      if (!values.some(item => equal(item, external))) values.push(structuredClone(external));
    }
    return values;
  };
  const mergeEntries = (previous, after) => {
    const before = previous.entries;
    const next = after.entries;
    const entryKey = entry => `${entry.kind}:${entry.target_id}`;
    const beforeCards = before.filter(entry => entry.kind === 'card');
    const nextCards = next.filter(entry => entry.kind === 'card');
    const beforeTime = Math.max(time(proofFor(previous, 'entries')), ...beforeCards.map(entry => time(entry.observation_id)));
    const nextProofs = nextCards.length ? nextCards.map(entry => entry.observation_id) : [proofFor(after, 'source_listed_player_count') ?? proofFor(after, 'name')];
    const afterTime = Math.max(...nextProofs.map(time));
    const signatures = entries => entries.filter(entry => entry.kind === 'card').map(entry => [entry.target_id, entry.quantity]).sort((a, b) => a[0].localeCompare(b[0]));
    const sameCards = equal(signatures(before), signatures(next));
    let replaceCards = afterTime > beforeTime;
    if (afterTime < beforeTime) {
      assert(sameCards || nextProofs.every(id => knownObservations.has(id)), `새로 제출한 과거 구성으로 최신 관계를 교체할 수 없습니다: ${previous.id}`);
    }
    if (afterTime === beforeTime) {
      assert(sameCards, `같은 관측 시점에 상충하는 상품 구성을 병합할 수 없습니다: ${previous.id}`);
    }
    const nextByKey = new Map(next.map(entry => [entryKey(entry), entry]));
    for (const entry of replaceCards ? beforeCards : []) {
      const replacement = nextByKey.get(entryKey(entry));
      assert(replacement && replacement.quantity >= entry.quantity, `기존 상품 카드가 새 구성에서 빠졌거나 수량이 줄었습니다: ${previous.id}`);
    }
    const merged = before.map(entry => {
      const replacement = nextByKey.get(entryKey(entry));
      if (!replacement) return structuredClone(entry); // Other-item scope was not collected.
      if (entry.kind === 'card' && !replaceCards) return structuredClone(entry);
      assert(replacement.quantity >= entry.quantity, `기존 구성 수량을 자동 삭제할 수 없습니다: ${previous.id}`);
      return time(replacement.observation_id) > time(entry.observation_id) ? structuredClone(replacement) : structuredClone(entry);
    });
    const existingKeys = new Set(before.map(entryKey));
    for (const entry of next) if (!existingKeys.has(entryKey(entry)) && (entry.kind !== 'card' || replaceCards)) merged.push(structuredClone(entry));
    return merged;
  };

  for (const group of groups) {
    if (!incoming[group]) continue;
    if (!result[group]) result[group] = [];
    for (const entity of incoming[group]) {
      const index = result[group].findIndex(item => item.id === entity.id);
      if (index === -1) { result[group].push(structuredClone(entity)); continue; }
      const previous = result[group][index];
      const merged = structuredClone(previous);
      merged.external_ids = mergeIdentity(previous, entity);
      for (const [field, value] of Object.entries(entity)) {
        if (['id', 'external_ids', 'provenance', 'entries'].includes(field)) continue;
        const previousProof = proofFor(previous, field);
        const nextProof = proofFor(entity, field);
        // A primary-only summary does not retract secondary classifications.
        if (field === 'types' && previous.types.length > 1 && value.length === 1) continue;
        if (!shouldReplace(previous[field], value, previousProof, nextProof, `${entity.id}.${field}`)) continue;
        if (Array.isArray(previous[field]) && Array.isArray(value)) {
          if (field === 'asset_ids') merged[field] = [...new Set([...value, ...previous[field]])];
          else {
            assert(previous[field].every(item => value.some(candidate => equal(candidate, item))), `확인된 목록의 원소를 자동 삭제할 수 없습니다: ${entity.id}.${field}`);
            merged[field] = structuredClone(value);
          }
        } else merged[field] = structuredClone(value);
        if (nextProof) merged.provenance[field] = nextProof;
        if (field === 'types' && entity.provenance.type_mapping) merged.provenance.type_mapping = entity.provenance.type_mapping;
      }
      if (group === 'products') merged.entries = mergeEntries(previous, entity);
      result[group][index] = merged;
    }
  }

  const latestSourceProof = (snapshot, kind) => snapshot.observations.filter(observation => observation.source_entity_kind === kind).sort((left, right) => Date.parse(right.observed_at) - Date.parse(left.observed_at))[0];
  for (const [key, value] of Object.entries(incoming.coverage.source_totals)) {
    const previous = result.coverage.source_totals[key];
    if (previous !== undefined && value < previous) {
      const proof = latestSourceProof(incoming, key === 'products' ? 'product_list' : 'card_list');
      const oldProof = latestSourceProof(canonical, key === 'products' ? 'product_list' : 'card_list');
      assert(proof && oldProof && knownObservations.has(proof.id) && Date.parse(proof.observed_at) <= Date.parse(oldProof.observed_at), `출처 총계 감소는 별도 검증이 필요합니다: ${key}`);
    } else result.coverage.source_totals[key] = value;
  }
  result.coverage.notes = [...new Set([...canonical.coverage.notes, ...incoming.coverage.notes])];
  for (const [field, value] of Object.entries(incoming.coverage)) {
    if (['scope', 'complete', 'source_totals', 'notes'].includes(field)) continue;
    if (result.coverage[field] === undefined || (object(value) && value.observed_at && Date.parse(value.observed_at) > Date.parse(result.coverage[field]?.observed_at ?? ''))) result.coverage[field] = structuredClone(value);
  }
  const times = [canonical.observed_at, incoming.observed_at, ...result.observations.map(observation => observation.observed_at)];
  result.observed_at = times.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest);
  return validateCatalog(summarize(result));
}
