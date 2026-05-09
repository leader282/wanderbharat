export interface SeededRng {
  nextFloat(): number;
  int(minInclusive: number, maxInclusive: number): number;
  boolean(probability?: number): boolean;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
}

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const UINT32_MAX_PLUS_ONE = 0x1_0000_0000;
const DEFAULT_BOOLEAN_PROBABILITY = 0.5;

/**
 * Derives a stable, human-readable child seed from a parent seed and case id.
 */
export function deriveSeed(parentSeed: string, caseIndex: number): string {
  if (!Number.isInteger(caseIndex)) {
    throw new RangeError(`caseIndex must be an integer. Received: ${caseIndex}`);
  }

  const normalizedParent = parentSeed.trim().length > 0 ? parentSeed : "seed";
  const hash = hashSeed(`${normalizedParent}::${caseIndex}`);
  return `${normalizedParent}::case:${caseIndex}::${hash
    .toString(16)
    .padStart(8, "0")}`;
}

/**
 * Zero-dependency deterministic PRNG seeded from a string.
 */
export function createSeededRng(seed: string): SeededRng {
  let state = hashSeed(seed);
  if (state === 0) {
    state = 0x6d2b79f5;
  }

  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };

  const nextFloat = (): number => nextUint32() / UINT32_MAX_PLUS_ONE;

  const nextIntInclusive = (minInclusive: number, maxInclusive: number): number => {
    if (!Number.isFinite(minInclusive) || !Number.isFinite(maxInclusive)) {
      throw new RangeError("int() bounds must be finite numbers.");
    }

    const min = Math.ceil(minInclusive);
    const max = Math.floor(maxInclusive);
    if (max < min) {
      throw new RangeError(
        `int() expected min <= max. Received min=${minInclusive}, max=${maxInclusive}.`,
      );
    }

    const span = max - min + 1;
    if (!Number.isSafeInteger(span) || span <= 0) {
      throw new RangeError(`int() span is invalid or too large: ${span}.`);
    }

    return min + Math.floor(nextFloat() * span);
  };

  const nextBoolean = (probability = DEFAULT_BOOLEAN_PROBABILITY): boolean => {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new RangeError(
        `boolean() probability must be within [0, 1]. Received: ${probability}`,
      );
    }
    if (probability <= 0) return false;
    if (probability >= 1) return true;
    return nextFloat() < probability;
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new RangeError("pick() expected at least one item.");
    }
    return items[nextIntInclusive(0, items.length - 1)] as T;
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = nextIntInclusive(0, i);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  };

  return {
    nextFloat,
    int: nextIntInclusive,
    boolean: nextBoolean,
    pick,
    shuffle,
  };
}

function hashSeed(seed: string): number {
  let hash = FNV_OFFSET_BASIS_32;
  const normalized = seed.length > 0 ? seed : "__empty_seed__";
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME_32);
  }
  return hash >>> 0;
}
