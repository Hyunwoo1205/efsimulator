import { prepareSimulatorPack } from './prepare.mjs';
import { drawFromPool, simulatorFail, SimulatorError, validateRemainingPool } from './engine.mjs';
export { SimulatorError } from './engine.mjs';

export const SIMULATOR_POLICY_VERSION = 'uniform-without-replacement-1';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const decimalId = value => typeof value === 'string' && /^\d+$/.test(value);
const timestamp = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const sameIds = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const sortedRight = [...right].sort();
  return [...left].sort().every((id, index) => id === sortedRight[index]);
};
const ensure = (condition, code = 'INVALID_SESSION') => { if (!condition) simulatorFail(code); };
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const plus = (left, right) => { const value = left + right; ensure(integer(value), 'LIMIT_EXCEEDED'); return value; };
const time = now => { ensure(timestamp(now), 'INVALID_TIME'); return new Date(now).toISOString(); };
const roundId = (sessionId, number) => `${sessionId}:round:${number}`;

function reviewedOptions(options, total) {
  return exact(options, ['single', 'ten', 'provenance'])
    && exact(options.single, ['supported', 'count', 'coinCost'])
    && exact(options.ten, ['supported', 'count', 'coinCost', 'minimumRemaining'])
    && exact(options.provenance, ['authority', 'reference', 'rule'])
    && options.single.supported === true && options.single.count === 1 && options.single.coinCost === 100
    && options.ten.supported === (total > 11) && options.ten.count === 10 && options.ten.coinCost === 900 && options.ten.minimumRemaining === 10
    && options.provenance.authority === 'direct_user_confirmation' && options.provenance.reference === 'T042'
    && options.provenance.rule === 'total_player_count_gt_11';
}

/** Stable probability identity, not a security hash or upstream authentication. */
export function poolFingerprint(pack) {
  ensure(object(pack) && text(pack.saleId) && integer(pack.totalPlayerCount) && pack.totalPlayerCount > 0
    && Array.isArray(pack.members) && pack.members.every(member => object(member) && decimalId(member.id)), 'INVALID_PACK');
  const ids = pack.members.map(member => member.id).sort();
  ensure(new Set(ids).size === ids.length && ids.length <= pack.totalPlayerCount && reviewedOptions(pack.drawOptions, pack.totalPlayerCount), 'INVALID_PACK');
  const options = pack.drawOptions;
  return JSON.stringify({ saleId: pack.saleId, totalPlayerCount: pack.totalPlayerCount, specialPlayerIds: ids,
    policyVersion: SIMULATOR_POLICY_VERSION,
    drawOptions: { single: { supported: options.single.supported, count: 1, coinCost: options.single.coinCost },
      ten: { supported: options.ten.supported, count: 10, coinCost: options.ten.coinCost, minimumRemaining: 10 },
      provenance: { authority: options.provenance.authority, reference: options.provenance.reference, rule: options.provenance.rule } } });
}

function snapshotPack(session) {
  const players = session.snapshot.players;
  return { saleId: session.saleId, name: session.snapshot.packTitle, officialTitle: session.snapshot.packTitle,
    playerCount: session.initial.specialPlayerCount, totalPlayerCount: session.initial.totalPlayerCount,
    standardPlayerCount: session.initial.standardPlayerCount,
    members: players.map(player => ({ id: player.id, name: player.name })), players,
    drawOptions: session.snapshot.drawOptions };
}

function fullRound(session, number) {
  return { id: roundId(session.sessionId, number), number,
    remainingSpecialIds: session.snapshot.players.map(player => player.id).sort(),
    remainingStandardCount: session.initial.standardPlayerCount, drawCount: 0, coinCost: 0 };
}

/**
 * The source snapshot is captured once; unrelated publication/display updates do not reset it.
 * @param {{ preparation?: any, pack?: any, sessionId?: string, now?: string }} [options]
 */
