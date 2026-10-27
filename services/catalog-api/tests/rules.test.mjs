import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeRules, verifyRuleLock, RULE_LOCK_PATH, assertApprovedMappings, mappingDigest, approvalDigest, loadMappingApprovals } from '../scripts/lifecycle/rules.mjs';

const root = new URL('../', import.meta.url);
const mapping = { saleId: 'synthetic-sale', packSlug: 'synthetic-pack', officialTitle: 'Synthetic official', newPlayersSection: 'Synthetic section', expectedEndsAt: '2026-11-02T01:59:59.000Z', expectedTotalPlayerCount: 150, expectedSpecialCount: 2, memberIds: ['0002', '0001'], matchEvidence: { source: 'synthetic fixture' } };
const approval = value => ({ schemaVersion: 1, reviews: [{ saleId: value.saleId, mappingSha256: mappingDigest(value), reviewId: 'synthetic-review', authority: 'test_fixture', evidenceRefs: ['synthetic source'] }] });

test('rule lock covers all mutation logic and fails closed for changed or missing rule files', async () => {
  const lock = JSON.parse(readFileSync(RULE_LOCK_PATH));
  const identity = await activeRules();
  assert.equal(identity.version, 'catalog-rules-1.1.0');
  assert.match(identity.sha256, /^[a-f0-9]{64}$/);
  const read = path => readFileSync(new URL(path, root));
  assert.deepEqual(verifyRuleLock(lock, read), identity);
  assert.throws(() => verifyRuleLock(lock, path => path === 'lib/catalog-contract.mjs' ? Buffer.from('changed rule') : read(path)), /changed without a reviewed version/);
  assert.throws(() => verifyRuleLock({ ...lock, files: lock.files.slice(1) }, read), /Incomplete locked rule file set/);
  assert.throws(() => verifyRuleLock({ ...lock, files: [...lock.files.slice(1), lock.files[1]] }, read), /Incomplete/);
});

test('only exact reviewed round/roster data passes; cosmetic key/roster order does not change review digest', () => {
  const document = { schemaVersion: 1, mappings: [mapping] };
  assert.doesNotThrow(() => assertApprovedMappings(document, approval(mapping)));
  const shuffled = Object.fromEntries(Object.entries(mapping).reverse()); shuffled.memberIds = [...mapping.memberIds].reverse();
  assert.equal(mappingDigest(shuffled), mappingDigest(mapping));
  assert.doesNotThrow(() => assertApprovedMappings({ ...document, mappings: [shuffled] }, approval(mapping)));
  for (const altered of [{ ...mapping, expectedTotalPlayerCount: 151 }, { ...mapping, officialTitle: 'Guessed match' }, { ...mapping, memberIds: ['0001', '0003'] }, { ...mapping, matchEvidence: { guessed: true } }]) {
    assert.throws(() => assertApprovedMappings({ ...document, mappings: [altered] }, approval(mapping)), /Unreviewed or changed/);
  }
  assert.throws(() => assertApprovedMappings({ schemaVersion: 2, mappings: [mapping] }, approval(mapping)), /schemaVersion/);
  assert.throws(() => assertApprovedMappings({ ...document, mappings: [mapping, mapping] }, approval(mapping)), /Duplicate/);
  assert.throws(() => assertApprovedMappings({ ...document, mappings: [{ ...mapping, guessedField: 1 }] }, approval(mapping)), /fields/);
  assert.throws(() => assertApprovedMappings({ ...document, mappings: [{ ...mapping, memberIds: [1, 2] }] }, approval(mapping)), /string card IDs/);
});

test('the retained review registry authorizes the current source mapping without inventing new relationships', () => {
  const registry = loadMappingApprovals();
  assert.equal(registry.reviews.length, 4);
  assert.equal(approvalDigest(registry), approvalDigest({ ...registry, reviews: [...registry.reviews].reverse() }));
  assert.throws(() => assertApprovedMappings({ schemaVersion: 1, mappings: [{ ...mapping, saleId: 'unreviewed-sale' }] }), /Unreviewed/);
});
