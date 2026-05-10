"use client";

import { useMemo, useState } from "react";

import type { Coordinates } from "@/types/domain";

const MAP_WIDTH = 640;
const MAP_HEIGHT = 280;
const MAP_PADDING = 24;

export interface OptionalCitiesMiniMapCity {
  cityId: string;
  cityName: string;
  coordinates: Coordinates | null;
  isSelected: boolean;
}

interface OptionalCitiesMiniMapStartCity {
  cityId: string;
  cityName: string;
  coordinates: Coordinates | null;
}

interface OptionalCitiesMiniMapProps {
  startCity: OptionalCitiesMiniMapStartCity | null;
  optionalCities: OptionalCitiesMiniMapCity[];
  emphasizedCityId?: string | null;
  onEmphasizeCity?: (cityId: string | null) => void;
}

interface ProjectedCity {
  cityId: string;
  cityName: string;
  x: number;
  y: number;
  isSelected: boolean;
}

export default function OptionalCitiesMiniMap({
  startCity,
  optionalCities,
  emphasizedCityId = null,
  onEmphasizeCity,
}: OptionalCitiesMiniMapProps) {
  const [showMobileMap, setShowMobileMap] = useState(false);
  const mapGeometry = useMemo(
    () => buildMapGeometry(startCity, optionalCities),
    [optionalCities, startCity],
  );

  if (!mapGeometry) return null;

  const { projectedStartCity, projectedOptionalCities, hiddenMarkerCount } =
    mapGeometry;
  const mapLabel = `Approximate mini distance map from ${projectedStartCity.cityName}`;

  return (
    <div className="rounded-xl border border-[var(--hairline)] bg-[linear-gradient(180deg,#f7f4ea_0%,#eef1f4_100%)] p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--color-ink-900)]">
            Approximate distance from {projectedStartCity.cityName}
          </p>
          <p className="text-xs text-[var(--color-ink-500)]">
            Preview only. Estimates use city coordinates. Use cards to add/remove
            stops.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowMobileMap((open) => !open)}
          aria-expanded={showMobileMap}
          className="md:hidden rounded-full border border-[var(--hairline)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-700)] hover:border-[var(--color-ink-700)] hover:text-[var(--color-ink-900)]"
        >
          {showMobileMap ? "Hide distance map" : "View distance map"}
        </button>
      </div>

      <div className={`${showMobileMap ? "mt-3 block" : "hidden"} md:mt-3 md:block`}>
        <div className="relative overflow-hidden rounded-lg border border-[var(--hairline)] bg-white/65">
          <svg
            viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
            role="img"
            aria-label={mapLabel}
            className="block h-[200px] w-full md:h-[240px]"
          >
            <rect
              x={0}
              y={0}
              width={MAP_WIDTH}
              height={MAP_HEIGHT}
              fill="transparent"
            />

            {projectedOptionalCities.map((city) => (
              <line
                key={`line-${city.cityId}`}
                x1={projectedStartCity.x}
                y1={projectedStartCity.y}
                x2={city.x}
                y2={city.y}
                stroke={city.isSelected ? "#0f7670" : "#9a9181"}
                strokeOpacity={city.isSelected ? 0.55 : 0.35}
                strokeWidth={city.isSelected ? 2 : 1.5}
                strokeDasharray={city.isSelected ? undefined : "4 4"}
              />
            ))}

            {projectedOptionalCities.map((city) => {
              const isEmphasized = emphasizedCityId === city.cityId;
              const labelOnLeft = city.x > MAP_WIDTH - 100;
              const showLabel =
                projectedOptionalCities.length <= 6 || city.isSelected || isEmphasized;
              const labelX = labelOnLeft ? city.x - 8 : city.x + 8;
              const textAnchor = labelOnLeft ? "end" : "start";

              return (
                <g
                  key={city.cityId}
                  className="cursor-pointer"
                  onMouseEnter={() => onEmphasizeCity?.(city.cityId)}
                  onMouseLeave={() => onEmphasizeCity?.(null)}
                  onClick={() => onEmphasizeCity?.(city.cityId)}
                >
                  <circle
                    cx={city.x}
                    cy={city.y}
                    r={isEmphasized ? 7 : city.isSelected ? 6 : 4.75}
                    fill={city.isSelected ? "#0f7670" : "#f1ede3"}
                    stroke={city.isSelected ? "#0a5550" : "#6e6557"}
                    strokeWidth={isEmphasized ? 2 : 1.4}
                  />
                  {showLabel && (
                    <text
                      x={labelX}
                      y={city.y - 10}
                      textAnchor={textAnchor}
                      fontSize={11}
                      fontWeight={city.isSelected ? 700 : 500}
                      fill="#3a342a"
                    >
                      {city.cityName}
                    </text>
                  )}
                </g>
              );
            })}

            <g>
              <circle
                cx={projectedStartCity.x}
                cy={projectedStartCity.y}
                r={8}
                fill="#14110d"
                stroke="#ffffff"
                strokeWidth={2}
              />
              <text
                x={projectedStartCity.x + 10}
                y={projectedStartCity.y - 12}
                textAnchor="start"
                fontSize={11}
                fontWeight={700}
                fill="#14110d"
              >
                {projectedStartCity.cityName}
              </text>
            </g>
          </svg>

        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--color-ink-500)]">
          <LegendDot className="bg-[var(--color-ink-900)]" label="Starting city" />
          <LegendDot className="bg-[var(--color-teal-500)]" label="Selected optional" />
          <LegendDot className="bg-[var(--color-sand-200)]" label="Available optional" />
        </div>
        {hiddenMarkerCount > 0 && (
          <p className="mt-2 text-xs text-[var(--color-ink-500)]">
            {hiddenMarkerCount} optional{" "}
            {hiddenMarkerCount === 1 ? "city is" : "cities are"} hidden from the map
            because coordinates are unavailable.
          </p>
        )}
      </div>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full border border-white/50 ${className}`} />
      {label}
    </span>
  );
}

function buildMapGeometry(
  startCity: OptionalCitiesMiniMapStartCity | null,
  optionalCities: OptionalCitiesMiniMapCity[],
): {
  projectedStartCity: ProjectedCity;
  projectedOptionalCities: ProjectedCity[];
  hiddenMarkerCount: number;
} | null {
  if (!startCity) {
    return null;
  }
  const startCoordinates = startCity.coordinates;
  if (!isValidCoordinates(startCoordinates)) return null;

  const validOptionalCities = optionalCities.flatMap((city) =>
    isValidCoordinates(city.coordinates)
      ? [{ ...city, coordinates: city.coordinates }]
      : [],
  );
  if (validOptionalCities.length === 0) return null;

  const points = [
    startCoordinates,
    ...validOptionalCities.map((city) => city.coordinates),
  ];
  const bounds = getBounds(points);

  const projectedStartCity = {
    cityId: startCity.cityId,
    cityName: startCity.cityName,
    isSelected: true,
    ...projectCoordinates(startCoordinates, bounds),
  };

  const projectedOptionalCities = validOptionalCities.map((city) => ({
    cityId: city.cityId,
    cityName: city.cityName,
    isSelected: city.isSelected,
    ...projectCoordinates(city.coordinates, bounds),
  }));

  return {
    projectedStartCity,
    projectedOptionalCities,
    hiddenMarkerCount: optionalCities.length - validOptionalCities.length,
  };
}

function getBounds(points: Coordinates[]) {
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
  }

  const latSpan = Math.max(0.1, maxLat - minLat);
  const lngSpan = Math.max(0.1, maxLng - minLng);

  return {
    minLat,
    minLng,
    latSpan,
    lngSpan,
  };
}

function projectCoordinates(
  coordinates: Coordinates,
  bounds: { minLat: number; minLng: number; latSpan: number; lngSpan: number },
): { x: number; y: number } {
  const x =
    MAP_PADDING +
    ((coordinates.lng - bounds.minLng) / bounds.lngSpan) *
      (MAP_WIDTH - MAP_PADDING * 2);
  const y =
    MAP_HEIGHT -
    MAP_PADDING -
    ((coordinates.lat - bounds.minLat) / bounds.latSpan) *
      (MAP_HEIGHT - MAP_PADDING * 2);

  return { x, y };
}

function isValidCoordinates(
  coordinates: Coordinates | null | undefined,
): coordinates is Coordinates {
  if (!coordinates) return false;
  return (
    Number.isFinite(coordinates.lat) &&
    Number.isFinite(coordinates.lng) &&
    Math.abs(coordinates.lat) <= 90 &&
    Math.abs(coordinates.lng) <= 180
  );
}
