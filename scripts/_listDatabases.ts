import "./_env";

async function main() {
  const { GoogleAuth } = await import("google-auth-library");
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  const auth = new GoogleAuth({
    keyFile: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases`;
  const res = await client.request<{ databases: Array<{ name: string; type: string; locationId: string }> }>({ url });

  console.log("project:", projectId);
  console.log("databases:");
  for (const db of res.data.databases ?? []) {
    const id = db.name.split("/").pop();
    console.log(`  - id="${id}"  type=${db.type}  location=${db.locationId}`);
  }
  if (!res.data.databases?.length) {
    console.log("  (none — Firestore has not been initialized in this project)");
  }
}

main().catch((err) => {
  console.error("failed:", err.message ?? err);
  process.exit(1);
});
