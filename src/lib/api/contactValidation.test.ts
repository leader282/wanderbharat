import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTACT_MESSAGE_MAX_LENGTH,
  contactSubmissionSchema,
} from "@/lib/api/contactValidation";

const validPayload = {
  name: "Aritra",
  email: "traveler@example.com",
  queryType: "Trip help",
  destinationOrRegion: "Sikkim",
  tripDates: "10-16 Jun 2026",
  numberOfPeople: "4",
  budget: "INR 40,000 to 60,000",
  message:
    "Need help building a 6-day itinerary with a moderate budget and family-friendly stops.",
  consent: true,
  company: "",
};

test("contactSubmissionSchema accepts a valid payload", () => {
  const result = contactSubmissionSchema.safeParse(validPayload);
  assert.equal(result.success, true);
  if (!result.success) return;

  assert.equal(result.data.numberOfPeople, 4);
});

test("contactSubmissionSchema rejects invalid email addresses", () => {
  const result = contactSubmissionSchema.safeParse({
    ...validPayload,
    email: "invalid-email",
  });
  assert.equal(result.success, false);
});

test("contactSubmissionSchema enforces message minimum length", () => {
  const result = contactSubmissionSchema.safeParse({
    ...validPayload,
    message: "Too short",
  });
  assert.equal(result.success, false);
});

test("contactSubmissionSchema rejects overlong messages", () => {
  const result = contactSubmissionSchema.safeParse({
    ...validPayload,
    message: "x".repeat(CONTACT_MESSAGE_MAX_LENGTH + 1),
  });
  assert.equal(result.success, false);
});

test("contactSubmissionSchema requires consent", () => {
  const result = contactSubmissionSchema.safeParse({
    ...validPayload,
    consent: false,
  });
  assert.equal(result.success, false);
});

test("contactSubmissionSchema accepts optional turnstile token", () => {
  const result = contactSubmissionSchema.safeParse({
    ...validPayload,
    turnstileToken: " test-token ",
  });
  assert.equal(result.success, true);
  if (!result.success) return;

  assert.equal(result.data.turnstileToken, "test-token");
});
