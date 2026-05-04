import type { Coordinates, LocalDateString } from "@/types/domain";

export type HotelProviderName = "liteapi";
export type ProviderName = HotelProviderName | "google_places";

export interface HotelOccupancy {
  adults: number;
  children_ages: number[];
}

export interface HotelSearchInput {
  region: string;
  node_id: string;
  city_name?: string;
  country_code?: string;
  anchor?: Coordinates;
  radius_km?: number;
  limit?: number;
}

export interface HotelRateSearchInput {
  region: string;
  node_id: string;
  hotel_ids: string[];
  checkin: LocalDateString;
  checkout: LocalDateString;
  occupancies: HotelOccupancy[];
  currency: string;
  guest_nationality: string;
  limit?: number;
}

export interface HotelSearchResult {
  provider: HotelProviderName;
  provider_hotel_id: string;
  name: string;
  address?: string | null;
  location?: Coordinates | null;
  star_rating?: number | null;
  guest_rating?: number | null;
  review_count?: number | null;
  distance_from_anchor_km?: number | null;
}

export interface HotelOfferResult {
  provider: HotelProviderName;
  provider_hotel_id: string;
  room_type_id: string;
  room_name: string;
  board_type?: string | null;
  board_name?: string | null;
  total_amount: number | null;
  nightly_amount: number | null;
  currency: string;
  max_occupancy?: number | null;
  adult_count?: number | null;
  child_count?: number | null;
  refundable_tag?: string | null;
  provider_offer_id_hash?: string | null;
}

export interface HotelSearchSnapshot {
  id: string;
  provider: HotelProviderName;
  region: string;
  node_id: string;
  city_name?: string | null;
  country_code?: string | null;
  anchor?: Coordinates | null;
  radius_km?: number | null;
  query_key: string;
  result_count: number;
  results: HotelSearchResult[];
  fetched_at: number;
  expires_at: number;
}

export interface HotelOfferSnapshot {
  id: string;
  cache_key: string;
  provider: HotelProviderName;
  region: string;
  node_id: string;
  hotel_ids: string[];
  checkin: LocalDateString;
  checkout: LocalDateString;
  nights: number;
  currency: string;
  guest_nationality: string;
  occupancies: HotelOccupancy[];
  offers: HotelOfferResult[];
  min_total_amount: number | null;
  min_nightly_amount: number | null;
  result_count: number;
  status: "success" | "empty" | "error";
  fetched_at: number;
  expires_at: number;
  error_code?: string | null;
  error_message?: string | null;
}

export type ProviderCallStatus =
  | "success"
  | "empty"
  | "error"
  | "timeout"
  | "disabled";

export interface ProviderCallLog {
  id: string;
  provider: ProviderName;
  endpoint: string;
  request_summary: Record<string, unknown>;
  status: ProviderCallStatus;
  duration_ms: number;
  result_count: number;
  error_code?: string | null;
  error_message?: string | null;
  created_at: number;
  region?: string;
  node_id?: string;
}
