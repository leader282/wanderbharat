import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getAdminAuth } from "@/lib/firebase/admin";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
} from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/session
 *
 * Exchange a freshly-minted Firebase ID token for an HTTP-only session
 * cookie. The client signs in with Google (popup), grabs the ID token,
 * and POSTs it here. We refuse stale tokens (>5 min) so a stolen token
 * can't be used to mint a long-lived cookie.
 */
export async function POST(request: Request) {
  let body: { idToken?: unknown };
  try {
    body = (await request.json()) as { idToken?: unknown };
  } catch {
    return NextResponse.json(
      { error: "invalid_input", message: "Body must be JSON." },
      { status: 400 },
    );
  }

  const idToken = typeof body.idToken === "string" ? body.idToken : "";
  if (!idToken) {
    return NextResponse.json(
      { error: "invalid_input", message: "Missing idToken." },
      { status: 400 },
    );
  }

  const auth = getAdminAuth();

  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json(
      { error: "invalid_token", message: "ID token is invalid or expired." },
      { status: 401 },
    );
  }

  // Only issue session cookies for tokens minted within the last 5 minutes.
  // Mirrors the Firebase docs' recommendation; protects against replay.
  const ageSeconds = Date.now() / 1000 - decoded.auth_time;
  if (ageSeconds > 5 * 60) {
    return NextResponse.json(
      { error: "stale_token", message: "Sign in again to continue." },
      { status: 401 },
    );
  }

  let sessionCookie: string;
  try {
    sessionCookie = await auth.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "session_failed", message: (err as Error).message },
      { status: 500 },
    );
  }

  const store = await cookies();
  store.set(
    SESSION_COOKIE_NAME,
    sessionCookie,
    sessionCookieOptions(SESSION_MAX_AGE_SECONDS),
  );

  return NextResponse.json(
    {
      user: {
        uid: decoded.uid,
        email: decoded.email ?? null,
        name: (decoded.name as string | undefined) ?? null,
        picture: (decoded.picture as string | undefined) ?? null,
      },
    },
    { status: 200 },
  );
}

/**
 * DELETE /api/auth/session — clear the session cookie. Client-side
 * Firebase sign-out happens separately so the SDK forgets the user too.
 */
export async function DELETE() {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, "", sessionCookieOptions(0));
  return NextResponse.json({ ok: true });
}
