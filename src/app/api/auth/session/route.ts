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

interface VerifiedIdToken {
  uid: string;
  auth_time: number;
  email?: string;
  name?: unknown;
  picture?: unknown;
}

interface SessionRouteDependencies {
  verifyIdToken: (
    idToken: string,
    checkRevoked: boolean,
  ) => Promise<VerifiedIdToken>;
  createSessionCookie: (
    idToken: string,
    options: { expiresIn: number },
  ) => Promise<string>;
  setSessionCookie: (value: string, maxAgeSeconds: number) => Promise<void>;
  nowSeconds?: () => number;
}

const defaultDependencies: SessionRouteDependencies = {
  verifyIdToken: (idToken, checkRevoked) =>
    getAdminAuth().verifyIdToken(idToken, checkRevoked),
  createSessionCookie: (idToken, options) =>
    getAdminAuth().createSessionCookie(idToken, options),
  setSessionCookie: setSessionCookieValue,
};

/**
 * POST /api/auth/session
 *
 * Exchange a freshly-minted Firebase ID token for an HTTP-only session
 * cookie. The client signs in with Google (popup), grabs the ID token,
 * and POSTs it here. We refuse stale tokens (>5 min) so a stolen token
 * can't be used to mint a long-lived cookie.
 */
export async function handleCreateSession(
  request: Request,
  deps: SessionRouteDependencies = defaultDependencies,
) {
  const requestGuard = validateStateChangingRequest(request);
  if (requestGuard) return requestGuard;

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

  let decoded;
  try {
    decoded = await deps.verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json(
      { error: "invalid_token", message: "ID token is invalid or expired." },
      { status: 401 },
    );
  }

  // Only issue session cookies for tokens minted within the last 5 minutes.
  // Mirrors the Firebase docs' recommendation; protects against replay.
  const nowSeconds = deps.nowSeconds?.() ?? Date.now() / 1000;
  const ageSeconds = nowSeconds - decoded.auth_time;
  if (ageSeconds > 5 * 60) {
    return NextResponse.json(
      { error: "stale_token", message: "Sign in again to continue." },
      { status: 401 },
    );
  }

  let sessionCookie: string;
  try {
    sessionCookie = await deps.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "session_failed", message: (err as Error).message },
      { status: 500 },
    );
  }

  await deps.setSessionCookie(sessionCookie, SESSION_MAX_AGE_SECONDS);

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

export async function POST(request: Request) {
  return handleCreateSession(request);
}

/**
 * DELETE /api/auth/session — clear the session cookie. Client-side
 * Firebase sign-out happens separately so the SDK forgets the user too.
 */
export async function handleDeleteSession(
  request: Request,
  deps: Pick<SessionRouteDependencies, "setSessionCookie"> = defaultDependencies,
) {
  const requestGuard = validateSameOriginRequest(request);
  if (requestGuard) return requestGuard;

  await deps.setSessionCookie("", 0);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  return handleDeleteSession(request);
}

async function setSessionCookieValue(
  value: string,
  maxAgeSeconds: number,
): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, value, sessionCookieOptions(maxAgeSeconds));
}

function validateStateChangingRequest(request: Request) {
  const sameOriginError = validateSameOriginRequest(request);
  if (sameOriginError) return sameOriginError;

  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return NextResponse.json(
      {
        error: "unsupported_media_type",
        message: "Content-Type must be application/json.",
      },
      { status: 415 },
    );
  }

  return null;
}

function validateSameOriginRequest(request: Request) {
  if (isSameOriginRequest(request)) return null;

  return NextResponse.json(
    {
      error: "csrf_rejected",
      message: "Cross-origin session requests are not allowed.",
    },
    { status: 403 },
  );
}

function isSameOriginRequest(request: Request): boolean {
  const requestOrigin = originFromUrl(request.url);
  if (!requestOrigin) return false;

  const origin = request.headers.get("origin");
  if (origin) return originFromUrl(origin) === requestOrigin;

  const referer = request.headers.get("referer");
  if (referer) return originFromUrl(referer) === requestOrigin;

  return true;
}

function originFromUrl(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
