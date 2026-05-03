import AdminPlaceholderPage from "@/app/admin/_components/AdminPlaceholderPage";

export default function AdminAttractionsPage() {
  return (
    <AdminPlaceholderPage
      title="Attractions admin"
      description="Use this section to inspect attraction records before they are exposed in itinerary output."
      nextSteps={[
        "List attractions with source_type, confidence, and last fetched timestamp.",
        "Flag records that still rely on mock or estimated metadata.",
        "Provide manual verify/reject actions for high-impact attractions.",
      ]}
    />
  );
}
