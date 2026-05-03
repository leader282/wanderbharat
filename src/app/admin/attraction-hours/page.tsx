import AdminPlaceholderPage from "@/app/admin/_components/AdminPlaceholderPage";

export default function AdminAttractionHoursPage() {
  return (
    <AdminPlaceholderPage
      title="Attraction opening hours"
      description="This view will manage opening-hours freshness and verification state for attraction-level schedules."
      nextSteps={[
        "Show resolved weekly hours and exceptional closures per attraction.",
        "Track unknown-hour records separately from verified schedules.",
        "Queue entries for refresh when snapshots exceed staleness thresholds.",
      ]}
    />
  );
}
