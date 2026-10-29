/** Source taxonomy codes are supplied per card by the current catalog API. */
const GRADES = new Map([[5, { rank: 0, label: 'Epic' }], [8, { rank: 1, label: 'Show Time' }], [3, { rank: 2, label: 'Trend' }], [6, { rank: 3, label: 'Highlight' }]]);
const UNKNOWN_GRADE = Object.freeze({ rank: 4, label: '등급 미확인' });

/** A containing pack never changes an individual card's source type. */
export function playerGrade(player) {
  return GRADES.get(player?.playerType) ?? UNKNOWN_GRADE;
}

/** The highest verified member grade identifies a mixed pack's display group. */
export function packGrade(pack) {
  const players = Array.isArray(pack?.players) ? pack.players : [];
  const grades = players.map(playerGrade).filter(grade => grade.rank < UNKNOWN_GRADE.rank);
  if (grades.length) return grades.reduce((best, grade) => grade.rank < best.rank ? grade : best);
  // Immutable pre-type publications may still be read during staged rollout.
  // A present but unrecognized code stays unknown, even under an Epic title.
  if (players.some(player => Object.hasOwn(player, 'playerType'))) return UNKNOWN_GRADE;
  for (const title of [pack?.officialTitle, pack?.name]) {
    if (typeof title !== 'string') continue;
    if (/^Epic\b/i.test(title)) return GRADES.get(5);
    if (/^Show\s*Time\b/i.test(title)) return GRADES.get(8);
    if (/^Trend(?:ing)?\b/i.test(title)) return GRADES.get(3);
    if (/^Highlight\b/i.test(title)) return GRADES.get(6);
  }
  return UNKNOWN_GRADE;
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
function rating(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }

/** @template {{ saleId: string, officialTitle?: string, name?: string, date?: string | null, players?: {playerType?:number}[] }} T
 * @param {T[]} packs
 * @returns {T[]}
 */
export function sortPacks(packs) {
  return [...packs].sort((a, b) => packGrade(a).rank - packGrade(b).rank || newestFirst(timestamp(a.date), timestamp(b.date)) || byId(a.saleId, b.saleId));
}

/** First confirmed release of each exact card, across live and archived packs.
 * Reappearance in a later pack does not turn an existing card into a new release.
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

/** @template {{ id: string, playerType?: number, overallRating?: number | null }} T
 * @param {T[]} players
 * @returns {T[]}
 */
export function sortPlayers(players) {
  return [...players].sort((a, b) => playerGrade(a).rank - playerGrade(b).rank || newestFirst(rating(a.overallRating), rating(b.overallRating)) || byId(a.id, b.id));
}

/** Global search groups source grades, then shows newest cards before OVR ties.
 * Pack rosters and previews use sortPlayers instead: their release date is shared.
 * @template {{ id: string, playerType?: number, overallRating?: number | null }} T
 * @param {T[]} players
 * @param {{ date?: string | null, players: { id: string }[] }[]} packs
 * @returns {T[]}
 */
export function sortGlobalPlayers(players, packs) {
  const dates = playerDates(packs);
  return [...players].sort((a, b) => playerGrade(a).rank - playerGrade(b).rank
    || newestFirst(dates.get(a.id) ?? null, dates.get(b.id) ?? null)
    || newestFirst(rating(a.overallRating), rating(b.overallRating))
    || byId(a.id, b.id));
}

/** Preserve pack-local OVR order while global players use release date then OVR.
 * @template {{ id: string, playerType?: number, overallRating?: number | null }} Player
 * @template {{ saleId: string, officialTitle?: string, name?: string, date?: string | null, players: Player[] }} Pack
 * @template {{ live: Pack[], archive: Pack[], players: Player[] }} Catalog
 * @param {Catalog} catalog
 */
export function orderCatalog(catalog) {
  const orderPacks = packs => sortPacks(packs).map(pack => ({ ...pack, players: sortPlayers(pack.players) }));
  return { ...catalog, live: orderPacks(catalog.live), archive: orderPacks(catalog.archive), players: sortGlobalPlayers(catalog.players, [...catalog.live, ...catalog.archive]) };
}
