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
const PLACES_PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places";
const PLACE_OPENING_HOURS_FIELD_MASK = [
  "id",
  "businessStatus",
  "regularOpeningHours.periods",
].join(",");

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

export interface PlaceOpeningHoursPoint {
  day?: number;
  hour?: number;
  minute?: number;
}

export interface PlaceOpeningHoursPeriod {
  open?: PlaceOpeningHoursPoint;
  close?: PlaceOpeningHoursPoint;
}

export interface PlaceOpeningHoursDetails {
  google_place_id: string;
  business_status?: string;
  regular_opening_hours_periods: PlaceOpeningHoursPeriod[];
}

export interface FetchPlaceOpeningHoursOptions {
  googlePlaceId: string;
  apiKey?: string;
}

function requireKey(explicit?: string): string {
  assertServerRuntime();
  const key = explicit ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY is not set. Add it to .env.local or pass it explicitly.",
    );
  }
  return key;
}

function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error("Google Places API keys are server-only.");
  }
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

export async function fetchPlaceOpeningHoursById(
  optsOrPlaceId: string | FetchPlaceOpeningHoursOptions,
): Promise<PlaceOpeningHoursDetails> {
  const opts: FetchPlaceOpeningHoursOptions =
    typeof optsOrPlaceId === "string"
      ? { googlePlaceId: optsOrPlaceId }
      : optsOrPlaceId;
  const placeId = opts.googlePlaceId.trim();
  if (!placeId) {
    throw new Error("googlePlaceId is required.");
  }

  const apiKey = requireKey(opts.apiKey);
  const res = await fetch(
    `${PLACES_PLACE_DETAILS_URL}/${encodeURIComponent(placeId)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": PLACE_OPENING_HOURS_FIELD_MASK,
      },
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Places Details failed (${res.status}): ${text || res.statusText}`,
    );
  }

  const json = (await res.json()) as {
    id?: string;
    businessStatus?: string;
    regularOpeningHours?: {
      periods?: Array<{
        open?: { day?: number; hour?: number; minute?: number };
        close?: { day?: number; hour?: number; minute?: number };
      }>;
    };
  };

  const periods = Array.isArray(json.regularOpeningHours?.periods)
    ? json.regularOpeningHours!.periods!.map((period) => ({
        open: normalisePeriodPoint(period.open),
        close: normalisePeriodPoint(period.close),
      }))
    : [];

  return {
    google_place_id:
      typeof json.id === "string" && json.id.trim().length > 0
        ? json.id
        : placeId,
    business_status:
      typeof json.businessStatus === "string" && json.businessStatus.trim()
        ? json.businessStatus
        : undefined,
    regular_opening_hours_periods: periods,
  };
}

function normalisePeriodPoint(
  point: { day?: number; hour?: number; minute?: number } | undefined,
): PlaceOpeningHoursPoint | undefined {
  if (!point || typeof point !== "object") {
    return undefined;
  }

  return {
    day: Number.isFinite(point.day) ? Number(point.day) : undefined,
    hour: Number.isFinite(point.hour) ? Number(point.hour) : undefined,
    minute: Number.isFinite(point.minute) ? Number(point.minute) : undefined,
  };
}
