#!/usr/bin/env tsx
import "./_env";

import { parseArgs } from "./_cli";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

/**
 * Grant the admin role to a Firebase Auth user.
 *
 * `firestore.rules` denies all client writes to /users (so users cannot
 * self-promote). This script uses the Firebase Admin SDK to set
 * `users/{uid}.role = "admin"`, which is what `requireAdminUser` checks.
 *
 * Usage:
 *   npm run grant:admin -- --uid <firebase-uid>
 *   npm run grant:admin -- --email <user@example.com>
 *   npm run grant:admin -- --email <user@example.com> --dry-run
 *
 * The user must already exist in Firebase Auth (i.e. they have signed in
 * at least once). Run with `--dry-run` to verify the resolved uid/email
 * before writing.
 */

async function main() {
  const args = parseArgs();
  const uidArg = stringArg(args.uid);
  const emailArg = stringArg(args.email);
  const dryRun = Boolean(args["dry-run"]);

  if (!uidArg && !emailArg) {
    console.error(
      "Usage: npm run grant:admin -- --uid <firebase-uid>\n" +
        "       npm run grant:admin -- --email <user@example.com>\n" +
        "       (add --dry-run to preview without writing)",
    );
    process.exit(1);
  }

  const auth = getAdminAuth();
  const userRecord = uidArg
    ? await auth.getUser(uidArg)
    : await auth.getUserByEmail(emailArg!);

  const uid = userRecord.uid;
  const email = userRecord.email ?? null;

  console.log(
    `[grantAdmin] target uid=${uid} email=${email ?? "<none>"} dryRun=${dryRun}`,
  );

  if (dryRun) {
    console.log("[grantAdmin] dry-run — no Firestore writes performed.");
    return;
  }

  await getAdminDb()
    .collection(COLLECTIONS.users)
    .doc(uid)
    .set(
      {
        uid,
        email,
        role: "admin",
        updated_at: Date.now(),
      },
      { merge: true },
    );

  console.log(
    `[grantAdmin] done — ${email ?? uid} can now reach /admin once their next request hits the server.`,
  );
}

function stringArg(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

main().catch((err) => {
  console.error("[grantAdmin] failed:", err);
  process.exit(1);
});
