import AdminPlaceholderPage from "@/app/admin/_components/AdminPlaceholderPage";

export default function AdminAttractionCostsPage() {
  return (
    <AdminPlaceholderPage
      title="Attraction admission costs"
      description="This panel will track ticket-price coverage while preserving unknown costs as unknown values."
      nextSteps={[
        "Separate unknown from zero to avoid fake certainty in trip budgets.",
        "Display per-audience pricing (adult, child, domestic, international).",
        "Add provenance notes for manual overrides and verified sources.",
      ]}
    />
  );
}
