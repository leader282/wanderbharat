// Keep these path segments relative (no leading slash) so URL resolution
// preserves any version prefix in baseUrl (e.g. /v3.0).
export const LITEAPI_HOTEL_SEARCH_ENDPOINT = "data/hotels";
export const LITEAPI_HOTEL_RATES_ENDPOINT = "hotels/rates";

export function normaliseProviderEndpointPath(endpoint: string): string {
  return endpoint.trim().replace(/^\/+/, "");
}
