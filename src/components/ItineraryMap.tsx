"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Script from "next/script";

import type {
  ItineraryMapData,
  ItineraryMapLeg,
  ItineraryMapMarker,
} from "@/types/domain";

type MapDayFilter = "all" | number;

/**
 * Loader lifecycle.
 *  - "idle":     the Maps script hasn't executed yet.
 *  - "loaded":   the script fired `onLoad`/`onReady`, but constructors
 *                may still be settling depending on how the API was loaded.
 *  - "ready":    the map and marker constructors are attached and safe
 *                to construct.
 *  - "error":    the Maps API failed to become usable.
 */
type MapsState = "idle" | "loaded" | "ready" | "error";

interface ItineraryMapProps {
  data: ItineraryMapData;
  dayOptions: Array<{
    day_index: number;
    label: string;
  }>;
}

const GOOGLE_MAPS_BROWSER_API_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY ?? "";
const GOOGLE_MAPS_MAP_ID =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID";
const MAP_DEFAULT_CENTER: google.maps.LatLngLiteral = {
  lat: 22.5937,
  lng: 78.9629,
};
const MAP_READY_CHECK_INTERVAL_MS = 50;
const MAP_READY_CHECK_LIMIT = 40;

export default function ItineraryMap({ data, dayOptions }: ItineraryMapProps) {
  const [selectedDay, setSelectedDay] = useState<MapDayFilter>("all");
  // On the server `google` is undefined → initial state is "idle". On the
  // first cold page load the client also starts at "idle" (script hasn't
  // loaded yet), so no hydration mismatch. On SPA navigation back to the
  // same kind of page the Maps API may already be ready, so we can skip
  // straight to "ready".
  const [mapsState, setMapsState] = useState<MapsState>(() =>
    hasMapsApiReady() ? "ready" : "idle",
  );
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  const visibleMarkers = useMemo(
    () => filterMarkers(data.markers, selectedDay),
    [data.markers, selectedDay],
  );
  const visibleLegs = useMemo(
    () => filterLegs(data.legs, selectedDay),
    [data.legs, selectedDay],
  );

  // `next/script` can report loaded just before the marker constructors attach,
  // so give the API a brief settling window before failing hard.
  useEffect(() => {
    if (mapsState !== "loaded") return;
    let cancelled = false;
    let readinessPollId: number | undefined;
    let remainingChecks = MAP_READY_CHECK_LIMIT;

    const setReady = () => {
      if (!cancelled) setMapsState("ready");
    };

    const setError = () => {
      if (!cancelled) setMapsState("error");
    };

    const checkMapsApiReady = () => {
      if (!hasMapsApiReady()) return false;
      setReady();
      return true;
    };

    if (!checkMapsApiReady()) {
      readinessPollId = window.setInterval(() => {
        if (checkMapsApiReady()) {
          if (readinessPollId !== undefined) {
            window.clearInterval(readinessPollId);
          }
          return;
        }

        remainingChecks -= 1;
        if (remainingChecks <= 0) {
          if (readinessPollId !== undefined) {
            window.clearInterval(readinessPollId);
          }
          setError();
        }
      }, MAP_READY_CHECK_INTERVAL_MS);
    }

    return () => {
      cancelled = true;
      if (readinessPollId !== undefined) {
        window.clearInterval(readinessPollId);
      }
    };
  }, [mapsState]);

  // `next/script` may dedupe the script tag and refire onLoad/onReady on
  // re-mounts. Don't downgrade once we're past the bootstrap stage.
  const handleScriptReady = () =>
    setMapsState((prev) => {
      if (prev === "ready" || prev === "error") return prev;
      return hasMapsApiReady() ? "ready" : "loaded";
    });

  useEffect(() => {
    if (mapsState !== "ready" || !mapElementRef.current || mapRef.current) return;

    mapRef.current = new google.maps.Map(mapElementRef.current, {
      center: MAP_DEFAULT_CENTER,
      zoom: 5,
      mapId: GOOGLE_MAPS_MAP_ID,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      clickableIcons: false,
      gestureHandling: "greedy",
    });
  }, [mapsState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapsState !== "ready") return;

    clearMarkers(markersRef.current);
    clearPolylines(polylinesRef.current);
    markersRef.current = [];
    polylinesRef.current = [];

    const bounds = new google.maps.LatLngBounds();

    for (const leg of visibleLegs) {
      const path = leg.encoded_polyline
        ? decodePolyline(leg.encoded_polyline)
        : [leg.from_position, leg.to_position];
      if (path.length < 2) continue;

      path.forEach((point) => bounds.extend(point));
      const polyline = new google.maps.Polyline({
        map,
        path,
        geodesic: !leg.has_geometry,
        strokeColor: transportColor(leg),
        strokeOpacity: leg.has_geometry ? 0.92 : 0.45,
        strokeWeight: selectedDay === "all" ? 4 : 5,
      });
      polylinesRef.current.push(polyline);
    }

    for (const marker of visibleMarkers) {
      bounds.extend(marker.position);
      const pin = new google.maps.marker.PinElement(markerPin(marker));
      const gmMarker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: marker.position,
        title: marker.subtitle
          ? `${marker.title} — ${marker.subtitle}`
          : marker.title,
        content: pin,
        zIndex: marker.kind === "stop" ? 30 : marker.kind === "stay" ? 20 : 10,
      });
      markersRef.current.push(gmMarker);
    }

    fitMapToBounds(map, bounds);
  }, [mapsState, visibleLegs, visibleMarkers, selectedDay]);

  useEffect(
    () => () => {
      clearMarkers(markersRef.current);
      clearPolylines(polylinesRef.current);
      markersRef.current = [];
      polylinesRef.current = [];
      mapRef.current = null;
    },
    [],
  );

  if (data.markers.length === 0 && data.legs.length === 0) {
    return (
      <div className="rounded-[28px] border border-[rgba(26,23,20,0.08)] bg-white p-6 text-sm text-[var(--color-ink-500)]">
        No map-ready stops or routes were found for this itinerary yet.
      </div>
    );
  }

  if (!GOOGLE_MAPS_BROWSER_API_KEY) {
    return (
      <div className="rounded-[28px] border border-[rgba(26,23,20,0.08)] bg-white p-6">
        <p className="font-bold text-[var(--color-ink-900)]">
          Map is not configured for the browser.
        </p>
        <p className="mt-2 text-sm text-[var(--color-ink-500)]">
          Add <code>NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY</code> to load the
          Google Maps JavaScript API for this page.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[28px] border border-[rgba(26,23,20,0.08)] bg-white p-5 md:p-6">
      <Script
        id="wanderbharat-google-maps-js"
        src={`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
          GOOGLE_MAPS_BROWSER_API_KEY,
        )}&v=weekly&loading=async&libraries=marker`}
        strategy="afterInteractive"
        onLoad={handleScriptReady}
        onReady={handleScriptReady}
        onError={() => setMapsState("error")}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-bold text-[var(--color-ink-900)]">Trip map</p>
          <p className="mt-1 text-sm text-[var(--color-ink-500)]">
            Stops and stays are always shown. Attraction pins appear when you
            switch to a specific day.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterButton
            active={selectedDay === "all"}
            onClick={() => setSelectedDay("all")}
          >
            Entire trip
          </FilterButton>
          {dayOptions.map((day) => (
            <FilterButton
              key={day.day_index}
              active={selectedDay === day.day_index}
              onClick={() => setSelectedDay(day.day_index)}
            >
              {day.label}
            </FilterButton>
          ))}
        </div>
      </div>

      {mapsState === "error" ? (
        <div
          role="alert"
          className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          Google Maps failed to load. Check the browser API key, allowed
          referrers, whether the Maps JavaScript API is enabled, and whether
          the configured map ID is valid.
        </div>
      ) : (
        <div className="mt-4">
          <div
            ref={mapElementRef}
            role="region"
            aria-label="Itinerary map"
            aria-busy={mapsState !== "ready"}
            className="h-[420px] w-full overflow-hidden rounded-[24px] border border-[rgba(26,23,20,0.08)] bg-[linear-gradient(180deg,#f7efe7_0%,#f5f8fb_100%)]"
          />
          {mapsState !== "ready" && (
            <p
              role="status"
              aria-live="polite"
              className="mt-3 text-sm text-[var(--color-ink-500)]"
            >
              Loading Google Maps…
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-[var(--color-ink-500)]">
        <LegendDot className="bg-[var(--color-brand-700)]" label="Stops" />
        <LegendDot className="bg-sky-600" label="Stays" />
        <LegendDot className="bg-emerald-600" label="Attractions" />
        <LegendLine
          className="bg-[var(--color-brand-700)]"
          label="Stored route geometry"
        />
        <LegendLine className="bg-slate-400" label="Direct fallback line" />
      </div>

      {data.missing_geometry_count > 0 && (
        <p className="mt-3 text-xs text-[var(--color-ink-500)]">
          {data.missing_geometry_count} travel{" "}
          {data.missing_geometry_count === 1 ? "leg is" : "legs are"} still
          using a direct line until route geometry is cached.
        </p>
      )}
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
        active
          ? "bg-[var(--color-brand-700)] text-white"
          : "bg-[var(--color-sand-100)] text-[var(--color-ink-700)] hover:bg-[var(--color-sand-200)]"
      }`}
    >
      {children}
    </button>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${className}`} aria-hidden />
      {label}
    </span>
  );
}

function LegendLine({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-[3px] w-6 rounded-full ${className}`} aria-hidden />
      {label}
    </span>
  );
}

function filterMarkers(
  markers: ItineraryMapMarker[],
  selectedDay: MapDayFilter,
): ItineraryMapMarker[] {
  if (selectedDay === "all") {
    return markers.filter((marker) => marker.kind !== "attraction");
  }

  return markers.filter((marker) => marker.day_indices.includes(selectedDay));
}

function filterLegs(
  legs: ItineraryMapLeg[],
  selectedDay: MapDayFilter,
): ItineraryMapLeg[] {
  if (selectedDay === "all") return legs;
  return legs.filter((leg) => leg.day_index === selectedDay);
}

function markerPin(
  marker: ItineraryMapMarker,
): google.maps.marker.PinElementOptions {
  if (marker.kind === "stop") {
    return {
      background: "#92400E",
      borderColor: "#ffffff",
      glyphColor: "#ffffff",
      glyphText: String((marker.stop_order ?? 0) + 1),
      scale: 1.1,
    };
  }

  if (marker.kind === "stay") {
    return {
      background: "#0284C7",
      borderColor: "#ffffff",
      glyphColor: "#ffffff",
      glyphText: "H",
      scale: 1,
    };
  }

  return {
    background: "#059669",
    borderColor: "#ffffff",
    glyphColor: "#ffffff",
    glyphText: "A",
    scale: 0.9,
  };
}

function transportColor(leg: ItineraryMapLeg): string {
  if (!leg.has_geometry) return "#94A3B8";
  switch (leg.transport_mode) {
    case "train":
      return "#0F766E";
    case "flight":
      return "#7C3AED";
    default:
      return "#92400E";
  }
}

function fitMapToBounds(
  map: google.maps.Map,
  bounds: google.maps.LatLngBounds,
) {
  if (bounds.isEmpty()) return;

  const northEast = bounds.getNorthEast();
  const southWest = bounds.getSouthWest();
  const singlePoint =
    Math.abs(northEast.lat() - southWest.lat()) < 0.0005 &&
    Math.abs(northEast.lng() - southWest.lng()) < 0.0005;

  if (singlePoint) {
    map.setCenter(northEast);
    map.setZoom(11);
    return;
  }

  map.fitBounds(bounds, 72);
}

function clearMarkers(markers: google.maps.marker.AdvancedMarkerElement[]) {
  markers.forEach((marker) => {
    marker.map = null;
  });
}

function clearPolylines(lines: google.maps.Polyline[]) {
  lines.forEach((line) => line.setMap(null));
}

function hasMapsApiReady(): boolean {
  return (
    typeof google !== "undefined" &&
    typeof google.maps !== "undefined" &&
    typeof google.maps.Map === "function" &&
    typeof google.maps.marker !== "undefined" &&
    typeof google.maps.marker.AdvancedMarkerElement === "function" &&
    typeof google.maps.marker.PinElement === "function"
  );
}

function decodePolyline(encoded: string): google.maps.LatLngLiteral[] {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates: google.maps.LatLngLiteral[] = [];

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push({
      lat: lat / 1e5,
      lng: lng / 1e5,
    });
  }

  return coordinates;
}
