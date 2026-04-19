import assert from "node:assert/strict";
import test from "node:test";

import {
  getItineraryMapData,
  precacheItineraryRouteGeometry,
} from "@/lib/services/itineraryMapService";
import type {
  Accommodation,
  GraphEdge,
  GraphNode,
  Itinerary,
} from "@/types/domain";

const nodes: GraphNode[] = [
  {
    id: "city_start",
    type: "city",
    name: "Jaipur",
    region: "rajasthan",
    country: "india",
    tags: ["heritage"],
    metadata: { google_place_id: "place_jaipur" },
    location: { lat: 26.9124, lng: 75.7873 },
  },
  {
    id: "city_end",
    type: "city",
    name: "Udaipur",
    region: "rajasthan",
    country: "india",
    tags: ["lakes"],
    metadata: { google_place_id: "place_udaipur" },
    location: { lat: 24.5854, lng: 73.7125 },
  },
  {
    id: "attr_city_palace",
    type: "attraction",
    name: "City Palace",
    region: "rajasthan",
    country: "india",
    tags: ["heritage"],
    metadata: { google_place_id: "place_city_palace" },
    location: { lat: 24.576, lng: 73.684 },
    parent_node_id: "city_end",
  },
];

const accommodation: Accommodation = {
  id: "acc_lake_view",
  regionId: "rajasthan",
  nodeId: "city_end",
  name: "Lake View Stay",
  category: "heritage",
  pricePerNight: 4200,
  currency: "INR",
  rating: 4.6,
  reviewCount: 128,
  amenities: ["wifi"],
  location: { lat: 24.579, lng: 73.688 },
  distanceFromCenterKm: 1.1,
  active: true,
};

function makeItinerary(): Itinerary {
  return {
    id: "it_map_test",
    user_id: null,
    region: "rajasthan",
    start_node: "city_start",
    end_node: "city_end",
    days: 2,
    preferences: {
      travel_style: "balanced",
      budget: { min: 0, max: 50000, currency: "INR" },
      transport_modes: ["road"],
    },
    nodes: ["city_start", "city_end"],
    day_plan: [
      {
        day_index: 0,
        base_node_id: "city_end",
        base_node_name: "Udaipur",
        travel: {
          from_node_id: "city_start",
          to_node_id: "city_end",
          transport_mode: "road",
          distance_km: 395,
          travel_time_hours: 6.8,
        },
        activities: [
          {
            node_id: "attr_city_palace",
            name: "City Palace",
            type: "attraction",
            duration_hours: 2.5,
            tags: ["heritage"],
          },
        ],
        total_activity_hours: 2.5,
        total_travel_hours: 6.8,
      },
      {
        day_index: 1,
        base_node_id: "city_end",
        base_node_name: "Udaipur",
        activities: [],
        total_activity_hours: 4,
        total_travel_hours: 0,
      },
    ],
    stays: [
      {
        nodeId: "city_end",
        startDay: 0,
        endDay: 1,
        nights: 2,
        accommodationId: "acc_lake_view",
        nightlyCost: 4200,
        totalCost: 8400,
      },
    ],
    estimated_cost: 12000,
    score: 0.86,
    created_at: 1700000000000,
  };
}

function makeLoopItinerary(): Itinerary {
  return {
    ...makeItinerary(),
    days: 3,
    nodes: ["city_start", "city_end", "city_start"],
    day_plan: [
      {
        day_index: 0,
        base_node_id: "city_end",
        base_node_name: "Udaipur",
        travel: {
          from_node_id: "city_start",
          to_node_id: "city_end",
          transport_mode: "road",
          distance_km: 395,
          travel_time_hours: 6.8,
        },
        activities: [],
        total_activity_hours: 3,
        total_travel_hours: 6.8,
      },
      {
        day_index: 1,
        base_node_id: "city_start",
        base_node_name: "Jaipur",
        travel: {
          from_node_id: "city_end",
          to_node_id: "city_start",
          transport_mode: "road",
          distance_km: 395,
          travel_time_hours: 6.8,
        },
        activities: [],
        total_activity_hours: 3,
        total_travel_hours: 6.8,
      },
      {
        day_index: 2,
        base_node_id: "city_start",
        base_node_name: "Jaipur",
        activities: [],
        total_activity_hours: 4,
        total_travel_hours: 0,
      },
    ],
    stays: [],
  };
}

test("getItineraryMapData backfills geometry and builds stop/stay/attraction markers", async () => {
  let persistedEdges: GraphEdge[] = [];
  let fetchCalls = 0;

  const result = await getItineraryMapData(makeItinerary(), {
    getNodes: async () => nodes,
    getAccommodations: async () => [accommodation],
    findEdges: async () => [],
    upsertEdges: async (edges) => {
      persistedEdges = edges;
    },
    getTravelTime: async () => {
      fetchCalls += 1;
      return {
        distance_km: 392.8,
        travel_time_hours: 6.75,
        encoded_polyline: "encoded-road-leg",
      };
    },
    now: () => 1700000001234,
  });

  assert.equal(fetchCalls, 1);
  assert.equal(result.missing_geometry_count, 0);
  assert.equal(result.legs[0]?.encoded_polyline, "encoded-road-leg");
  assert.deepEqual(result.markers.map((marker) => marker.kind).sort(), [
    "attraction",
    "stay",
    "stop",
    "stop",
  ]);
  assert.equal(
    persistedEdges[0]?.metadata?.encoded_polyline,
    "encoded-road-leg",
  );
});

