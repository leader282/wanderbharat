import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLiteApiRateCacheKey,
  LiteApiHotelDataProvider,
} from "@/lib/providers/hotels/liteApiHotelDataProvider";
import {
  ProviderDisabledError,
  ProviderResponseError,
  ProviderTimeoutError,
} from "@/lib/providers/hotels/providerErrors";
import type { ProviderCallLog } from "@/lib/providers/hotels/types";

const BASE_CONFIG = {
  enabled: true,
  apiKey: "sk_test_secret_key",
  baseUrl: "https://api.liteapi.travel/v3.0",
  timeoutMs: 250,
  maxResults: 10,
  maxProviderCallsPerItinerary: 6,
};

test("searchHotels throws ProviderDisabledError when provider is disabled", async () => {
  const logs: Array<
    Omit<ProviderCallLog, "id" | "created_at"> & {
      id?: string;
      created_at?: number;
    }
  > = [];
  const provider = new LiteApiHotelDataProvider({
    config: { ...BASE_CONFIG, enabled: false },
    fetchImpl: (async () => new Response(null, { status: 200 })) as typeof fetch,
    logCall: async (entry) => {
      logs.push(entry);
    },
  });

  await assert.rejects(
    () =>
      provider.searchHotels({
        region: "rajasthan",
        node_id: "city_jaipur",
        city_name: "Jaipur",
      }),
    ProviderDisabledError,
  );

  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.status, "disabled");
});

