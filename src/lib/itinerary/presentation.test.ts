import assert from "node:assert/strict";
import test from "node:test";

import {
  formatClockTimeLabel,
  formatRoundedHours,
  formatTravellerParty,
  makeMoneyFormatter,
  titleCaseWords,
} from "@/lib/itinerary/presentation";

test("formatTravellerParty handles pluralisation and custom joiners", () => {
  assert.equal(
    formatTravellerParty({ adults: 2, children: 1 }),
    "2 adults + 1 child",
  );
  assert.equal(
    formatTravellerParty({ adults: 1, children: 2 }, { joiner: " & " }),
    "1 adult & 2 children",
  );
  assert.equal(formatTravellerParty({ adults: 1, children: 0 }), "1 adult");
});

test("makeMoneyFormatter formats supported currencies and falls back safely", () => {
  assert.equal(makeMoneyFormatter("INR")(18_500), "₹18,500");

  const fallbackFormatter = makeMoneyFormatter("INVALID");
  assert.equal(fallbackFormatter(-25), "INVALID 0");
  assert.equal(fallbackFormatter(12_345.6), "INVALID 12,346");
});

test("titleCaseWords normalises underscore and dash separated labels", () => {
  assert.equal(titleCaseWords("road_trip-stop"), "Road Trip Stop");
  assert.equal(titleCaseWords("free_wifi"), "Free Wifi");
});

test("formatClockTimeLabel renders valid clock labels and falls back on malformed input", () => {
  assert.equal(formatClockTimeLabel("18:05"), "6:05 PM");
  assert.equal(formatClockTimeLabel(undefined), "9:00 AM");
  assert.equal(formatClockTimeLabel("oops", "07:30"), "7:30 AM");
});

test("formatRoundedHours rounds short and long durations for display", () => {
  assert.equal(formatRoundedHours(Number.NaN), "0");
  assert.equal(formatRoundedHours(0.75), "0.8");
  assert.equal(formatRoundedHours(1.24), "1");
  assert.equal(formatRoundedHours(2.26), "2.5");
});
