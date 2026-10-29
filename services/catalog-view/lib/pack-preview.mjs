import { playerGrade, sortPlayers } from './catalog-order.mjs';

/**
 * Preview the three highest-OVR cards in the highest verified grade present.
 * Grade comes from each current API card; lower grades never fill empty places.
 * @template {{ id: string, playerType?: number, overallRating?: number | null }} T
 * @param {{ players?: T[] }} pack
 * @returns {T[]}
 */
export function selectPackPreview(pack) {
  const players = sortPlayers(Array.isArray(pack?.players) ? pack.players : []);
  if (!players.length) return [];
  const featuredRank = playerGrade(players[0]).rank;
  return players.filter(player => playerGrade(player).rank === featuredRank).slice(0, 3);
}