test("searchHotels uses injected fetch and normalises results", async () => {
  const urls: string[] = [];
  const logs: Array<
    Omit<ProviderCallLog, "id" | "created_at"> & {
      id?: string;
      created_at?: number;
    }
  > = [];
  const provider = new LiteApiHotelDataProvider({
    config: BASE_CONFIG,
    fetchImpl: (async (input, init) => {
      urls.push(String(input));
      assert.equal(init?.method, "GET");
      assert.equal(
        (init?.headers as Record<string, string>)["X-API-Key"],
        BASE_CONFIG.apiKey,
      );
      return new Response(
        JSON.stringify({
          data: [
            {
              hotelId: "h_1",
              name: "Amber Palace Hotel",
              latitude: 26.9239,
              longitude: 75.8267,
              starRating: 4,
              rating: 4.4,
              reviewCount: 181,
            },
            {
              hotelId: "h_2",
              name: "Pink City Stay",
              latitude: 26.91,
              longitude: 75.8,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch,
    logCall: async (entry) => {
      logs.push(entry);
    },
  });

  const results = await provider.searchHotels({
    region: "rajasthan",
    node_id: "city_jaipur",
    city_name: "Jaipur",
    country_code: "in",
    anchor: { lat: 26.9124, lng: 75.7873 },
    radius_km: 12,
    limit: 5,
  });

  assert.equal(results.length, 2);
  assert.equal(results[0]?.provider_hotel_id, "h_1");
  assert.equal(results[0]?.provider, "liteapi");
  assert.equal(results[0]?.location?.lat, 26.9239);
  assert.ok(urls[0]?.includes("/v3.0/data/hotels"));
  assert.equal(new URL(urls[0]!).searchParams.get("cityName"), null);
  assert.equal(new URL(urls[0]!).searchParams.get("radius"), "12000");
  assert.ok(!urls[0]?.includes("/rates/prebook"));
  assert.equal(logs[0]?.status, "success");
  assert.equal(logs[0]?.result_count, 2);
  assert.equal("api_key" in (logs[0]?.request_summary ?? {}), false);
});

test("searchRates calls rates endpoint and returns snapshot only", async () => {
  const urls: string[] = [];
  const provider = new LiteApiHotelDataProvider({
    config: BASE_CONFIG,
    fetchImpl: (async (input, init) => {
      urls.push(String(input));
      assert.equal(init?.method, "POST");
      const parsedBody = JSON.parse(String(init?.body)) as {
        hotelIds: string[];
        occupancies: Array<{ adults: number; children: number[] }>;
      };
      assert.deepEqual(parsedBody.hotelIds, ["h_1"]);
      assert.equal(parsedBody.occupancies[0]?.adults, 2);
      assert.deepEqual(parsedBody.occupancies[0]?.children, [8]);

      return new Response(
        JSON.stringify({
          data: [
            {
              hotelId: "h_1",
              roomTypes: [
                {
                  roomTypeId: "deluxe",
                  offerId: "offer_abc_123",
                  offerRetailRate: {
                    amount: 12000,
                    currency: "INR",
                  },
                  rates: [
                    {
                      name: "Deluxe Room",
                      maxOccupancy: 3,
                      adultCount: 2,
                      childCount: 1,
                      boardType: "BB",
                      boardName: "Bed and Breakfast",
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch,
    logCall: async () => {},
  });

  const snapshot = await provider.searchRates({
    region: "rajasthan",
    node_id: "city_jaipur",
    hotel_ids: ["h_1"],
    checkin: "2026-06-10",
    checkout: "2026-06-12",
    occupancies: [{ adults: 2, children_ages: [8] }],
    currency: "inr",
    guest_nationality: "in",
  });

  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.result_count, 1);
  assert.deepEqual(snapshot.hotel_ids, ["h_1"]);
  assert.equal(snapshot.nights, 2);
  assert.equal(snapshot.min_total_amount, 12000);
  assert.equal(snapshot.min_nightly_amount, 6000);
  assert.equal(snapshot.offers[0]?.total_amount, 12000);
  assert.equal(snapshot.offers[0]?.nightly_amount, 6000);
  assert.equal(snapshot.offers[0]?.provider_offer_id_hash?.length, 24);
  assert.equal(urls.length, 1);
  assert.ok(urls[0]?.includes("/v3.0/hotels/rates"));
  assert.ok(!urls[0]?.includes("/rates/prebook"));
  assert.ok(!urls[0]?.includes("/rates/book"));
});

test("searchRates converts aborted fetch into ProviderTimeoutError", async () => {
  const logs: Array<
    Omit<ProviderCallLog, "id" | "created_at"> & {
      id?: string;
      created_at?: number;
    }
  > = [];
  const provider = new LiteApiHotelDataProvider({
    config: { ...BASE_CONFIG, timeoutMs: 5 },
    fetchImpl: ((_, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const abortError = new Error("aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      });
    }) as typeof fetch,
    logCall: async (entry) => {
      logs.push(entry);
    },
  });

  await assert.rejects(
    () =>
      provider.searchRates({
        region: "rajasthan",
        node_id: "city_jaipur",
        hotel_ids: ["h_1"],
        checkin: "2026-06-10",
        checkout: "2026-06-11",
        occupancies: [{ adults: 1, children_ages: [] }],
        currency: "INR",
        guest_nationality: "IN",
      }),
    ProviderTimeoutError,
  );

  assert.equal(logs[0]?.status, "timeout");
});

test("searchRates redacts API key from response errors and logs", async () => {
  const logs: Array<
    Omit<ProviderCallLog, "id" | "created_at"> & {
      id?: string;
      created_at?: number;
    }
  > = [];
  const provider = new LiteApiHotelDataProvider({
    config: BASE_CONFIG,
    fetchImpl: (async () =>
      new Response(`invalid key: ${BASE_CONFIG.apiKey}`, {
        status: 401,
        statusText: "Unauthorized",
      })) as typeof fetch,
    logCall: async (entry) => {
      logs.push(entry);
    },
  });

  let thrown: unknown;
  try {
    await provider.searchRates({
      region: "rajasthan",
      node_id: "city_jaipur",
      hotel_ids: ["h_1"],
      checkin: "2026-06-10",
      checkout: "2026-06-11",
      occupancies: [{ adults: 1, children_ages: [] }],
      currency: "INR",
      guest_nationality: "IN",
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof ProviderResponseError);
  assert.ok(!String((thrown as ProviderResponseError).message).includes(BASE_CONFIG.apiKey));
  assert.equal(logs[0]?.status, "error");
  assert.ok(!String(logs[0]?.error_message).includes(BASE_CONFIG.apiKey));
});

test("buildLiteApiRateCacheKey is deterministic and excludes fetched time", () => {
  const first = buildLiteApiRateCacheKey({
    region: "Rajasthan",
    node_id: "city_jaipur",
    hotel_ids: [" h_2 ", "h_1", "h_1"],
    checkin: "2026-06-10",
    checkout: "2026-06-12",
    occupancies: [
      { adults: 1, children_ages: [] },
      { adults: 2, children_ages: [8, 4] },
    ],
    currency: "inr",
    guest_nationality: "in",
  });
  const second = buildLiteApiRateCacheKey({
    region: "rajasthan",
    node_id: "city_jaipur",
    hotel_ids: ["h_1", "h_2"],
    checkin: "2026-06-10",
    checkout: "2026-06-12",
    occupancies: [
      { adults: 2, children_ages: [4, 8] },
      { adults: 1, children_ages: [] },
    ],
    currency: "INR",
    guest_nationality: "IN",
  });

  assert.equal(first, second);
  assert.ok(first.startsWith("liteapi_"));
});
