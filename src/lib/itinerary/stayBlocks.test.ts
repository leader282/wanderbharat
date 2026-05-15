import assert from "node:assert/strict";
import test from "node:test";

import type { ItineraryDay } from "@/types/domain";
import { deriveStayBlocks } from "@/lib/itinerary/stayBlocks";

function makeDay(
  day_index: number,
  base_node_id: string,
  base_node_name: string,
): ItineraryDay {
  return {
    day_index,
    base_node_id,
    base_node_name,
    activities: [],
    total_activity_hours: 0,
    total_travel_hours: 0,
  };
}

test("deriveStayBlocks groups overnight base cities and skips the final day", () => {
  const blocks = deriveStayBlocks([
    makeDay(3, "node_jaipur", "Jaipur"),
    makeDay(0, "node_udaipur", "Udaipur"),
    makeDay(1, "node_udaipur", "Udaipur"),
    makeDay(2, "node_jodhpur", "Jodhpur"),
  ]);

  assert.deepEqual(
    blocks.map((block) => ({
      nodeId: block.nodeId,
      startDay: block.startDay,
      endDay: block.endDay,
      nights: block.nights,
    })),
    [
      { nodeId: "node_udaipur", startDay: 0, endDay: 1, nights: 2 },
      { nodeId: "node_jodhpur", startDay: 2, endDay: 2, nights: 1 },
    ],
  );
});

test("deriveStayBlocks returns no stay for same-day trips", () => {
  assert.deepEqual(deriveStayBlocks([makeDay(0, "node_jaipur", "Jaipur")]), []);
});

test("deriveStayBlocks returns an empty list for an empty day plan", () => {
  assert.deepEqual(deriveStayBlocks([]), []);
});
