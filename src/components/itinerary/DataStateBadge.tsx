import type { DataConfidence } from "@/types/domain";
import { formatDataConfidenceLabel } from "@/types/domain";

const TONE_BY_STATE: Record<DataConfidence, string> = {
  live: "border-emerald-200 bg-emerald-50 text-emerald-900",
  verified: "border-emerald-200 bg-emerald-50 text-emerald-900",
  cached: "border-sky-200 bg-sky-50 text-sky-900",
  estimated:
    "border-[var(--hairline-strong)] bg-[var(--color-sand-50)] text-[var(--color-ink-700)]",
  unknown:
    "border-[var(--hairline)] bg-white text-[var(--color-ink-500)] italic",
};

export default function DataStateBadge({
  state,
  size = "sm",
}: {
  state: DataConfidence;
  size?: "xs" | "sm";
}) {
  const sizeClass =
    size === "xs"
      ? "px-1.5 py-0.5 text-[0.62rem] tracking-[0.16em]"
      : "px-2 py-0.5 text-[0.68rem] tracking-[0.18em]";

  return (
    <span
      className={`inline-flex items-center rounded-full border font-semibold uppercase ${sizeClass} ${TONE_BY_STATE[state]}`}
      aria-label={`Data state: ${formatDataConfidenceLabel(state)}`}
    >
      {formatDataConfidenceLabel(state)}
    </span>
  );
}
