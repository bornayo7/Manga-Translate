import "server-only";

import type { NextRequest } from "next/server";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import { auth0, getAuth0Domain } from "./auth0";

export class ApiAuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiAuthError";
    this.status = status;
  }
}

export type AuthenticatedRequestUser = {
  sub: string;
  name?: string;
  email?: string;
  source: "session" | "bearer";
  scopes: string[];
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getIssuerBaseUrl() {
  const domain = getAuth0Domain();

  if (!domain) {
    throw new ApiAuthError(
      503,
      "Auth0 is not configured on the website server."
    );
  }

  return `https://${domain}/`;
}

function getApiAudience() {
  const audience = (process.env.AUTH0_API_AUDIENCE || "").trim();

  if (!audience) {
    throw new ApiAuthError(
      503,
      "AUTH0_API_AUDIENCE is not configured for bearer-token API access."
    );
  }

  return audience;
}

function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${getIssuerBaseUrl()}.well-known/jwks.json`));
  }

  return jwks;
}

function readScopes(payload: JWTPayload) {
  const scope = typeof payload.scope === "string" ? payload.scope : "";
  return scope.split(" ").filter(Boolean);
}

async function authenticateBearerToken(
  token: string,
  requiredScope?: string
): Promise<AuthenticatedRequestUser> {
  const verification = await jwtVerify(token, getJwks(), {
    issuer: getIssuerBaseUrl(),
    audience: getApiAudience(),
  });
  const scopes = readScopes(verification.payload);

  if (requiredScope && !scopes.includes(requiredScope)) {
    throw new ApiAuthError(
      403,
      `Missing the required '${requiredScope}' scope for this request.`
    );
  }

  if (typeof verification.payload.sub !== "string" || !verification.payload.sub.trim()) {
    throw new ApiAuthError(401, "Bearer token is missing the Auth0 subject claim.");
  }

  return {
    sub: verification.payload.sub,
    name:
      typeof verification.payload.name === "string"
        ? verification.payload.name
        : undefined,
    email:
      typeof verification.payload.email === "string"
        ? verification.payload.email
        : undefined,
    source: "bearer",
    scopes,
  };
}

export async function authenticateRequest(
  request: NextRequest,
  requiredScope?: string
): Promise<AuthenticatedRequestUser> {
  const authorizationHeader = request.headers.get("authorization");

  if (authorizationHeader?.startsWith("Bearer ")) {
    return authenticateBearerToken(
      authorizationHeader.slice("Bearer ".length).trim(),
      requiredScope
    );
  }

  if (!auth0) {
    throw new ApiAuthError(
      503,
      "Auth0 sign-in is not configured on the website server."
    );
  }

  const session = await auth0.getSession(request);

  if (!session?.user?.sub) {
    throw new ApiAuthError(401, "Authentication is required.");
  }

  return {
    sub: session.user.sub,
    name: session.user.name,
    email: session.user.email,
    source: "session",
    scopes: [],
  };
}
