const UINT32_RANGE = 2 ** 32;
const UINT53_RANGE = 2 ** 53;
const MAX_ATTEMPTS = 128;

function failure(code, message, Constructor = Error) {
  const error = new Constructor(message);
  error.code = code;
  return error;
}

/**
 * Create an unbiased integer sampler with an injected Web Crypto-compatible
 * getRandomValues callback. Rejection is bounded so a failed source cannot hang
 * a storage transaction; exhaustion fails instead of falling back or using a
 * biased modulo result. The callback is expected to fill the supplied array.
 * @param {(array: Uint32Array) => Uint32Array} getRandomValues
 */
export function createSecureRandomInt(getRandomValues) {
  if (typeof getRandomValues !== 'function') throw failure('random_unavailable', 'Secure randomness is unavailable');
  return function randomInt(max) {
    if (!Number.isSafeInteger(max) || max < 1) throw failure('invalid_random_bound', 'Random bound must be a positive safe integer', RangeError);
    if (max === 1) return 0;
    const wide = max > UINT32_RANGE;
    const range = wide ? UINT53_RANGE : UINT32_RANGE;
    const limit = Math.floor(range / max) * max;
    const words = new Uint32Array(wide ? 2 : 1);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try { getRandomValues(words); } catch { throw failure('random_source_failed', 'Secure randomness failed'); }
      const value = wide ? (words[0] & 0x1fffff) * UINT32_RANGE + words[1] : words[0];
      if (value < limit) return value % max;
    }
    throw failure('random_rejection_limit', 'Secure randomness could not produce a usable sample');
  };
}

/** Uniform integer in [0,max), using browser Web Crypto without a fallback. */
export function secureRandomInt(max) {
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.getRandomValues !== 'function') throw failure('random_unavailable', 'Secure randomness is unavailable');
  return createSecureRandomInt(array => crypto.getRandomValues(array))(max);
}