export function createSimulatorSession({ preparation, pack, sessionId, now = new Date().toISOString() } = {}) {
  ensure(preparation?.ready === true && object(pack) && text(sessionId) && text(preparation.publicationVersionId)
    && preparation.saleId === pack.saleId, 'PREPARATION_REQUIRED');
  const rechecked = prepareSimulatorPack({ saleId: pack.saleId, catalog: { manifest: { version_id: preparation.publicationVersionId }, live: [pack], archive: [], players: pack.players } });
  ensure(rechecked.ready && object(preparation.counts) && sameIds(preparation.specialPlayerIds, rechecked.specialPlayerIds)
    && ['totalPlayerCount', 'specialPlayerCount', 'standardPlayerCount'].every(key => preparation.counts[key] === rechecked.counts[key]), 'PREPARATION_REQUIRED');
  const at = time(now);
  const session = { schemaVersion: 1, sessionId, saleId: pack.saleId, publicationVersionId: preparation.publicationVersionId,
    poolFingerprint: poolFingerprint(pack), policyVersion: SIMULATOR_POLICY_VERSION,
    snapshot: { packTitle: pack.officialTitle || pack.name, players: structuredClone(pack.players), drawOptions: structuredClone(pack.drawOptions) },
    initial: structuredClone(rechecked.counts), revision: 0, activeRound: null,
    rounds: [], batches: [], resets: [], totals: { drawCount: 0, coinCost: 0 }, pendingBatchId: null,
    commands: [], createdAt: at, updatedAt: at };
  session.activeRound = fullRound(session, 1);
  validateSimulatorSession(session);
  return session;
}

