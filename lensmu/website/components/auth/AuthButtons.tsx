"use client";

import { LogIn, LogOut, UserRound } from "lucide-react";

import { useUser } from "@auth0/nextjs-auth0/client";

import { useAuthAvailability } from "@/components/auth/AppAuthProvider";
import { Button } from "@/components/ui/button";

function getDisplayName(name?: string | null, email?: string | null) {
  if (name && name.trim()) {
    return name.trim();
  }

  if (email && email.trim()) {
    return email.trim();
  }

  return "Signed in";
}

function ConfiguredAuthButtons() {
  const { user, isLoading, error } = useUser();

  if (isLoading) {
    return (
      <Button variant="outline" className="rounded-full px-5 shadow-sm" disabled>
        Checking account...
      </Button>
    );
  }

  if (!user || error) {
    return (
      <Button variant="outline" className="rounded-full px-5 shadow-sm" asChild>
        <a href="/auth/login">
          <LogIn className="h-4 w-4" />
          Sign In
        </a>
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="hidden items-center gap-2 rounded-full border border-border/50 bg-card/80 px-4 py-2 text-sm text-muted-foreground lg:flex">
        <UserRound className="h-4 w-4" />
        <span className="max-w-40 truncate">
          {getDisplayName(user.name, user.email)}
        </span>
      </div>

      <Button variant="dark" className="rounded-full px-5 shadow-sm" asChild>
        <a href="/auth/logout">
          <LogOut className="h-4 w-4" />
          Sign Out
        </a>
      </Button>
    </div>
  );
}

export function AuthButtons() {
  const authEnabled = useAuthAvailability();

  if (!authEnabled) {
    return null;
  }

  return <ConfiguredAuthButtons />;
}
