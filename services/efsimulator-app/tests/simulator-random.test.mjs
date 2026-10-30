import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecureRandomInt, secureRandomInt } from '../lib/simulator/random.mjs';

function source(samples) {
  let calls = 0;
  const randomInt = createSecureRandomInt(array => {
    assert.ok(calls < samples.length, 'deterministic random samples exhausted');
    const sample = samples[calls++];
    assert.equal(array.length, sample.length);
    array.set(sample);
    return array;
  });
  return { randomInt, calls: () => calls };
}

test('32-bit rejection sampling discards the modulo tail and includes exact acceptance boundary', () => {
  const rejected = source([[0xffffffff], [4294967290], [4294967289]]);
  assert.equal(rejected.randomInt(10), 9);
  assert.equal(rejected.calls(), 3);
  const lower = source([[0], [1], [9]]);
  assert.deepEqual([lower.randomInt(10), lower.randomInt(10), lower.randomInt(10)], [0, 1, 9]);
});

test('power-of-two bounds use the entire 32-bit domain without modulo tail', () => {
  const full = source([[0xffffffff]]);
  assert.equal(full.randomInt(2 ** 32), 0xffffffff);
  const half = source([[0xffffffff]]);
  assert.equal(half.randomInt(2 ** 31), 2 ** 31 - 1);
});

test('53-bit sampling preserves safe integer precision and rejects the upper tail', () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  const sampled = source([[0x1fffff, 0xffffffff], [0x1fffff, 0xfffffffe]]);
  assert.equal(sampled.randomInt(maximum), maximum - 1);
  assert.equal(sampled.calls(), 2);
  const maskedHigh = source([[0xffe00001, 7]]);
  assert.equal(maskedHigh.randomInt(2 ** 32 + 10), 2 ** 32 + 7);
});

test('small pools cover every index equally across a complete accepted cycle', () => {
  const sampled = source(Array.from({ length: 300 }, (_, index) => [index]));
  const hits = Array(150).fill(0);
  for (let index = 0; index < 300; index++) hits[sampled.randomInt(150)]++;
  assert.ok(hits.every(count => count === 2));
});

test('invalid bounds fail before invoking the random source; one has a known zero result', () => {
  let calls = 0;
  const randomInt = createSecureRandomInt(array => { calls++; return array; });
  for (const value of [0, -1, 1.5, '10', null, undefined, NaN, Infinity, 2 ** 53]) {
    assert.throws(() => randomInt(value), error => error instanceof RangeError && error.code === 'invalid_random_bound');
  }
  assert.equal(randomInt(1), 0);
  assert.equal(calls, 0);
});

test('unavailable and failed random sources fail with fixed codes without leaking source errors', () => {
  assert.throws(() => createSecureRandomInt(null), { code: 'random_unavailable' });
  const randomInt = createSecureRandomInt(() => { throw new Error('private source message'); });
  assert.throws(() => randomInt(150), error => error.code === 'random_source_failed' && !error.message.includes('private source'));
});

test('a permanently rejecting source fails within a bounded number of attempts', () => {
  let calls = 0;
  const randomInt = createSecureRandomInt(array => { calls++; array.fill(0xffffffff); return array; });
  assert.throws(() => randomInt(10), { code: 'random_rejection_limit' });
  assert.equal(calls, 128);
});

test('the platform secure sampler stays within the requested integer range', () => {
  for (const max of [1, 11, 150, 2 ** 32, Number.MAX_SAFE_INTEGER]) {
    const value = secureRandomInt(max);
    assert.ok(Number.isSafeInteger(value) && value >= 0 && value < max);
  }
});
