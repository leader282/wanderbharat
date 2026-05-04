import { MAX_TRIP_DAYS } from "@/lib/itinerary/planningLimits";
import { makeMoneyFormatter } from "@/lib/itinerary/presentation";

interface ValidationIssue {
  path?: string;
  message?: string;
}

interface ValidationDetails {
  formErrors?: string[];
  fieldErrors?: Record<string, string[] | undefined>;
}

interface BudgetConstraintDetails {
  estimated_cost?: unknown;
  excess?: unknown;
  budget?: {
    min?: unknown;
    max?: unknown;
    currency?: unknown;
  };
}

interface GenerateItineraryErrorPayload {
  error?: string;
  reason?: string;
  message?: string;
  suggestion?: string;
  details?: unknown;
  issues?: ValidationIssue[];
}

const REASON_MESSAGES: Record<string, string> = {
  travel_time_exceeded:
    "This trip needs more travel time than your selected pace allows. Try a faster pace, fewer stops, or another day.",
  total_time_exceeded:
    "At least one day runs longer than your selected pace allows. Try a faster pace, fewer stops, or another day.",
  budget_too_low:
    "This route comes in below the budget range attached to this request. Try adding another stop or another day.",
  budget_exceeded:
    "This trip is estimated above your total trip budget. Try increasing the budget, shortening the trip, or requesting fewer extra cities.",
  no_feasible_route:
    "We couldn't build a workable route from that starting city with these settings. Try a different start, fewer requested cities, or a longer trip.",
  insufficient_nodes:
    "There aren't enough destinations in this region yet to build the trip you described.",
  invalid_input: "Please double-check your trip details and try again.",
};

export function presentGenerateItineraryError(
  payload: unknown,
  status: number,
): string {
  const data = (payload ?? {}) as GenerateItineraryErrorPayload;

  if (data.reason === "requested_cities_uncovered" && data.message) {
    return [data.message, data.suggestion].filter(Boolean).join(" ");
  }

  if (data.reason === "budget_exceeded") {
    return messageForBudgetExceeded(data);
  }

  if (data.reason && REASON_MESSAGES[data.reason]) {
    return [REASON_MESSAGES[data.reason], data.suggestion]
      .filter(Boolean)
      .join(" ");
  }

  const validationMessage = firstValidationMessage(data);
  if (validationMessage) return validationMessage;

  if (status === 404) return "We couldn't find that itinerary.";
  if (status >= 500) {
    return "Something went wrong on our end. Please try again in a moment.";
  }
  if (data.message) return data.message;
  return "We couldn't build that itinerary. Please adjust your choices and try again.";
}

function firstValidationMessage(
  data: GenerateItineraryErrorPayload,
): string | null {
  const validationDetails = (data.details ?? {}) as ValidationDetails;
  const firstIssue = data.issues?.find((issue) => issue.message?.trim());
  if (firstIssue?.path) {
    const mapped = messageForIssuePath(firstIssue.path);
    if (mapped) return mapped;
  }
  if (firstIssue?.message) return firstIssue.message;

  const fieldEntries = Object.entries(validationDetails.fieldErrors ?? {});
  const firstFieldWithMessage = fieldEntries.find(([, messages]) =>
    Array.isArray(messages) ? messages.some(Boolean) : false,
  );
  if (firstFieldWithMessage) {
    const mapped = messageForIssuePath(firstFieldWithMessage[0]);
    if (mapped) return mapped;
    const firstFieldMessage = firstFieldWithMessage[1]?.find(Boolean);
    if (firstFieldMessage) return firstFieldMessage;
  }

  const firstFormMessage = validationDetails.formErrors?.find(Boolean);
  return firstFormMessage ?? null;
}

function messageForBudgetExceeded(data: GenerateItineraryErrorPayload): string {
  const budgetDetails = (data.details ?? {}) as BudgetConstraintDetails;
  const minimumBudget =
    readFiniteNumber(budgetDetails.estimated_cost) ??
    (() => {
      const maxBudget = readFiniteNumber(budgetDetails.budget?.max);
      const excess = readFiniteNumber(budgetDetails.excess);
      if (maxBudget === null || excess === null) return null;
      return maxBudget + excess;
    })();

  if (minimumBudget === null) {
    return REASON_MESSAGES.budget_exceeded;
  }

  const currency =
    typeof budgetDetails.budget?.currency === "string" &&
    budgetDetails.budget.currency.trim()
      ? budgetDetails.budget.currency
      : "INR";
  const formatMoney = makeMoneyFormatter(currency);
  return `This trip is estimated above your total trip budget. Increase it to at least ${formatMoney(minimumBudget)}, or try shortening the trip or requesting fewer extra cities.`;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function messageForIssuePath(path: string): string | null {
  switch (path) {
    case "regions":
      return "Pick at least one region.";
    case "start_node":
      return "Choose a starting city.";
    case "days":
      return `Trip length must be between 1 and ${MAX_TRIP_DAYS} days.`;
    case "preferences.trip_start_date":
      return "Choose a valid trip start date.";
    case "preferences.trip_end_date":
      return "Trip end date must match the selected start date and duration.";
    case "preferences.travellers.adults":
      return "Add at least one adult traveller.";
    case "preferences.travellers.children":
      return "Children can't be a negative number.";
    case "preferences.travellers.children_ages":
      return "Add a valid age for each child traveller.";
    case "preferences.travellers.rooms":
      return "Select at least one room.";
    case "preferences.travellers.guest_nationality":
      return "Enter a valid 2-letter guest nationality code.";
    case "preferences.transport_modes":
      return "Choose at least one transport mode.";
    case "preferences.preferred_start_time":
      return "Choose a valid day-start time.";
    case "preferences.accommodation_preference":
    case "preferences.accommodationPreference":
      return "Choose a valid accommodation preference.";
    default:
      if (path.startsWith("preferences.budget")) {
        return "Enter a valid non-negative budget.";
      }
      return null;
  }
}
