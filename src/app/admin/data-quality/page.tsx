import AdminPlaceholderPage from "@/app/admin/_components/AdminPlaceholderPage";

export default function AdminDataQualityPage() {
  return (
    <AdminPlaceholderPage
      title="Data quality dashboard"
      description="Coverage and confidence monitoring will live here. This page is now wired behind admin auth and ready for quality widgets."
      nextSteps={[
        "Show counts by confidence bucket: live, verified, cached, estimated, unknown.",
        "Highlight stale snapshots and missing provenance metadata.",
        "Add per-region filters, starting with a narrow Rajasthan pilot.",
      ]}
    />
  );
}
