import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { getAdminAuth } from "@/lib/firebase/admin";

interface RequestUserIdDependencies {
  getCurrentUser: () => Promise<CurrentUser | null>;
  verifyIdToken: (
    idToken: string,
    checkRevoked: boolean,
  ) => Promise<{ uid?: string | null }>;
}

const defaultDependencies: RequestUserIdDependencies = {
  getCurrentUser,
  verifyIdToken: (idToken, checkRevoked) =>
    getAdminAuth().verifyIdToken(idToken, checkRevoked),
};

export async function resolveRequestUserId(
  request: Request,
  deps: RequestUserIdDependencies = defaultDependencies,
): Promise<string | null> {
  const bearerToken = readBearerToken(request);
  if (bearerToken) {
    try {
      const decoded = await deps.verifyIdToken(bearerToken, true);
      return normaliseUid(decoded.uid);
    } catch {
      return null;
    }
  }

  const fromCookie = await deps.getCurrentUser();
  return normaliseUid(fromCookie?.uid);
}

function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

function normaliseUid(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
