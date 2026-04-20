import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDaySummaryLine,
  buildTravelLegAriaLabel,
  buildTravelLegRouteLabel,
  getInitialOpenDayIndices,
  setAllOpenDayIndices,
  toggleOpenDayIndex,
} from "@/lib/itinerary/timelinePresentation";

function dayRef(dayIndex: number) {
  return {
    day: {
      day_index: dayIndex,
      base_node_id: `node_${dayIndex}`,
      base_node_name: `Node ${dayIndex}`,
      activities: [],
      total_activity_hours: 0,
      total_travel_hours: 0,
    },
  };
}

test("timeline open-state helpers mirror the day expand/collapse behavior", () => {
  const preparedDays = [dayRef(3), dayRef(4), dayRef(7)];

  assert.deepEqual(
    [...getInitialOpenDayIndices(preparedDays)].sort((a, b) => a - b),
    [3],
  );
  assert.deepEqual(
    [...toggleOpenDayIndex(new Set([3]), 4)].sort((a, b) => a - b),
    [3, 4],
  );
  assert.deepEqual([...toggleOpenDayIndex(new Set([3, 4]), 3)], [4]);
  assert.deepEqual(
    [...setAllOpenDayIndices(preparedDays, true)].sort((a, b) => a - b),
    [3, 4, 7],
  );
  assert.deepEqual([...setAllOpenDayIndices(preparedDays, false)], []);
});

test("buildDaySummaryLine handles packed days and relaxed rest days", () => {
  assert.equal(
    buildDaySummaryLine({
      activityCount: 2,
      travelHours: 5.25,
      isArrivalDay: true,
      hasStay: true,
    }),
    "5.5h travel · 2 stops · arrival · check-in",
  );

  assert.equal(
    buildDaySummaryLine({
      activityCount: 0,
      travelHours: 0,
      isArrivalDay: false,
      hasStay: false,
    }),
    "A flexible rest day.",
  );
});

test("travel leg helpers produce human-friendly route copy and a11y labels", () => {
  assert.equal(buildTravelLegRouteLabel("Jaipur", "Jodhpur"), "Jaipur → Jodhpur");
  assert.equal(buildTravelLegRouteLabel("", "Ajmer"), "→ Ajmer");

  assert.equal(
    buildTravelLegAriaLabel({
      fromName: "Jaipur",
      toName: "Jodhpur",
      mode: "road",
      travelHours: 5,
      distanceKm: 349.6,
    }),
    "Travel leg: Jaipur → Jodhpur, 5h by Road, 350 kilometres",
  );
  assert.equal(
    buildTravelLegAriaLabel({
      fromName: "",
      toName: "Ajmer",
      mode: "train",
      travelHours: 0.75,
      distanceKm: 0,
    }),
    "Travel leg: → Ajmer, 45m by Train",
  );
});
