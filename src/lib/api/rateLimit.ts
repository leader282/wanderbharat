export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export interface SlidingWindowRateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  nowMs?: () => number;
}

export function createSlidingWindowRateLimiter(
  options: SlidingWindowRateLimiterOptions,
) {
  const hitsByKey = new Map<string, number[]>();

  return (key: string): RateLimitDecision => {
    const nowMs = options.nowMs?.() ?? Date.now();
    const windowStartMs = nowMs - options.windowMs;
    const recentHits = (hitsByKey.get(key) ?? []).filter(
      (timestamp) => timestamp >= windowStartMs,
    );

    if (recentHits.length >= options.maxRequests) {
      const retryAfterMs = Math.max(
        options.windowMs - (nowMs - recentHits[0]),
        1_000,
      );
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1_000),
      };
    }

    recentHits.push(nowMs);
    hitsByKey.set(key, recentHits);
    trimExpiredEntries(hitsByKey, windowStartMs);
    return { allowed: true };
  };
}

export function getClientIpAddress(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();

  return "unknown";
}

function trimExpiredEntries(
  hitsByKey: Map<string, number[]>,
  windowStartMs: number,
): void {
  for (const [key, timestamps] of hitsByKey.entries()) {
    const recent = timestamps.filter((timestamp) => timestamp >= windowStartMs);
    if (recent.length === 0) {
      hitsByKey.delete(key);
      continue;
    }
    hitsByKey.set(key, recent);
  }
}
