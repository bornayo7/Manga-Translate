"use client";

import type { ReactNode } from "react";
import { createContext, useContext } from "react";

import { Auth0Provider } from "@auth0/nextjs-auth0/client";
import type { User } from "@auth0/nextjs-auth0/types";

const AuthAvailabilityContext = createContext(false);

export function AppAuthProvider({
  authEnabled,
  user,
  children,
}: {
  authEnabled: boolean;
  user?: User | null;
  children: ReactNode;
}) {
  return (
    <AuthAvailabilityContext.Provider value={authEnabled}>
      {authEnabled ? <Auth0Provider user={user || undefined}>{children}</Auth0Provider> : children}
    </AuthAvailabilityContext.Provider>
  );
}

export function useAuthAvailability() {
  return useContext(AuthAvailabilityContext);
}
