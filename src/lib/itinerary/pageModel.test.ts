import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProgressStops,
  buildStayByDayIndex,
  buildStayEntries,
  deriveItineraryStats,
  prepareDayPlan,
} from "@/lib/itinerary/pageModel";
import type {
  Accommodation,
  Itinerary,
  ItineraryActivity,
  ItineraryDay,
  StayAssignment,
} from "@/types/domain";

function activity(
  name: string,
  durationHours: number,
  overrides: Partial<ItineraryActivity> = {},
): ItineraryActivity {
  return {
    node_id: `act_${name.toLowerCase().replace(/\s+/g, "_")}`,
    name,
    type: "attraction",
    duration_hours: durationHours,
    tags: ["heritage"],
    ...overrides,
  };
}

function day(
  overrides: Partial<ItineraryDay> &
    Pick<ItineraryDay, "day_index" | "base_node_id" | "base_node_name">,
): ItineraryDay {
  const { day_index, base_node_id, base_node_name, ...rest } = overrides;
  return {
    activities: [],
    total_activity_hours: 0,
    total_travel_hours: 0,
    ...rest,
    day_index,
    base_node_id,
    base_node_name,
  };
}

function stay(
  overrides: Partial<StayAssignment> &
    Pick<StayAssignment, "nodeId" | "startDay" | "endDay" | "nights">,
): StayAssignment {
  const { nodeId, startDay, endDay, nights, ...rest } = overrides;
  return {
    accommodationId: null,
    nightlyCost: 0,
    totalCost: 0,
    ...rest,
    nodeId,
    startDay,
    endDay,
    nights,
  };
}

function accommodation(
  overrides: Partial<Accommodation> &
    Pick<Accommodation, "id" | "nodeId" | "name">,
): Accommodation {
  const { id, nodeId, name, ...rest } = overrides;
  return {
    regionId: "region_test",
    category: "midrange",
    pricePerNight: 4200,
    currency: "INR",
    rating: 4.4,
    reviewCount: 128,
    amenities: ["breakfast_included", "free_wifi"],
    location: { lat: 26.9, lng: 75.8 },
    distanceFromCenterKm: 1.2,
    active: true,
    ...rest,
    id,
    nodeId,
    name,
  };
}

function itinerary(
  overrides: Partial<Itinerary> & Pick<Itinerary, "day_plan">,
): Itinerary {
  const { day_plan, ...rest } = overrides;
  return {
    id: "it_page_model",
    user_id: null,
    region: "test-region",
    start_node: day_plan[0]?.base_node_id ?? "node_start",
    end_node:
      day_plan.at(-1)?.base_node_id ??
      day_plan[0]?.base_node_id ??
      "node_start",
    days: day_plan.length,
    preferences: {
      travel_style: "balanced",
      budget: { min: 0, max: 24_000, currency: "INR" },
      travellers: { adults: 2, children: 1 },
      transport_modes: ["road"],
      preferred_start_time: "08:30",
    },
    nodes: day_plan.map((entry) => entry.base_node_id),
    stays: [],
    estimated_cost: 18_500,
    score: 0.78,
    created_at: 1_700_000_000_000,
    ...rest,
    day_plan,
  };
}

