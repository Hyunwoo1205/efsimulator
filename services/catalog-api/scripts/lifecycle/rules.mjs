import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, compareText } from '../../lib/catalog-contract.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const RULE_LOCK_PATH = resolve(ROOT, 'policy/rules.lock.json');
export const RULE_FILES = Object.freeze(['lib/catalog-contract.mjs', 'lib/catalog-lifecycle.mjs', 'lib/catalog-api.mjs', 'scripts/lifecycle/rules.mjs', 'scripts/lifecycle/collect-cycle.mjs', 'scripts/lifecycle/collection-receipt.mjs', 'scripts/lifecycle/html-sources.mjs', 'scripts/lifecycle/workspace.mjs', 'scripts/lifecycle/run-cycle.mjs', 'scripts/lifecycle/publication.mjs', 'scripts/lifecycle/reviewed-cache.mjs', 'policy/approved-mappings.json']);
const APPROVALS_PATH = resolve(ROOT, 'policy/approved-mappings.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const requireValue = (value, message) => { if (!value) throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);

// IDs are decimal strings, sorted lexically, never converted to Number.
export function mappingDigest(mapping) {
  const normalized = structuredClone(mapping);
  if (Array.isArray(normalized.memberIds)) normalized.memberIds.sort(compareText);
  return sha(canonical(normalized));
}
export function mappingsDigest(document) {
  return sha(canonical(document.mappings.map(mapping => [mapping.saleId, mappingDigest(mapping)]).sort(([a], [b]) => compareText(a, b))));
}
export function validateApprovalRegistry(approval) {
  requireValue(object(approval) && approval.schemaVersion === 1 && Array.isArray(approval.reviews) && Object.keys(approval).every(key => ['schemaVersion', 'reviews'].includes(key)), 'Invalid mapping approval registry');
  const ids = new Set();
  for (const review of approval.reviews) {
    requireValue(object(review) && Object.keys(review).sort().join(',') === 'authority,evidenceRefs,mappingSha256,reviewId,saleId', 'Invalid mapping review fields');
    requireValue(['saleId', 'reviewId', 'authority'].every(key => nonempty(review[key])) && /^[a-f0-9]{64}$/.test(review.mappingSha256), 'Invalid mapping review identity');
    requireValue(!ids.has(review.saleId), 'Duplicate mapping review'); ids.add(review.saleId);
    requireValue(Array.isArray(review.evidenceRefs) && review.evidenceRefs.length > 0 && review.evidenceRefs.every(nonempty), 'Mapping review needs explicit evidence references');
  }
  return approval;
}
export const approvalDigest = approval => sha(canonical({ ...validateApprovalRegistry(approval), reviews: approval.reviews.map(review => ({ ...review, evidenceRefs: [...review.evidenceRefs].sort(compareText) })).sort((a, b) => compareText(a.saleId, b.saleId)) }));
export const loadMappingApprovals = () => validateApprovalRegistry(JSON.parse(readFileSync(APPROVALS_PATH, 'utf8')));

export function assertApprovedMappings(document, approval = loadMappingApprovals()) {
  validateApprovalRegistry(approval);
  requireValue(object(document) && document.schemaVersion === 1 && Array.isArray(document.mappings), 'Mappings must use schemaVersion 1');
  requireValue(Object.keys(document).every(key => ['schemaVersion', 'mappings', 'pendingOfficialTitles', 'policy'].includes(key)), 'Unknown mapping document field');
  const reviewMap = new Map(approval.reviews.map(review => [review.saleId, review]));
  const ids = new Set(); const slugs = new Set();
  for (const mapping of document.mappings) {
    requireValue(object(mapping) && nonempty(mapping.saleId) && nonempty(mapping.packSlug), 'Mapping identity is required');
    const fields = ['saleId', 'packSlug', 'officialTitle', 'newPlayersSection', 'expectedEndsAt', 'expectedTotalPlayerCount', 'expectedSpecialCount', 'memberIds', 'matchEvidence'];
    requireValue(fields.every(key => Object.hasOwn(mapping, key)) && Object.keys(mapping).every(key => fields.includes(key) || key === 'countCorrection'), 'Invalid reviewed mapping fields');
    requireValue(/^[a-z\d-]+$/.test(mapping.packSlug) && ['officialTitle', 'newPlayersSection'].every(key => nonempty(mapping[key])), 'Invalid reviewed mapping names');
    requireValue(typeof mapping.expectedEndsAt === 'string' && /Z$/.test(mapping.expectedEndsAt) && Number.isFinite(Date.parse(mapping.expectedEndsAt)), 'Reviewed end must be UTC');
    requireValue(['expectedTotalPlayerCount', 'expectedSpecialCount'].every(key => Number.isSafeInteger(mapping[key]) && mapping[key] > 0) && mapping.expectedSpecialCount <= mapping.expectedTotalPlayerCount, 'Invalid reviewed mapping counts');
    requireValue(Array.isArray(mapping.memberIds) && mapping.memberIds.length === mapping.expectedSpecialCount && mapping.memberIds.every(id => typeof id === 'string' && /^\d+$/.test(id)) && new Set(mapping.memberIds).size === mapping.memberIds.length, 'Reviewed mapping needs complete unique string card IDs');
    requireValue(object(mapping.matchEvidence) && Object.keys(mapping.matchEvidence).length > 0, 'Reviewed mapping needs source evidence');
    if (mapping.countCorrection !== undefined) requireValue(object(mapping.countCorrection) && mapping.countCorrection.status === 'user_confirmed' && nonempty(mapping.countCorrection.reason) && mapping.countCorrection.effectiveCount === mapping.expectedSpecialCount && Object.keys(mapping.countCorrection).every(key => ['status', 'reason', 'effectiveCount'].includes(key)), 'Invalid reviewed count correction');
    requireValue(!ids.has(mapping.saleId) && !slugs.has(mapping.packSlug), 'Duplicate or conflicting sale/pack mapping');
    ids.add(mapping.saleId); slugs.add(mapping.packSlug);
    const review = reviewMap.get(mapping.saleId);
    requireValue(review && review.mappingSha256 === mappingDigest(mapping), `Unreviewed or changed mapping: ${mapping.saleId}`);
  }
  return document;
}

/** Read-only check: a routine cycle can never rewrite the rule lock. */
export async function activeRules() {
  return verifyRuleLock(JSON.parse(readFileSync(RULE_LOCK_PATH, 'utf8')), path => readFileSync(resolve(ROOT, path)));
}
export function verifyRuleLock(lock, readBytes) {
  requireValue(lock.schemaVersion === 1 && nonempty(lock.version) && Array.isArray(lock.files) && lock.files.length > 0, 'Invalid rule lock');
  requireValue(lock.files.length === RULE_FILES.length && canonical(lock.files.map(entry => entry.path).sort(compareText)) === canonical([...RULE_FILES].sort(compareText)), 'Incomplete locked rule file set');
  const seen = new Set();
  for (const entry of lock.files) {
    requireValue(object(entry) && typeof entry.path === 'string' && /^[a-zA-Z0-9_./-]+$/.test(entry.path) && !entry.path.startsWith('/') && !entry.path.split('/').includes('..') && !seen.has(entry.path) && /^[a-f0-9]{64}$/.test(entry.sha256), 'Invalid locked rule path');
    seen.add(entry.path);
    requireValue(sha(readBytes(entry.path)) === entry.sha256, `Rules changed without a reviewed version: ${entry.path}`);
  }
  return { version: lock.version, sha256: sha(canonical(lock)) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).join(' ') !== 'check') throw new Error('Usage: node scripts/lifecycle/rules.mjs check');
  console.log(JSON.stringify({ rules: await activeRules(), mappings: 'review-registry-loaded', reviewCount: loadMappingApprovals().reviews.length }));
}
