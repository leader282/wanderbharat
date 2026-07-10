import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rules = readFileSync("firestore.rules", "utf8");

function itineraryRulesBlock(): string {
  const matchStart = rules.indexOf("match /itineraries/{itineraryId}");
  assert.notEqual(matchStart, -1, "itineraries rules block is missing");

  const declarationEnd = rules.indexOf("\n", matchStart);
  assert.notEqual(declarationEnd, -1, "itineraries rules block is malformed");

  const blockStart = rules.lastIndexOf("{", declarationEnd);
  assert.notEqual(blockStart, -1, "itineraries rules block is malformed");

  let depth = 0;
  for (let index = blockStart; index < rules.length; index += 1) {
    const char = rules[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return rules.slice(blockStart + 1, index);
    }
  }

  assert.fail("itineraries rules block is not closed");
}

test("itinerary rules allow direct reads but deny client-side listing", () => {
  const block = itineraryRulesBlock();

  assert.match(block, /allow get:\s*if\s+isGuestItinerary\(\)\s*\|\|\s*isItineraryOwner\(\);/);
  assert.match(block, /allow list:\s*if\s+false;/);
  assert.doesNotMatch(block, /allow read:/);
});

test("itinerary and user writes remain server-only", () => {
  const itineraryBlock = itineraryRulesBlock();

  assert.match(itineraryBlock, /allow write:\s*if\s+false;/);
  assert.match(rules, /match \/users\/\{userId\}\s*\{[^}]*allow write:\s*if\s+false;/s);
});
