import assert from "node:assert/strict";
import test from "node:test";

import type { ItineraryActivity, ItineraryDay } from "@/types/domain";
import {
  DEFAULT_DAY_START,
  buildDaySchedule,
  formatClock,
  formatDuration,
  formatTimeRange,
} from "@/lib/itinerary/daySchedule";

function activity(
  name: string,
  durationHours: number,
  overrides: Partial<ItineraryActivity> = {},
): ItineraryActivity {
  return {
    node_id: `node_${name.toLowerCase().replace(/\s+/g, "_")}`,
    name,
    type: "attraction",
    duration_hours: durationHours,
    tags: [],
    ...overrides,
  };
}

function dayOf(
  activities: ItineraryActivity[],
  travelHours = 0,
): ItineraryDay {
  return {
    day_index: 0,
    base_node_id: "node_base",
    base_node_name: "Base City",
    activities,
    total_activity_hours: activities.reduce(
      (sum, a) => sum + a.duration_hours,
      0,
    ),
    total_travel_hours: travelHours,
    travel:
      travelHours > 0
        ? {
            from_node_id: "node_origin",
            to_node_id: "node_base",
            transport_mode: "road",
            distance_km: 200,
            travel_time_hours: travelHours,
          }
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// buildDaySchedule
// ---------------------------------------------------------------------------

test("buildDaySchedule defaults to 09:00 when no startTime is provided", () => {
  const blocks = buildDaySchedule({
    day: dayOf([activity("Fort tour", 2)]),
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "activity");
  assert.equal(blocks[0].startMin, 9 * 60);
  assert.equal(blocks[0].endMin, 11 * 60);
});

test("buildDaySchedule honors a custom startTime", () => {
  const blocks = buildDaySchedule({
    day: dayOf([activity("Fort tour", 2)]),
    startTime: "07:30",
  });

  assert.equal(blocks[0].startMin, 7 * 60 + 30);
});

test("buildDaySchedule places travel first, then a 15-min settle-in buffer", () => {
  const blocks = buildDaySchedule({
    day: dayOf([activity("City walk", 1.5)], 2),
    startTime: "09:00",
  });

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].kind, "travel");
  assert.equal(blocks[0].startMin, 9 * 60);
  assert.equal(blocks[0].endMin, 11 * 60);

  assert.equal(blocks[1].kind, "activity");
  // 11:00 + 15 min post-travel buffer
  assert.equal(blocks[1].startMin, 11 * 60 + 15);
  assert.equal(blocks[1].endMin, 11 * 60 + 15 + 90);
});

test("buildDaySchedule inserts a 15-min buffer between back-to-back activities", () => {
  const blocks = buildDaySchedule({
    day: dayOf([activity("A", 1), activity("B", 1)]),
    startTime: "09:00",
  });

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].endMin, 10 * 60);
  // 15-min gap → next activity starts at 10:15
  assert.equal(blocks[1].startMin, 10 * 60 + 15);
});

test("buildDaySchedule inserts a 60-min lunch at the first natural break inside the lunch window", () => {
  const blocks = buildDaySchedule({
    day: dayOf([
      activity("Morning museum", 2.5), // 9:00 – 11:30
      activity("Old town walk", 2), // pushes us through lunch window
      activity("Sunset view", 1),
    ]),
    startTime: "09:00",
  });

  // Cursor after first activity = 11:30, +15 buffer = 11:45 → not yet in window
  // Activity 2: 11:45 – 13:45, +15 buffer = 14:00 → in window → lunch inserted
  // Activity 3 starts after lunch
  const meals = blocks.filter((b) => b.kind === "meal");
  assert.equal(meals.length, 1);
  assert.equal(meals[0].startMin, 14 * 60);
  assert.equal(meals[0].endMin, 15 * 60);

  const lastActivity = blocks[blocks.length - 1];
  assert.equal(lastActivity.kind, "activity");
  assert.equal(lastActivity.startMin, 15 * 60);
});

test("buildDaySchedule inserts lunch at most once even with many activities", () => {
  const blocks = buildDaySchedule({
    day: dayOf([
      activity("A", 2),
      activity("B", 2),
      activity("C", 2),
      activity("D", 2),
    ]),
    startTime: "09:00",
  });

  assert.equal(blocks.filter((b) => b.kind === "meal").length, 1);
});

test("buildDaySchedule skips lunch when the day starts after the lunch window", () => {
  const blocks = buildDaySchedule({
    day: dayOf([activity("Sunset stroll", 2)]),
    startTime: "16:00",
  });

  assert.equal(blocks.filter((b) => b.kind === "meal").length, 0);
});

test("buildDaySchedule skips lunch when there are no activities", () => {
  const blocks = buildDaySchedule({
    day: dayOf([], 4), // travel-only arrival day spanning lunch window
    startTime: "10:00",
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "travel");
});

test("buildDaySchedule ignores zero-duration activities and travel", () => {
  const blocks = buildDaySchedule({
    day: dayOf([activity("Phantom", 0), activity("Real", 1)], 0),
    startTime: "09:00",
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "activity");
  assert.equal(blocks[0].startMin, 9 * 60);
});

test("buildDaySchedule falls back to the default start time on a malformed value", () => {
  const blocks = buildDaySchedule({
    day: dayOf([activity("X", 1)]),
    startTime: "not-a-time",
  });

  const defaultMin =
    Number(DEFAULT_DAY_START.slice(0, 2)) * 60 +
    Number(DEFAULT_DAY_START.slice(3));
  assert.equal(blocks[0].startMin, defaultMin);
});

// ---------------------------------------------------------------------------
// formatters
// ---------------------------------------------------------------------------

test("formatClock renders 12-hour time with AM/PM", () => {
  assert.equal(formatClock(0), "12:00 AM");
  assert.equal(formatClock(9 * 60 + 5), "9:05 AM");
  assert.equal(formatClock(12 * 60), "12:00 PM");
  assert.equal(formatClock(13 * 60 + 30), "1:30 PM");
  assert.equal(formatClock(23 * 60 + 59), "11:59 PM");
});

test("formatClock supports dropping the period suffix", () => {
  assert.equal(formatClock(9 * 60, { withPeriod: false }), "9:00");
  assert.equal(formatClock(13 * 60, { withPeriod: false }), "1:00");
});

test("formatTimeRange collapses the period when start and end share AM/PM", () => {
  assert.equal(formatTimeRange(9 * 60, 11 * 60 + 30), "9:00 – 11:30 AM");
  assert.equal(formatTimeRange(14 * 60, 17 * 60), "2:00 – 5:00 PM");
});

test("formatTimeRange keeps both periods when the range crosses noon", () => {
  assert.equal(
    formatTimeRange(11 * 60, 13 * 60 + 30),
    "11:00 AM – 1:30 PM",
  );
});

test("formatTimeRange marks ranges that overflow past midnight", () => {
  assert.equal(
    formatTimeRange(22 * 60, 25 * 60 + 30),
    "10:00 PM – 1:30 AM (+1d)",
  );
});

test("formatDuration renders compact hours/minutes labels", () => {
  assert.equal(formatDuration(0), "0m");
  assert.equal(formatDuration(45), "45m");
  assert.equal(formatDuration(60), "1h");
  assert.equal(formatDuration(90), "1h 30m");
  assert.equal(formatDuration(150), "2h 30m");
});
