import { isIP } from "node:net";

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
  const directProxyIp =
    readIpHeader(request, "x-real-ip") ??
    readIpHeader(request, "cf-connecting-ip") ??
    readIpHeader(request, "true-client-ip");
  if (directProxyIp) return directProxyIp;

  const forwardedFor = request.headers.get("x-forwarded-for") ?? "";
  const forwardedChain = forwardedFor
    .split(",")
    .map((entry) => normaliseIpAddress(entry))
    .filter((entry): entry is string => entry !== null);
  if (forwardedChain.length > 0) {
    // X-Forwarded-For is ordered client, proxy1, proxy2. The first valid entry
    // is the client address when the header was set by the platform proxy.
    return forwardedChain[0];
  }

  return "unknown";
}

function readIpHeader(request: Request, header: string): string | null {
  return normaliseIpAddress(request.headers.get(header));
}

function normaliseIpAddress(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") return null;
  return isIP(trimmed) ? trimmed : null;
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
