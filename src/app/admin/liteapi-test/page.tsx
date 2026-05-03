import AdminPlaceholderPage from "@/app/admin/_components/AdminPlaceholderPage";

export default function AdminLiteApiTestPage() {
  return (
    <AdminPlaceholderPage
      title="LiteAPI test console"
      description="Use this page to validate provider requests and inspect parsed payloads before writing snapshots."
      nextSteps={[
        "Run on-demand hotel search probes with explicit trip dates and party composition.",
        "Render raw provider status + transformed snapshot preview side-by-side.",
        "Capture request/response diagnostics for failed provider calls.",
      ]}
    />
  );
}
