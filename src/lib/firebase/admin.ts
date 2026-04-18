import { readFileSync } from "node:fs";
import {
  cert,
  getApp,
  getApps,
  initializeApp,
  applicationDefault,
  type App,
  type ServiceAccount,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Server-only Firebase Admin bootstrap.
 *
 * Credentials resolution order:
 *   1. FIREBASE_SERVICE_ACCOUNT_JSON (inline JSON, good for Vercel)
 *   2. FIREBASE_SERVICE_ACCOUNT_PATH (file path, good for local dev)
 *   3. GOOGLE_APPLICATION_CREDENTIALS via applicationDefault() (Google Cloud)
 */
function resolveServiceAccount(): ServiceAccount | null {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) {
    try {
      return JSON.parse(inline) as ServiceAccount;
    } catch (err) {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ${(err as Error).message}`,
      );
    }
  }

  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  if (path) {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as ServiceAccount;
  }

  return null;
}

let cachedApp: App | null = null;

export function getAdminApp(): App {
  if (cachedApp) return cachedApp;
  if (getApps().length) {
    cachedApp = getApp();
    return cachedApp;
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  const serviceAccount = resolveServiceAccount();

  cachedApp = initializeApp({
    credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
    projectId,
  });

  return cachedApp;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

const databaseId = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID?.trim();

let cachedDb: Firestore | null = null;

export function getAdminDb(): Firestore {
  if (cachedDb) return cachedDb;
  const app = getAdminApp();
  // firebase-admin 13+ supports passing a named database id.
  cachedDb = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  return cachedDb;
}

/**
 * Wrap a Firestore call so that gRPC `NOT_FOUND` errors (database id
 * doesn't exist / Firestore not provisioned) surface as a clear, actionable
 * message instead of a 50-line gRPC stack trace.
 */
export async function withFirestoreDiagnostics<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const e = err as { code?: number; message?: string };
    if (e?.code === 5) {
      const projectId =
        process.env.FIREBASE_PROJECT_ID ||
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
        "<unset>";
      const dbId = databaseId || "(default)";
      throw new Error(
        `[${label}] Firestore NOT_FOUND. ` +
          `Project "${projectId}" has no database with id "${dbId}". ` +
          `Fix: create it at https://console.firebase.google.com/project/${projectId}/firestore ` +
          `or clear NEXT_PUBLIC_FIREBASE_DATABASE_ID in .env.local to use the default DB.`,
      );
    }
    throw err;
  }
}
