import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import DayTimeline from "@/components/itinerary/DayTimeline";
import TripStatsGrid from "@/components/itinerary/TripStatsGrid";
import {
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

function normalizeHtml(markup: string): string {
  return markup.replace(/\s+/g, " ").trim();
}

function activity(name: string, durationHours: number): ItineraryActivity {
  return {
    node_id: `act_${name.toLowerCase().replace(/\s+/g, "_")}`,
    name,
    type: "attraction",
    duration_hours: durationHours,
    tags: ["heritage"],
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

function stay(overrides: Partial<StayAssignment>): StayAssignment {
  return {
    nodeId: "node_jodhpur",
    startDay: 1,
    endDay: 1,
    nights: 1,
    accommodationId: "acc_jodhpur",
    nightlyCost: 4500,
    totalCost: 4500,
    ...overrides,
  };
}

function accommodation(overrides: Partial<Accommodation> = {}): Accommodation {
  return {
    id: "acc_jodhpur",
    regionId: "region_test",
    nodeId: "node_jodhpur",
    name: "Haveli House",
    category: "midrange",
    pricePerNight: 4500,
    currency: "INR",
    rating: 4.4,
    reviewCount: 128,
    amenities: ["breakfast_included", "free_wifi"],
    location: { lat: 26.3, lng: 73 },
    distanceFromCenterKm: 1.2,
    breakfastIncluded: true,
    active: true,
    ...overrides,
  };
}

function itinerary(): Itinerary {
  return {
    id: "it_render",
    user_id: null,
    region: "test-region",
    start_node: "node_jaipur",
    end_node: "node_jodhpur",
    days: 2,
    preferences: {
      travel_style: "balanced",
      budget: { min: 18_000, max: 24_000, currency: "INR" },
      travellers: { adults: 2, children: 1 },
      transport_modes: ["road"],
      preferred_start_time: "08:30",
    },
    nodes: ["node_jaipur", "node_jodhpur"],
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
        base_node_id: "node_jodhpur",
        base_node_name: "Jodhpur",
        travel: {
          from_node_id: "node_jaipur",
          to_node_id: "node_jodhpur",
          transport_mode: "road",
          distance_km: 350,
          travel_time_hours: 5,
        },
        activities: [activity("Mehrangarh Fort", 2)],
        total_activity_hours: 2,
        total_travel_hours: 5,
      }),
    ],
    stays: [stay({})],
    estimated_cost: 18_500,
    score: 0.81,
    created_at: 1_700_000_000_000,
  };
}

test("DayTimeline renders itinerary data with accessible expand/collapse controls", () => {
  const trip = itinerary();
  const preparedDays = prepareDayPlan({
    itinerary: trip,
    stayByDayIndex: buildStayByDayIndex(
      buildStayEntries(trip, [accommodation()]),
    ),
    startTime: trip.preferences.preferred_start_time,
  });

  const html = normalizeHtml(
    renderToStaticMarkup(
      createElement(DayTimeline, {
        preparedDays,
        currency: "INR",
        startTime: trip.preferences.preferred_start_time,
      }),
    ),
  );

  assert.match(html, /Your complete daily plan/);
  assert.match(html, /8:30 AM/);
  assert.match(html, /Expand all/);
  assert.match(html, /aria-label="Timeline controls"/);
  assert.match(html, /Amber Fort/);
  assert.match(html, /Travel to Jodhpur/);
  assert.match(html, /Check-in/);
  assert.match(
    html,
    /Travel leg: Jaipur → Jodhpur, 5h by Road, 350 kilometres/,
  );
  assert.match(html, /aria-controls="day-0-content"/);
  assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-hidden="false"/g) ?? []).length >= 1, true);
  assert.equal((html.match(/aria-hidden="true"/g) ?? []).length >= 1, true);
});

test("DayTimeline shows a resilient empty state when there are no prepared days", () => {
  const html = normalizeHtml(
    renderToStaticMarkup(
      createElement(DayTimeline, {
        preparedDays: [],
        currency: "INR",
        startTime: undefined,
      }),
    ),
  );

  assert.match(html, /This itinerary does not have any scheduled days yet/);
  assert.doesNotMatch(html, /Timeline controls/);
});

test("TripStatsGrid renders the redesigned summary stats copy", () => {
  const trip = itinerary();
  const stats = deriveItineraryStats(trip);
  const html = normalizeHtml(
    renderToStaticMarkup(createElement(TripStatsGrid, { itinerary: trip, stats })),
  );

  assert.match(html, /Total trip budget/);
  assert.match(html, /Travellers/);
  assert.match(html, /Destinations/);
  assert.match(html, /Time on the road/);
  assert.match(html, /2 adults \+ 1 child/);
  assert.match(html, /2-day trip/);
  assert.match(html, /Estimated .*18,500 total/);
  assert.match(html, /1 day exploring · 1 on the move/);
  assert.match(html, /5 h/);
  assert.match(html, /4 h exploring/);
});
