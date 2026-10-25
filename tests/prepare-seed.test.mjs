import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { importCatalog } from '../scripts/catalog.mjs';

test('실제 조사 표본을 재현하고 새 관측 ID로 재수입해도 카드 ID와 과거 근거를 보존한다', t => {
  const root = mkdtempSync(join(tmpdir(), 'efsimulator-seed-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'data/research'), { recursive: true });
  for (const path of ['scripts/prepare-seed.mjs', 'scripts/catalog.mjs', 'scripts/collected-products.mjs', 'scripts/collect-efhub.mjs', 'data/research/source-observations.json']) {
    copyFileSync(new URL(`../${path}`, import.meta.url), join(root, path));
  }
  const prepare = () => {
    execFileSync(process.execPath, [join(root, 'scripts/prepare-seed.mjs')], { stdio: 'pipe' });
    return JSON.parse(readFileSync(join(root, 'data/catalog.seed.json'), 'utf8'));
  };
  const before = prepare();
  assert.deepEqual(prepare(), before, '같은 원본은 같은 ID·값으로 재현된다');
  assert.equal(before.coverage.complete, false);
  assert.equal(before.products[0].total_player_count, null);
  assert.equal(before.products[0].entries.some(entry => entry.kind === 'manager'), false);
  assert.ok(before.cards.every(card => card.external_ids.every(id => typeof id.value === 'string')));
  assert.equal(JSON.stringify(before).includes('"$undefined"'), false);
  const evidencePath = join(root, 'data/research/source-observations.json');
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const observation = evidence.observations.find(item => item.id === 'efhub_player_payload');
  observation.observed_at = '2026-10-26T03:00:00Z';
  observation.sha256 = 'b'.repeat(64);
  observation.verified_fields.card.overallRating += 1;
  evidence.observed_at = observation.observed_at;
  writeFileSync(evidencePath, JSON.stringify(evidence));
  const after = prepare();
  assert.deepEqual(after.cards.map(card => card.id), before.cards.map(card => card.id));
  const baseCard = before.cards.find(card => card.other_version_ids.length === 3);
  const nextCard = after.cards.find(card => card.id === baseCard.id);
  assert.notEqual(baseCard.provenance.overall, nextCard.provenance.overall);
  const dbPath = join(root, 'catalog.sqlite');
  importCatalog(before, { dbPath });
  assert.doesNotThrow(() => importCatalog(after, { dbPath }));
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM revisions WHERE entity_id=?').get(baseCard.id).n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM observations WHERE id IN (?,?)').get(baseCard.provenance.overall, nextCard.provenance.overall).n, 2);
  } finally { db.close(); }
});
