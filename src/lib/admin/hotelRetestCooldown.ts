import type {
  HotelOfferSnapshot,
  ProviderCallLog,
} from "@/lib/providers/hotels/types";
import {
  LITEAPI_HOTEL_RATES_ENDPOINT,
  normaliseProviderEndpointPath,
} from "@/lib/providers/hotels/liteApiEndpoints";

export const LITEAPI_RETEST_COOLDOWN_MS = 90_000;

export function findRecentLiteApiRatesLog(args: {
  logs: ProviderCallLog[];
  snapshot: Pick<HotelOfferSnapshot, "provider" | "region" | "node_id">;
  nowMs: number;
  cooldownMs?: number;
}): ProviderCallLog | undefined {
  const cooldownMs = args.cooldownMs ?? LITEAPI_RETEST_COOLDOWN_MS;
  return args.logs.find((entry) => {
    if (
      normaliseProviderEndpointPath(entry.endpoint) !== LITEAPI_HOTEL_RATES_ENDPOINT
    ) {
      return false;
    }
    if (entry.provider !== args.snapshot.provider) return false;
    if (entry.region !== args.snapshot.region) return false;
    if (entry.node_id !== args.snapshot.node_id) return false;
    const ageMs = args.nowMs - entry.created_at;
    return ageMs >= 0 && ageMs < cooldownMs;
  });
}