test("prepareDayPlan annotates city runs, schedules, and travel origins", () => {
  const trip = itinerary({
    day_plan: [
      day({
        day_index: 0,
        base_node_id: "node_jaipur",
        base_node_name: "Jaipur",
        activities: [activity("Amber Fort", 2)],
        total_activity_hours: 2,
      }),
      day({
        day_index: 1,
        base_node_id: "node_jaipur",
        base_node_name: "Jaipur",
      }),
      day({
        day_index: 2,
        base_node_id: "node_jodhpur",
        base_node_name: "Jodhpur",
        travel: {
          from_node_id: "node_jaipur",
          to_node_id: "node_jodhpur",
          transport_mode: "road",
          distance_km: 340,
          travel_time_hours: 5,
        },
        activities: [activity("Mehrangarh Fort", 2)],
        total_activity_hours: 2,
        total_travel_hours: 5,
      }),
    ],
    stays: [
      stay({
        nodeId: "node_jodhpur",
        startDay: 2,
        endDay: 2,
        nights: 1,
        accommodationId: "acc_jodhpur",
        nightlyCost: 4500,
        totalCost: 4500,
      }),
    ],
  });
  const stayEntries = buildStayEntries(trip, [
    accommodation({
      id: "acc_jodhpur",
      nodeId: "node_jodhpur",
      name: "Haveli House",
    }),
  ]);

  const preparedDays = prepareDayPlan({
    itinerary: trip,
    stayByDayIndex: buildStayByDayIndex(stayEntries),
    startTime: trip.preferences.preferred_start_time,
  });

  assert.equal(preparedDays.length, 3);
  assert.equal(preparedDays[0]?.isArrival, true);
  assert.equal(preparedDays[0]?.cityStayDayNumber, 1);
  assert.equal(preparedDays[0]?.cityStayTotalDays, 2);
  assert.equal(preparedDays[0]?.schedule[0]?.kind, "activity");
  assert.equal(preparedDays[0]?.schedule[0]?.startMin, 8 * 60 + 30);

  assert.equal(preparedDays[1]?.isArrival, false);
  assert.equal(preparedDays[1]?.cityStayDayNumber, 2);
  assert.equal(preparedDays[1]?.cityStayTotalDays, 2);

  assert.equal(preparedDays[2]?.isArrival, true);
  assert.equal(preparedDays[2]?.cityStayDayNumber, 1);
  assert.equal(preparedDays[2]?.cityStayTotalDays, 1);
  assert.equal(preparedDays[2]?.travelFromName, "Jaipur");
  assert.equal(preparedDays[2]?.schedule[0]?.kind, "travel");
  assert.equal(preparedDays[2]?.schedule[0]?.startMin, 8 * 60 + 30);
  assert.equal(preparedDays[2]?.stayContext?.isFirstNight, true);
});

test("buildStayEntries and buildStayByDayIndex tolerate missing accommodation data", () => {
  const trip = itinerary({
    day_plan: [
      day({
        day_index: 0,
        base_node_id: "node_jodhpur",
        base_node_name: "Jodhpur",
      }),
      day({
        day_index: 1,
        base_node_id: "node_jodhpur",
        base_node_name: "Jodhpur",
      }),
      day({
        day_index: 2,
        base_node_id: "node_udaipur",
        base_node_name: "Udaipur",
      }),
    ],
    stays: [
      stay({
        nodeId: "node_jodhpur",
        startDay: 0,
        endDay: 1,
        nights: 2,
        accommodationId: "acc_jodhpur",
        nightlyCost: 4200,
        totalCost: 8400,
      }),
      stay({
        nodeId: "node_udaipur",
        startDay: 2,
        endDay: 2,
        nights: 1,
        accommodationId: "acc_missing",
        nightlyCost: 0,
        totalCost: 0,
      }),
    ],
  });

  const entries = buildStayEntries(trip, [
    accommodation({
      id: "acc_jodhpur",
      nodeId: "node_jodhpur",
      name: "Blue City Haveli",
    }),
  ]);
  const byDayIndex = buildStayByDayIndex(entries);

  assert.equal(entries[0]?.cityName, "Jodhpur");
  assert.equal(entries[0]?.accommodation?.name, "Blue City Haveli");
  assert.equal(entries[1]?.cityName, "Udaipur");
  assert.equal(entries[1]?.accommodation, null);

  assert.equal(byDayIndex.get(0)?.nightNumber, 1);
  assert.equal(byDayIndex.get(0)?.isFirstNight, true);
  assert.equal(byDayIndex.get(1)?.nightNumber, 2);
  assert.equal(byDayIndex.get(1)?.isFirstNight, false);
  assert.equal(byDayIndex.get(2)?.entry.accommodation, null);
});

