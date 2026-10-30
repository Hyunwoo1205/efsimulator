import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('anonymous artwork is the frozen 240x340 PNG, independent of future source card changes', () => {
  const file = new URL('../public/images/simulator/standard-card-170588-cdf8117dae82.png', import.meta.url);
  const bytes = readFileSync(file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'cdf8117dae82623d6408ad285a3c4cfae6b1c18703f896f044d585e52c29957c');
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16), 240);
  assert.equal(bytes.readUInt32BE(20), 340);
});
