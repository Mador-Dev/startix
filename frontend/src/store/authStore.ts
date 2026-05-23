// Auth state is now provided by Clerk via useAuth() and useUser().
// This module re-exports a compatibility hook so call sites need minimal changes.

import { useAuth } from "@clerk/react";

export function useAuthStore<T>(selector: (s: { userId: string | null; isAuthenticated: boolean }) => T): T {
  const { userId, isSignedIn } = useAuth();
  return selector({ userId: userId ?? null, isAuthenticated: isSignedIn ?? false });
}
