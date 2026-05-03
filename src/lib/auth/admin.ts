import { type CurrentUser, getCurrentUser } from "@/lib/auth/session";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { getAdminDb, withFirestoreDiagnostics } from "@/lib/firebase/admin";

export interface AdminUser extends CurrentUser {
  role: "admin";
}

type UserRole = string | null;

interface RequireAdminUserDependencies {
  resolveCurrentUser?: () => Promise<CurrentUser | null>;
  resolveUserRole?: (uid: string) => Promise<UserRole>;
}

export type RequireAdminUserResult =
  | { ok: true; user: AdminUser }
  | { ok: false; reason: "unauthenticated" }
  | { ok: false; reason: "forbidden"; user: CurrentUser };

/**
 * Resolve the signed-in user and require `users/{uid}.role === "admin"`.
 * Access checks stay server-side so clients never decide admin privileges.
 */
export async function requireAdminUser(
  deps: RequireAdminUserDependencies = {},
): Promise<RequireAdminUserResult> {
  const resolveCurrentUser = deps.resolveCurrentUser ?? getCurrentUser;
  const resolveUserRole = deps.resolveUserRole ?? getUserRoleFromFirestore;

  const currentUser = await resolveCurrentUser();
  if (!currentUser) {
    return { ok: false, reason: "unauthenticated" };
  }

  const role = normaliseRole(await resolveUserRole(currentUser.uid));
  if (role === "admin") {
    return {
      ok: true,
      user: {
        ...currentUser,
        role: "admin",
      },
    };
  }

  return { ok: false, reason: "forbidden", user: currentUser };
}

export async function getUserRoleFromFirestore(uid: string): Promise<string | null> {
  if (!uid) return null;

  return withFirestoreDiagnostics("getUserRoleFromFirestore", async () => {
    const snap = await getAdminDb().collection(COLLECTIONS.users).doc(uid).get();
    if (!snap.exists) return null;
    return normaliseRole(snap.get("role"));
  });
}

function normaliseRole(role: unknown): string | null {
  if (typeof role !== "string") return null;
  const normalized = role.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}
