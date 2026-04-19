import type { TravellerComposition } from "@/types/domain";

const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function formatTravellerParty(
  travellers: TravellerComposition,
  options?: { joiner?: string },
): string {
  const parts = [
    `${travellers.adults} adult${travellers.adults === 1 ? "" : "s"}`,
  ];
  if (travellers.children > 0) {
    parts.push(
      `${travellers.children} ${
        travellers.children === 1 ? "child" : "children"
      }`,
    );
  }
  return parts.join(options?.joiner ?? " + ");
}

export function makeMoneyFormatter(currency: string) {
  try {
    const nf = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    });
    return (value: number) => nf.format(Math.max(0, Number(value) || 0));
  } catch {
    return (value: number) =>
      `${currency} ${Math.round(
        Math.max(0, Number(value) || 0),
      ).toLocaleString("en-IN")}`;
  }
}

export function titleCaseWords(value: string): string {
  return value
    .split(/[_\s-]+/)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

export function formatClockTimeLabel(
  value: string | undefined,
  fallback = "09:00",
): string {
  const raw = value && CLOCK_TIME_PATTERN.test(value) ? value : fallback;
  const [hours, minutes] = raw.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hours12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hours12}:${minutes.toString().padStart(2, "0")} ${period}`;
}
