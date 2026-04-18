"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";

import { getFirebaseAuth } from "@/lib/firebase/client";

export interface AuthUser {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  /** True until we've heard from Firebase at least once. */
  loading: boolean;
  /** Last error from sign-in / sign-out, if any. */
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Get a fresh Firebase ID token for the current user, or `null` if
   * signed out. Used by the planner to authenticate API requests.
   */
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toAuthUser(user: User | null): AuthUser | null {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    name: user.displayName,
    picture: user.photoURL,
  };
}

export function AuthProvider({
  children,
  initialUser = null,
}: {
  children: React.ReactNode;
  /**
   * Hydrate from the verified server cookie so the header doesn't flash
   * "Sign in" before Firebase rehydrates from local storage.
   */
  initialUser?: AuthUser | null;
}) {
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [loading, setLoading] = useState<boolean>(initialUser === null);
  const [error, setError] = useState<string | null>(null);

  // Track the last uid we synced with the server cookie so we don't
  // POST /api/auth/session on every silent token refresh.
  const lastSyncedUid = useRef<string | null>(initialUser?.uid ?? null);

  useEffect(() => {
    const auth = getFirebaseAuth();

    const unsub = onIdTokenChanged(auth, async (fbUser) => {
      setUser(toAuthUser(fbUser));
      setLoading(false);

      if (!fbUser) {
        if (lastSyncedUid.current !== null) {
          lastSyncedUid.current = null;
          try {
            await fetch("/api/auth/session", { method: "DELETE" });
          } catch {
            // Best-effort — cookie will eventually expire.
          }
        }
        return;
      }

      if (lastSyncedUid.current === fbUser.uid) return;

      try {
        // Force-refresh so the ID token is fresh enough to mint a
        // session cookie (server enforces a 5-minute window).
        const idToken = await fbUser.getIdToken(true);
        const res = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        });
        if (res.ok) {
          lastSyncedUid.current = fbUser.uid;
        }
      } catch {
        // Server-side itinerary listing won't work until next sign-in,
        // but the client UI keeps functioning.
      }
    });

    return () => unsub();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    try {
      const auth = getFirebaseAuth();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
      // onIdTokenChanged handles the cookie sync.
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        // User just dismissed the popup — not actually an error.
        return;
      }
      setError(friendlyAuthError(code, (err as Error).message));
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await firebaseSignOut(getFirebaseAuth());
      // onIdTokenChanged clears the server cookie.
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const getIdToken = useCallback(async () => {
    const auth = getFirebaseAuth();
    const fbUser = auth.currentUser;
    if (!fbUser) return null;
    try {
      return await fbUser.getIdToken();
    } catch {
      return null;
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, error, signInWithGoogle, signOut, getIdToken }),
    [user, loading, error, signInWithGoogle, signOut, getIdToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>.");
  }
  return ctx;
}

function friendlyAuthError(code: string, fallback: string): string {
  switch (code) {
    case "auth/network-request-failed":
      return "We couldn't reach Google. Check your connection and try again.";
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in popup. Allow popups for this site and try again.";
    case "auth/account-exists-with-different-credential":
      return "An account already exists with this email under a different sign-in method.";
    case "auth/unauthorized-domain":
      return "This domain isn't authorised for Google sign-in. Add it in Firebase Console → Authentication → Settings.";
    default:
      return fallback || "Sign-in failed. Please try again.";
  }
}
