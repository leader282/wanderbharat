import type {
  HotelOfferSnapshot,
  HotelProviderName,
  HotelRateSearchInput,
  HotelSearchInput,
  HotelSearchResult,
} from "@/lib/providers/hotels/types";

export interface HotelDataProvider {
  readonly provider: HotelProviderName;
  searchHotels(input: HotelSearchInput): Promise<HotelSearchResult[]>;
  searchRates(input: HotelRateSearchInput): Promise<HotelOfferSnapshot>;
}