/** Reconstruct each round from immutable batches to detect corrupt or partial stored state. */
export function validateSimulatorSession(session) {
  try {
    ensure(exact(session, ['schemaVersion', 'sessionId', 'saleId', 'publicationVersionId', 'poolFingerprint', 'policyVersion', 'snapshot', 'initial', 'revision', 'activeRound', 'rounds', 'batches', 'resets', 'totals', 'pendingBatchId', 'commands', 'createdAt', 'updatedAt']));
    ensure(session.schemaVersion === 1 && text(session.sessionId) && text(session.saleId) && text(session.publicationVersionId)
      && session.policyVersion === SIMULATOR_POLICY_VERSION && timestamp(session.createdAt) && timestamp(session.updatedAt));
    ensure(exact(session.snapshot, ['packTitle', 'players', 'drawOptions']) && text(session.snapshot.packTitle) && Array.isArray(session.snapshot.players));
    ensure(exact(session.initial, ['totalPlayerCount', 'specialPlayerCount', 'standardPlayerCount']));
    const { totalPlayerCount: total, specialPlayerCount: special, standardPlayerCount: standard } = session.initial;
    ensure(integer(total) && total > 0 && integer(special) && integer(standard) && special <= total && standard === total - special);
    const pack = snapshotPack(session);
    const prepared = prepareSimulatorPack({ saleId: session.saleId, catalog: { manifest: { version_id: session.publicationVersionId }, live: [pack], archive: [], players: pack.players } });
    ensure(prepared.ready && session.poolFingerprint === poolFingerprint(pack));
    ensure(integer(session.revision) && Array.isArray(session.commands) && session.commands.length === session.revision
      && Array.isArray(session.rounds) && Array.isArray(session.batches) && Array.isArray(session.resets)
      && exact(session.totals, ['drawCount', 'coinCost']) && integer(session.totals.drawCount) && integer(session.totals.coinCost));
    const commandMap = new Map();
    for (const command of session.commands) {
      ensure(object(command) && text(command.id) && ['draw', 'reset', 'acknowledge'].includes(command.type)
        && !commandMap.has(command.id) && Object.keys(command).every(key => ['id', 'type', 'batchId'].includes(key)));
      commandMap.set(command.id, command);
    }
    const rounds = [...session.rounds, session.activeRound];
    const roundMap = new Map();
    for (let index = 0; index < rounds.length; index++) {
      const round = rounds[index]; const closed = index < session.rounds.length;
      ensure(exact(round, ['id', 'number', 'remainingSpecialIds', 'remainingStandardCount', 'drawCount', 'coinCost', ...(closed ? ['closedAt', 'reason'] : [])]));
      ensure(round.number === index + 1 && round.id === roundId(session.sessionId, round.number) && !roundMap.has(round.id)
        && integer(round.drawCount) && round.drawCount <= total && integer(round.coinCost));
      const remaining = validateRemainingPool(round);
      ensure(remaining === total - round.drawCount && round.remainingStandardCount <= standard
        && round.remainingSpecialIds.every(id => prepared.specialPlayerIds.includes(id)));
      if (closed) ensure(timestamp(round.closedAt) && ['manual', 'exhausted'].includes(round.reason)
        && (round.reason !== 'exhausted' || remaining === 0));
      else ensure(remaining > 0);
      roundMap.set(round.id, { round, special: new Set(prepared.specialPlayerIds), standard, draws: 0, coins: 0 });
    }
    const batchMap = new Map(); let totalDraws = 0; let totalCoins = 0; let lastRoundNumber = 0;
    const pending = [];
    for (const batch of session.batches) {
      ensure(exact(batch, ['id', 'commandId', 'roundId', 'roundNumber', 'count', 'coinCost', 'results', 'createdAt', 'acknowledged']));
      const ledger = roundMap.get(batch.roundId); const receipt = commandMap.get(batch.commandId);
      ensure(text(batch.id) && batch.id === `${session.sessionId}:batch:${batch.commandId}` && !batchMap.has(batch.id)
        && ledger && batch.roundNumber === ledger.round.number && batch.roundNumber >= lastRoundNumber
        && receipt?.type === 'draw' && receipt.batchId === batch.id && timestamp(batch.createdAt)
        && typeof batch.acknowledged === 'boolean' && [1, 10].includes(batch.count)
        && (batch.count !== 10 || pack.drawOptions.ten.supported)
        && batch.coinCost === (batch.count === 1 ? pack.drawOptions.single.coinCost : pack.drawOptions.ten.coinCost)
        && Array.isArray(batch.results) && batch.results.length === batch.count
        && total - ledger.draws >= batch.count);
      for (const result of batch.results) {
        if (result?.kind === 'special') ensure(exact(result, ['kind', 'cardId']) && decimalId(result.cardId) && ledger.special.delete(result.cardId));
        else { ensure(exact(result, ['kind']) && result.kind === 'standard' && ledger.standard > 0); ledger.standard -= 1; }
      }
      ledger.draws = plus(ledger.draws, batch.count); ledger.coins = plus(ledger.coins, batch.coinCost);
      totalDraws = plus(totalDraws, batch.count); totalCoins = plus(totalCoins, batch.coinCost);
      batchMap.set(batch.id, batch); lastRoundNumber = batch.roundNumber;
      if (!batch.acknowledged) pending.push(batch.id);
    }
    for (const ledger of roundMap.values()) ensure(ledger.draws === ledger.round.drawCount && ledger.coins === ledger.round.coinCost
      && ledger.standard === ledger.round.remainingStandardCount && sameIds([...ledger.special], ledger.round.remainingSpecialIds));
    ensure(session.totals.drawCount === totalDraws && session.totals.coinCost === totalCoins
      && pending.length <= 1 && (pending.length ? session.pendingBatchId === pending[0] && pending[0] === session.batches.at(-1).id : session.pendingBatchId === null));
    ensure(session.resets.length === session.rounds.length);
    const resetIds = new Set(); const manualCommands = new Set();
    for (let index = 0; index < session.resets.length; index++) {
      const reset = session.resets[index]; const closed = session.rounds[index]; const next = rounds[index + 1];
      ensure(exact(reset, ['id', 'commandId', 'reason', 'roundId', 'newRoundId', 'createdAt'])
        && reset.id === `${session.sessionId}:reset:${reset.commandId}` && !resetIds.has(reset.id) && reset.reason === closed.reason
        && reset.roundId === closed.id && reset.newRoundId === next.id && timestamp(reset.createdAt));
      const receipt = commandMap.get(reset.commandId);
      ensure(reset.reason === 'manual' ? receipt?.type === 'reset' : receipt?.type === 'draw' && batchMap.get(receipt.batchId)?.roundId === closed.id);
      resetIds.add(reset.id);
      if (reset.reason === 'manual') { ensure(!manualCommands.has(reset.commandId)); manualCommands.add(reset.commandId); }
    }
    const acknowledged = new Set();
    for (const command of session.commands) {
      if (command.type === 'draw') ensure(batchMap.get(command.batchId)?.commandId === command.id);
      if (command.type === 'reset') ensure(manualCommands.has(command.id) && !Object.hasOwn(command, 'batchId'));
      if (command.type === 'acknowledge') {
        ensure(batchMap.get(command.batchId)?.acknowledged === true && !acknowledged.has(command.batchId)); acknowledged.add(command.batchId);
      }
    }
    ensure(session.batches.every(batch => batch.acknowledged === acknowledged.has(batch.id)));
    return session;
  } catch (error) {
    if (error instanceof SimulatorError && error.code === 'INVALID_SESSION') throw error;
    simulatorFail('INVALID_SESSION');
  }
}