test("buildProgressStops splits revisits into separate ribbon stops", () => {
  const trip = itinerary({
    nodes: ["node_jaipur", "node_ajmer", "node_jaipur"],
    day_plan: [
      day({
        day_index: 0,
        base_node_id: "node_jaipur",
        base_node_name: "Jaipur",
      }),
      day({
        day_index: 1,
        base_node_id: "node_ajmer",
        base_node_name: "Ajmer",
        travel: {
          from_node_id: "node_jaipur",
          to_node_id: "node_ajmer",
          transport_mode: "road",
          distance_km: 135,
          travel_time_hours: 2.5,
        },
        total_travel_hours: 2.5,
      }),
      day({
        day_index: 2,
        base_node_id: "node_jaipur",
        base_node_name: "Jaipur",
        travel: {
          from_node_id: "node_ajmer",
          to_node_id: "node_jaipur",
          transport_mode: "road",
          distance_km: 135,
          travel_time_hours: 2.5,
        },
        total_travel_hours: 2.5,
      }),
    ],
    stays: [
      stay({ nodeId: "node_jaipur", startDay: 0, endDay: 0, nights: 1 }),
      stay({ nodeId: "node_ajmer", startDay: 1, endDay: 1, nights: 1 }),
      stay({ nodeId: "node_jaipur", startDay: 2, endDay: 2, nights: 1 }),
    ],
  });

  const stops = buildProgressStops({
    itinerary: trip,
    stays: trip.stays,
  });

  assert.deepEqual(
    stops.map((stop) => ({
      name: stop.name,
      order: stop.order,
      dayIndices: stop.dayIndices,
      nights: stop.nights,
      isStart: stop.isStart,
      isEnd: stop.isEnd,
    })),
    [
      {
        name: "Jaipur",
        order: 1,
        dayIndices: [0],
        nights: 1,
        isStart: true,
        isEnd: false,
      },
      {
        name: "Ajmer",
        order: 2,
        dayIndices: [1],
        nights: 1,
        isStart: false,
        isEnd: false,
      },
      {
        name: "Jaipur",
        order: 3,
        dayIndices: [2],
        nights: 1,
        isStart: false,
        isEnd: true,
      },
    ],
  );
});

test("deriveItineraryStats summarises round trips from the rendered route", () => {
  const trip = itinerary({
    nodes: ["node_jaipur", "node_ajmer", "node_jaipur"],
    day_plan: [
      day({
        day_index: 0,
        base_node_id: "node_jaipur",
        base_node_name: "Jaipur",
        activities: [activity("Market walk", 4)],
        total_activity_hours: 4,
      }),
      day({
        day_index: 1,
        base_node_id: "node_ajmer",
        base_node_name: "Ajmer",
        travel: {
          from_node_id: "node_jaipur",
          to_node_id: "node_ajmer",
          transport_mode: "road",
          distance_km: 135,
          travel_time_hours: 2.5,
        },
        total_travel_hours: 2.5,
      }),
      day({
        day_index: 2,
        base_node_id: "node_jaipur",
        base_node_name: "Jaipur",
        travel: {
          from_node_id: "node_ajmer",
          to_node_id: "node_jaipur",
          transport_mode: "road",
          distance_km: 135,
          travel_time_hours: 2.5,
        },
        total_travel_hours: 2.5,
      }),
    ],
  });

  const stats = deriveItineraryStats(trip);

  assert.deepEqual(stats, {
    totalTravelHours: 5,
    totalActivityHours: 4,
    destinationCount: 2,
    startName: "Jaipur",
    endName: "Jaipur",
    travelDays: 2,
    stayDays: 1,
  });
});

test("deriveItineraryStats returns empty-safe defaults when the itinerary has no days", () => {
  const trip = itinerary({
    day_plan: [],
    nodes: [],
  });

  assert.deepEqual(deriveItineraryStats(trip), {
    totalTravelHours: 0,
    totalActivityHours: 0,
    destinationCount: 0,
    startName: "",
    endName: "",
    travelDays: 0,
    stayDays: 0,
  });
});
