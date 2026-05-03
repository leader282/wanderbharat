import AdminPlaceholderPage from "@/app/admin/_components/AdminPlaceholderPage";

export default function AdminImportExportPage() {
  return (
    <AdminPlaceholderPage
      title="Import / export and reseed"
      description="Operational workflows for purge, reseed, and dataset movement will be controlled from this section."
      nextSteps={[
        "Add guarded purge + reseed actions for prototype environments only.",
        "Generate audit logs for every import/export execution.",
        "Support selective region re-import to keep Rajasthan iterations fast.",
      ]}
    />
  );
}
