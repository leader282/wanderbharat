import AdminPlaceholderPage from "@/app/admin/_components/AdminPlaceholderPage";

export default function AdminHotelsPage() {
  return (
    <AdminPlaceholderPage
      title="Hotels and rate snapshots"
      description="Hotel inventory health and cached-rate snapshots for the prototype will be surfaced here."
      nextSteps={[
        "Monitor LiteAPI ingest batches and per-city hotel coverage.",
        "Surface snapshot age for nightly rates used in itinerary budgeting.",
        "Flag hotels with incomplete traveller-capacity metadata.",
      ]}
    />
  );
}