function closeRound(session, commandId, reason, at) {
  const previous = session.activeRound;
  const number = plus(previous.number, 1);
  session.rounds.push({ ...previous, closedAt: at, reason });
  session.activeRound = fullRound(session, number);
  session.resets.push({ id: `${session.sessionId}:reset:${commandId}`, commandId, reason,
    roundId: previous.id, newRoundId: session.activeRound.id, createdAt: at });
}

/**
 * Apply one atomic transition; caller persists this returned state before revealing results.
 * @param {any} session
 * @param {any} command
 * @param {{ randomInt?: (max: number) => number, now?: string }} [options]
 */
export function applySimulatorCommand(session, command, { randomInt, now = new Date().toISOString() } = {}) {
  validateSimulatorSession(session);
  ensure(object(command) && text(command.id) && ['draw', 'reset', 'acknowledge'].includes(command.type), 'INVALID_COMMAND');
  const duplicate = session.commands.find(receipt => receipt.id === command.id);
  if (duplicate) {
    ensure(duplicate.type === command.type && (command.type !== 'draw' || session.batches.find(batch => batch.id === duplicate.batchId)?.count === command.count)
      && (command.type !== 'acknowledge' || duplicate.batchId === command.batchId), 'COMMAND_ID_CONFLICT');
    return session;
  }
  ensure(integer(command.expectedRevision), 'INVALID_COMMAND');
  ensure(command.expectedRevision === session.revision, 'REVISION_CONFLICT');
  const at = time(now);
  const next = structuredClone(session);
  if (command.type === 'acknowledge') {
    ensure(text(command.batchId) && command.batchId === next.pendingBatchId, 'BATCH_NOT_PENDING');
    const batch = next.batches.find(batch => batch.id === command.batchId);
    ensure(batch && !batch.acknowledged, 'BATCH_NOT_PENDING');
    batch.acknowledged = true; next.pendingBatchId = null;
    next.commands.push({ id: command.id, type: command.type, batchId: batch.id });
  } else {
    ensure(next.pendingBatchId === null, 'PENDING_BATCH');
    if (command.type === 'reset') {
      closeRound(next, command.id, 'manual', at);
      next.commands.push({ id: command.id, type: command.type });
    } else {
      ensure([1, 10].includes(command.count), 'INVALID_DRAW_COUNT');
      const option = command.count === 1 ? next.snapshot.drawOptions.single : next.snapshot.drawOptions.ten;
      ensure(option.supported, 'MODE_UNSUPPORTED');
      const remaining = validateRemainingPool(next.activeRound);
      ensure(remaining >= command.count, 'INSUFFICIENT_REMAINING');
      // Safe counters are checked before requesting entropy.
      const roundDraws = plus(next.activeRound.drawCount, command.count); const roundCoins = plus(next.activeRound.coinCost, option.coinCost);
      const totalDraws = plus(next.totals.drawCount, command.count); const totalCoins = plus(next.totals.coinCost, option.coinCost);
      const drawn = drawFromPool(next.activeRound, command.count, { randomInt });
      const batch = { id: `${next.sessionId}:batch:${command.id}`, commandId: command.id,
        roundId: next.activeRound.id, roundNumber: next.activeRound.number, count: command.count, coinCost: option.coinCost,
        results: drawn.results, createdAt: at, acknowledged: false };
      Object.assign(next.activeRound, { remainingSpecialIds: drawn.remainingSpecialIds, remainingStandardCount: drawn.remainingStandardCount, drawCount: roundDraws, coinCost: roundCoins });
      next.batches.push(batch); next.pendingBatchId = batch.id;
      next.totals = { drawCount: totalDraws, coinCost: totalCoins };
      next.commands.push({ id: command.id, type: command.type, batchId: batch.id });
      if (validateRemainingPool(next.activeRound) === 0) closeRound(next, command.id, 'exhausted', at);
    }
  }
  next.revision = plus(next.revision, 1); next.updatedAt = at;
  validateSimulatorSession(next);
  return next;
}