test("getItineraryMapData refreshes geometry on a cached edge without changing engine distance/time", async () => {
  let persistedEdges: GraphEdge[] = [];
  const cachedEdgeWithoutGeometry: GraphEdge = {
    id: "edge_resolved_road_city_end__city_start",
    from: "city_end",
    to: "city_start",
    type: "road",
    // Engine values intentionally differ from the live ones below; the map
    // should keep the engine's values so it agrees with the day-by-day timeline.
    distance_km: 395,
    travel_time_hours: 6.8,
    bidirectional: true,
    regions: ["rajasthan"],
    metadata: {
      provider: "google_routes",
      resolved_at: 1700000000000,
    },
  };

  const result = await getItineraryMapData(makeItinerary(), {
    getNodes: async () => nodes,
    getAccommodations: async () => [accommodation],
    findEdges: async () => [cachedEdgeWithoutGeometry],
    upsertEdges: async (edges) => {
      persistedEdges = edges;
    },
    getTravelTime: async () => ({
      distance_km: 392.8,
      travel_time_hours: 6.75,
      encoded_polyline: "live-polyline",
    }),
    now: () => 1700000099999,
  });

  assert.equal(result.legs[0]?.distance_km, 395);
  assert.equal(result.legs[0]?.travel_time_hours, 6.8);
  assert.equal(result.legs[0]?.encoded_polyline, "live-polyline");
  assert.equal(persistedEdges[0]?.distance_km, 395);
  assert.equal(persistedEdges[0]?.travel_time_hours, 6.8);
  assert.equal(persistedEdges[0]?.metadata?.encoded_polyline, "live-polyline");
});

test("getItineraryMapData survives a slow Google Routes call without blocking", async () => {
  const result = await getItineraryMapData(makeItinerary(), {
    getNodes: async () => nodes,
    getAccommodations: async () => [accommodation],
    findEdges: async () => [],
    upsertEdges: async () => {},
    getTravelTime: () =>
      new Promise(() => {
        // Never resolves — simulates an unhealthy upstream.
      }),
    liveRouteTimeoutMs: 5,
    now: () => 1700000077777,
  });

  // Falls back to the engine's day-plan distance + a direct-line geometry.
  assert.equal(result.missing_geometry_count, 1);
  assert.equal(result.legs[0]?.has_geometry, false);
  assert.equal(result.legs[0]?.distance_km, 395);
});

test("getItineraryMapData reuses cached geometry without another Google call", async () => {
  let fetchCalls = 0;
  const cachedEdge: GraphEdge = {
    id: "edge_resolved_road_city_end__city_start",
    from: "city_end",
    to: "city_start",
    type: "road",
    distance_km: 392.8,
    travel_time_hours: 6.75,
    bidirectional: true,
    regions: ["rajasthan"],
    metadata: {
      provider: "google_routes",
      resolved_at: 1700000001111,
      encoded_polyline: "cached-polyline",
    },
  };

  const result = await getItineraryMapData(makeItinerary(), {
    getNodes: async () => nodes,
    getAccommodations: async () => [accommodation],
    findEdges: async () => [cachedEdge],
    upsertEdges: async () => {},
    getTravelTime: async () => {
      fetchCalls += 1;
      return {
        distance_km: 392.8,
        travel_time_hours: 6.75,
        encoded_polyline: "live-polyline",
      };
    },
  });

  assert.equal(fetchCalls, 0);
  assert.equal(result.legs[0]?.encoded_polyline, "cached-polyline");
});

test("getItineraryMapData collapses repeated round-trip stops onto the first marker", async () => {
  const result = await getItineraryMapData(makeLoopItinerary(), {
    getNodes: async () => nodes,
    getAccommodations: async () => [],
    findEdges: async () => [],
    upsertEdges: async () => {},
    getTravelTime: async () => ({
      distance_km: 392.8,
      travel_time_hours: 6.75,
      encoded_polyline: "loop-polyline",
    }),
  });

  const stopMarkers = result.markers.filter((marker) => marker.kind === "stop");
  assert.equal(stopMarkers.length, 2);

  const startMarker = stopMarkers.find((marker) => marker.node_id === "city_start");
  assert.ok(startMarker);
  assert.equal(startMarker.stop_order, 0);
  assert.equal(startMarker.subtitle, "Stops 1, 3");
  assert.deepEqual(startMarker.day_indices, [0, 1, 2]);
});

test("precacheItineraryRouteGeometry persists only the itinerary's actual travel legs", async () => {
  let persistedEdges: GraphEdge[] = [];

  await precacheItineraryRouteGeometry(makeItinerary(), nodes, {
    findEdges: async () => [],
    upsertEdges: async (edges) => {
      persistedEdges = edges;
    },
    getTravelTime: async () => ({
      distance_km: 392.8,
      travel_time_hours: 6.75,
      encoded_polyline: "encoded-road-leg",
    }),
    now: () => 1700000005678,
  });

  assert.equal(persistedEdges.length, 1);
  assert.equal(persistedEdges[0]?.type, "road");
  assert.equal(
    persistedEdges[0]?.metadata?.encoded_polyline,
    "encoded-road-leg",
  );
});
