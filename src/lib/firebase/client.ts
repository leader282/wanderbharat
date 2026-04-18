import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

/**
 * Client-side Firebase bootstrap. Mirrors the pattern used across the
 * workspace: lazy init so SSR / build steps never touch the client SDK
 * without env being present.
 */
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

const firestoreDatabaseId = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID?.trim();

function getClientApp() {
  if (typeof window === "undefined") {
    throw new Error("Firebase client SDK is only available in the browser.");
  }
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export function getFirebaseAuth() {
  return getAuth(getClientApp());
}

export function getFirebaseDb() {
  const app = getClientApp();
  return firestoreDatabaseId
    ? getFirestore(app, firestoreDatabaseId)
    : getFirestore(app);
}
