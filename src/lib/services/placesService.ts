import type { Coordinates } from "@/types/domain";

/**
 * Generic Google Places service. No knowledge of Rajasthan / India / any
 * region — callers pass in whatever query + location bias they want.
 *
 * We use the new Places API (Text Search) so the same function can find
 * "heritage forts in Jaipur" or "museums in Paris" without any code change.
 */

const PLACES_TEXT_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";

export interface PlaceResult {
  google_place_id: string;
  name: string;
  formatted_address?: string;
  location: Coordinates;
  rating?: number;
  user_ratings_total?: number;
  types?: string[];
  photo_reference?: string;
}

export interface FetchPlacesOptions {
  /** Free-form query, e.g. "top attractions in Udaipur". */
  query: string;
  /** Optional circular bias around coordinates. */
  locationBias?: {
    center: Coordinates;
    /** Radius in metres. Google caps at 50km. */
    radius_m: number;
  };
  /** Max results per call (Places API caps at 20). */
  maxResults?: number;
  /** Caller-provided API key (defaults to env). */
  apiKey?: string;
}

function requireKey(explicit?: string): string {
  const key = explicit ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY is not set. Add it to .env.local or pass it explicitly.",
    );
  }
  return key;
}

/**
 * Run a Places Text Search. Returns a normalised list of results that the
 * seeder can map to `attraction` nodes.
 */
export async function fetchPlacesByQuery(
  optsOrQuery: string | FetchPlacesOptions,
): Promise<PlaceResult[]> {
  const opts: FetchPlacesOptions =
    typeof optsOrQuery === "string" ? { query: optsOrQuery } : optsOrQuery;

  const apiKey = requireKey(opts.apiKey);
  const maxResults = Math.min(opts.maxResults ?? 20, 20);

  const body: Record<string, unknown> = {
    textQuery: opts.query,
    maxResultCount: maxResults,
  };

  if (opts.locationBias) {
    body.locationBias = {
      circle: {
        center: {
          latitude: opts.locationBias.center.lat,
          longitude: opts.locationBias.center.lng,
        },
        radius: opts.locationBias.radius_m,
      },
    };
  }

  const res = await fetch(PLACES_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types,places.photos",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Places Text Search failed (${res.status}): ${text || res.statusText}`,
    );
  }

  const json = (await res.json()) as {
    places?: Array<{
      id: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude: number; longitude: number };
      rating?: number;
      userRatingCount?: number;
      types?: string[];
      photos?: Array<{ name: string }>;
    }>;
  };

  const places = json.places ?? [];
  return places
    .filter((p) => p.location && p.displayName?.text)
    .map((p) => ({
      google_place_id: p.id,
      name: p.displayName!.text!,
      formatted_address: p.formattedAddress,
      location: {
        lat: p.location!.latitude,
        lng: p.location!.longitude,
      },
      rating: p.rating,
      user_ratings_total: p.userRatingCount,
      types: p.types,
      photo_reference: p.photos?.[0]?.name,
    }));
}
