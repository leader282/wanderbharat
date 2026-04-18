// Server-only module — pulls firebase-admin + next/headers, both of
// which would crash in a client bundle if anyone imports this by accident.
import { cookies } from "next/headers";

import { getAdminAuth } from "@/lib/firebase/admin";

/**
 * Cookie name used for the Firebase session cookie. Kept short and
 * project-prefixed so it can coexist with other cookies and be cleared
 * deterministically.
 */
export const SESSION_COOKIE_NAME = "wb_session";

/**
 * Session lifetime. Firebase caps this at 14 days (1209600 seconds);
 * `createSessionCookie` rejects anything longer.
 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

export interface CurrentUser {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

/**
 * Server helper — read the session cookie, verify it with Firebase Admin,
 * and return the current user (or `null` if signed out / invalid). Safe
 * to call from server components, route handlers, and server actions.
 *
 * `checkRevoked = true` ensures we honour password resets / explicit
 * sign-outs from the Firebase console.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE_NAME)?.value;
  if (!value) return null;

  try {
    const decoded = await getAdminAuth().verifySessionCookie(value, true);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      name: (decoded.name as string | undefined) ?? null,
      picture: (decoded.picture as string | undefined) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Build the standard cookie options used for our session. Single source
 * of truth so set + clear stay in sync.
 */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
