import metadata from './preview-player-types.json' with { type: 'json' };

/** Only exact card taxonomy identifies Epic/Show Time, not the containing pack. */
function playerGroup(player, registry) {
  const type = Object.hasOwn(registry.playerTypes, player.id) ? registry.playerTypes[player.id] : null;
  return type === 5 || type === 8 ? 0 : 1;
}

function packGroup(pack) {
  return [pack.officialTitle, pack.name].some(title => typeof title === 'string' && /^(?:Epic|Show\s*Time)\b/i.test(title)) ? 0 : 1;
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const result = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(result) && new Date(result).toISOString().slice(0, 10) === value ? result : null;
}

function newestFirst(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function byId(a, b) { return a === b ? 0 : a < b ? -1 : 1; }

/** @template {{ saleId: string, officialTitle?: string, name?: string, date?: string | null }} T
 * @param {T[]} packs
 * @returns {T[]}
 */
export function sortPacks(packs) {
  return [...packs].sort((a, b) => packGroup(a) - packGroup(b) || newestFirst(timestamp(a.date), timestamp(b.date)) || byId(a.saleId, b.saleId));
}

/** Earliest known linked pack date avoids making a reused card new on reissue.
 * This is a display ordering key, not a verified first-ever card release date.
 * @param {{ date?: string | null, players: { id: string }[] }[]} packs
 * @returns {Map<string, number>}
 */
export function playerDates(packs) {
  const dates = new Map();
  for (const pack of packs) {
    const date = timestamp(pack.date);
    if (date === null) continue;
    for (const player of pack.players) {
      const existing = dates.get(player.id);
      if (existing === undefined || date < existing) dates.set(player.id, date);
    }
  }
  return dates;
}

/** @template {{ id: string }} T
 * @param {T[]} players
 * @param {Map<string, number>} dates
 * @param {{ playerTypes: Record<string, number | null> }} registry
 * @returns {T[]}
 */
export function sortPlayers(players, dates, registry = metadata) {
  return [...players].sort((a, b) => playerGroup(a, registry) - playerGroup(b, registry) || newestFirst(dates.get(a.id) ?? null, dates.get(b.id) ?? null) || byId(a.id, b.id));
}

/** All screens consume the same ordering; API payloads remain unchanged.
 * @template {{ id: string }} Player
 * @template {{ saleId: string, officialTitle?: string, name?: string, date?: string | null, players: Player[] }} Pack
 * @template {{ live: Pack[], archive: Pack[], players: Player[] }} Catalog
 * @param {Catalog} catalog
 * @param {{ playerTypes: Record<string, number | null> }} registry
 */
export function orderCatalog(catalog, registry = metadata) {
  const dates = playerDates([...catalog.live, ...catalog.archive]);
  const orderPacks = packs => sortPacks(packs).map(pack => ({ ...pack, players: sortPlayers(pack.players, dates, registry) }));
  return { ...catalog, live: orderPacks(catalog.live), archive: orderPacks(catalog.archive), players: sortPlayers(catalog.players, dates, registry) };
}
