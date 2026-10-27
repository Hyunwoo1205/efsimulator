/** Development-only monorepo generator. The deployed UI reads only its JSON output. */
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function buildPreviewTypes({ loaded, taxonomyDocument, publicationVersion }) {
  requireValue(isHash(publicationVersion), 'A verified publication version is required.');
  const observation = taxonomyDocument?.observations?.find(item => item.id === 'efhub_types_js');
  const types = observation?.verified_fields?.raw_player_type_translation_keys;
  requireValue(observation?.status === 200 && isHash(observation.sha256), 'The retained EFHub taxonomy observation is missing.');
  requireValue(types?.['5'] === 'epic' && types?.['6'] === 'highlight' && types?.['8'] === 'showtime', 'EFHub preview grade taxonomy differs from the verified mapping.');
  const rawEntry = loaded?.manifest?.files?.find(entry => entry.path === 'raw/players_raw.json');
  requireValue(isHash(rawEntry?.sha256), 'Verified raw player checksum is required.');
  requireValue(Array.isArray(loaded?.rawPlayers) && Array.isArray(loaded?.state?.players), 'A validated catalog workspace is required.');
  const raw = new Map(loaded.rawPlayers.map(player => [player.id, player]));
  const ids = loaded.state.players.map(player => player.id).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  requireValue(ids.every(id => typeof id === 'string' && /^\d+$/.test(id)) && new Set(ids).size === ids.length, 'Approved card IDs must be unique decimal strings.');
  const playerTypes = {};
  for (const id of ids) {
    requireValue(raw.has(id), 'An approved card is missing from validated raw data.');
    const playerType = raw.get(id).playerType;
    playerTypes[id] = Number.isSafeInteger(playerType) && Object.hasOwn(types, String(playerType)) ? playerType : null;
  }
  return {
    schemaVersion: 1,
    source: { rawPlayersSha256: rawEntry.sha256, publicationVersion, taxonomyObservationId: 'efhub_types_js', taxonomySha256: observation.sha256 },
    playerTypes,
  };
}

async function main() {
  const args = process.argv.slice(2);
  requireValue(args.length === 2 && args[0] === '--root' && isAbsolute(args[1]), 'Usage: node scripts/prepare-preview-types.mjs --root ABSOLUTE_CATALOG_RUNTIME');
  // Reuse the fixed loader: it authenticates CURRENT, every generation file,
  // raw history, processed relationships and pinned rule bindings before use.
  const [{ loadWorkspace }, { generatePublication }] = await Promise.all([
    import('../../catalog-api/scripts/lifecycle/workspace.mjs'),
    import('../../catalog-api/scripts/lifecycle/publication.mjs'),
  ]);
  const loaded = await loadWorkspace(resolve(args[1]));
  const taxonomyDocument = JSON.parse(await readFile(new URL('../../../data/research/source-observations.json', import.meta.url), 'utf8'));
  const publication = generatePublication({ state: loaded.state, createdAt: loaded.current.updatedAt });
  const metadata = buildPreviewTypes({ loaded, taxonomyDocument, publicationVersion: publication.versionId });
  await writeFile(new URL('../lib/preview-player-types.json', import.meta.url), JSON.stringify(metadata, null, 2) + '\n');
  console.log(JSON.stringify({ cards: Object.keys(metadata.playerTypes).length, source: metadata.source }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
