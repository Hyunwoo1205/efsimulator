import { sortPlayers } from '../catalog-order.mjs';

/** @typedef {{ kind: 'special', cardId: string } | { kind: 'standard' }} SimulatorResult */

/**
 * Present a committed batch in the same grade/OVR order as a pack roster.
 * Acquisition indexes and result references remain intact; callers must not
 * write this display order back into the session's acquisition ledger.
 * Anonymous Standards have no invented grade, OVR or player identity.
 * @template {{ id: string, playerType?: number, overallRating?: number | null }} Player
 * @param {SimulatorResult[]} results
 * @param {Player[]} players
 * @returns {{ result: SimulatorResult, player: Player | undefined, acquisitionIndex: number }[]}
 */
export function orderSimulatorResults(results, players) {
  const byId = new Map(players.map(player => [player.id, player]));
  const ranks = new Map(sortPlayers(players).map((player, index) => [player.id, index]));
  return results.map((result, acquisitionIndex) => ({
    result,
    player: result.kind === 'special' ? byId.get(result.cardId) : undefined,
    acquisitionIndex,
  })).sort((a, b) => {
    if (a.result.kind !== b.result.kind) return a.result.kind === 'standard' ? 1 : -1;
    if (a.result.kind === 'standard' || b.result.kind === 'standard') return a.acquisitionIndex - b.acquisitionIndex;
    // Missing display metadata must not erase a committed special result or
    // turn it into an anonymous Standard. Keep it after resolvable specials.
    const rank = (ranks.get(a.result.cardId) ?? Infinity) - (ranks.get(b.result.cardId) ?? Infinity);
    if (rank) return rank;
    if (a.result.cardId !== b.result.cardId) return a.result.cardId < b.result.cardId ? -1 : 1;
    return a.acquisitionIndex - b.acquisitionIndex;
  });
}
