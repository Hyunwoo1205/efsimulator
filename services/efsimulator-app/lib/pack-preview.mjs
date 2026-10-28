import previewTypes from './preview-player-types.json' with { type: 'json' };

/**
 * Preview ordering is display-only. Card names and OVR never identify a grade.
 * @template {{ id: string }} T
 * @param {{ officialTitle?: string, name?: string, players?: T[] }} pack
 * @param {{ playerTypes: Record<string, number | null> }} registry
 * @returns {T[]}
 */
export function selectPackPreview(pack, registry = previewTypes) {
  const players = Array.isArray(pack?.players) ? pack.players : [];
  let targetType = null;
  for (const title of [pack?.officialTitle, pack?.name]) {
    if (typeof title !== 'string') continue;
    if (/^Epic\b/i.test(title)) { targetType = 5; break; }
    if (/^Show\s*Time\b/i.test(title)) { targetType = 8; break; }
  }
  if (targetType !== null) {
    const matching = players.filter(player => typeof player?.id === 'string' && Object.hasOwn(registry.playerTypes, player.id) && registry.playerTypes[player.id] === targetType);
    if (matching.length) return matching.slice(0, 3);
  }
  return players.slice(0, 3);
}
