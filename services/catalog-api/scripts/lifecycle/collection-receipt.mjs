import { createHash } from 'node:crypto';
import { canonical } from '../../lib/catalog-contract.mjs';
import { validateHtmlSourceUrl } from './html-sources.mjs';
import { activeRules, assertApprovedMappings } from './rules.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(`Collection receipt: ${message}`); };
const assert = (value, message) => { if (!value) fail(message); };
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const iso = value => typeof value === 'string' && /Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/** Existing raw array order is significant; object key order is not. */
export const baselineFingerprint = (rawPlayers, rawPacks) => digest(canonical({ rawPlayers, rawPacks }));
export function receiptResultHash(result) {
  const { receipt: _receipt, ...value } = result;
  return digest(canonical(value));
}
export function makeCollectionReceipt({ checkedAt, rulesIdentity, mappingsDocument, rawPlayers, rawPacks, maxRequests, requests, resultSha256 }) {
  return structuredClone({ schemaVersion: 1, checkedAt, rulesIdentity, mappingsDocument,
    baselineSha256: baselineFingerprint(rawPlayers, rawPacks), maxRequests, requests, resultSha256 });
}

/**
 * Recompute facts from preserved HTML, not caller-authored verification flags.
 * This is an integrity/reproducibility receipt, not a signature by the source site.
 * Approval and rules identities come from the workspace's separately pinned policy.
 */
export async function replayCollectionReceipt({ receipt, rawPlayers, rawPacks, now, approval, rulesIdentity: expectedRules } = {}) {
  assert(exact(receipt, ['schemaVersion', 'checkedAt', 'rulesIdentity', 'mappingsDocument', 'baselineSha256', 'maxRequests', 'requests', 'resultSha256']) && receipt.schemaVersion === 1, 'unsupported schema');
  assert(iso(receipt.checkedAt) && typeof now === 'string' && Number.isFinite(Date.parse(now)) && new Date(now).toISOString() === receipt.checkedAt, 'execution clock differs');
  const rules = await activeRules();
  assert(canonical(receipt.rulesIdentity) === canonical(rules), 'rules identity differs');
  if (expectedRules) assert(canonical(expectedRules) === canonical(rules), 'workspace rules identity differs');
  assertApprovedMappings(receipt.mappingsDocument, approval);
  assert(hex(receipt.baselineSha256) && receipt.baselineSha256 === baselineFingerprint(rawPlayers, rawPacks), 'raw baseline differs');
  assert(Number.isSafeInteger(receipt.maxRequests) && receipt.maxRequests >= 2 && receipt.maxRequests <= 30, 'invalid request budget');
  assert(Array.isArray(receipt.requests) && receipt.requests.length <= receipt.maxRequests && hex(receipt.resultSha256), 'invalid request/result envelope');
  const urls = new Set();
  for (const request of receipt.requests) {
    assert(exact(request, request?.snapshot ? ['url', 'snapshot'] : ['url', 'error']), 'invalid request shape');
    validateHtmlSourceUrl(request.url);
    assert(!urls.has(request.url), 'duplicate source URL'); urls.add(request.url);
    if (request.snapshot) {
      const snapshot = request.snapshot;
      assert(exact(snapshot, ['source_url', 'observed_at', 'status', 'complete', 'bytes', 'sha256', 'html']), 'invalid snapshot shape');
      assert(snapshot.source_url === request.url && snapshot.status === 200 && snapshot.complete === true && iso(snapshot.observed_at), 'invalid snapshot metadata');
      assert(typeof snapshot.html === 'string' && Buffer.byteLength(snapshot.html) <= 8 * 1024 * 1024 && snapshot.bytes === Buffer.byteLength(snapshot.html) && hex(snapshot.sha256) && digest(snapshot.html) === snapshot.sha256, 'HTML bytes/hash differ');
      // Future/stale evidence cannot become fresh merely by editing checkedAt.
      const age = Date.parse(receipt.checkedAt) - Date.parse(snapshot.observed_at);
      assert(age >= -60_000 && age <= 2 * 60 * 60 * 1000, 'snapshot timestamp is stale');
    } else {
      const error = request.error;
      assert(exact(error, ['code', 'message', 'status', 'observed_at']) && typeof error.code === 'string' && error.code && typeof error.message === 'string' && iso(error.observed_at), 'invalid error metadata');
      assert(error.status === null || Number.isSafeInteger(error.status) && error.status >= 100 && error.status <= 599, 'invalid error status');
    }
  }
  let cursor = 0;
  const fetchHtml = async url => {
    const request = receipt.requests[cursor++];
    assert(request && request.url === url, 'recorded request order differs or evidence missing');
    if (request.error) throw Object.assign(new Error(request.error.message), request.error);
    return structuredClone(request.snapshot);
  };
  const { collectCycle } = await import('./collect-cycle.mjs');
  const replay = await collectCycle({ mappings: receipt.mappingsDocument.mappings, mappingsDocument: receipt.mappingsDocument,
    rawPlayers, rawPacks, now: () => new Date(receipt.checkedAt), maxRequests: receipt.maxRequests, rulesIdentity: rules, fetchHtml });
  assert(cursor === receipt.requests.length, 'unused source evidence');
  assert(receiptResultHash(replay) === receipt.resultSha256, 'recomputed result differs');
  return replay;
}
