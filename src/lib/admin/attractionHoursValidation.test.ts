import assert from "node:assert/strict";
import test from "node:test";

import {
  formatWeeklyPeriods,
  parseClosedDaysInput,
  parseWeeklyPeriodsInput,
} from "@/lib/admin/attractionHoursValidation";

test("parseWeeklyPeriodsInput parses and sorts valid periods", () => {
  const periods = parseWeeklyPeriodsInput(`
wed 10:00-16:00
mon 09:00-17:00
mon 09:00-17:00
fri 09:30 to 12:30
`);

  assert.deepEqual(periods, [
    { day: "mon", opens: "09:00", closes: "17:00" },
    { day: "wed", opens: "10:00", closes: "16:00" },
    { day: "fri", opens: "09:30", closes: "12:30" },
  ]);
});

test("parseWeeklyPeriodsInput rejects invalid lines", () => {
  assert.throws(
    () => parseWeeklyPeriodsInput("monday 09:00-17:00"),
    /Invalid period at line 1/,
  );
});

test("parseWeeklyPeriodsInput rejects overlapping periods for a day", () => {
  assert.throws(
    () =>
      parseWeeklyPeriodsInput(`
mon 09:00-12:00
mon 11:00-14:00
`),
    /Overlapping periods found for mon/,
  );
});

test("parseClosedDaysInput deduplicates and sorts weekdays", () => {
  const closedDays = parseClosedDaysInput(["fri", "mon", "fri", "sun"]);
  assert.deepEqual(closedDays, ["sun", "mon", "fri"]);
});

test("parseClosedDaysInput rejects invalid weekdays", () => {
  assert.throws(
    () => parseClosedDaysInput(["holiday"]),
    /Invalid closed day "holiday"/,
  );
});

test("formatWeeklyPeriods renders expected textarea format", () => {
  const rendered = formatWeeklyPeriods([
    { day: "thu", opens: "10:00", closes: "16:00" },
    { day: "tue", opens: "09:00", closes: "12:00" },
  ]);
  assert.equal(rendered, "tue 09:00-12:00\nthu 10:00-16:00");
});
