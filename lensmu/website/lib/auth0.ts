import { Auth0Client } from "@auth0/nextjs-auth0/server";

function readEnv(name: string) {
  return (process.env[name] || "").trim();
}

function normalizeDomain(value = "") {
  return value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export function getAuth0Domain() {
  return normalizeDomain(readEnv("AUTH0_DOMAIN") || readEnv("AUTH0_ISSUER_BASE_URL"));
}

const auth0Config = {
  domain: getAuth0Domain(),
  clientId: readEnv("AUTH0_CLIENT_ID"),
  clientSecret: readEnv("AUTH0_CLIENT_SECRET"),
  secret: readEnv("AUTH0_SECRET"),
  appBaseUrl: readEnv("APP_BASE_URL"),
};

const missingAuth0Env = [
  !auth0Config.domain ? "AUTH0_DOMAIN (or AUTH0_ISSUER_BASE_URL)" : null,
  !auth0Config.clientId ? "AUTH0_CLIENT_ID" : null,
  !auth0Config.clientSecret ? "AUTH0_CLIENT_SECRET" : null,
  !auth0Config.secret ? "AUTH0_SECRET" : null,
].filter((value): value is string => Boolean(value));

export const isAuth0Enabled = missingAuth0Env.length === 0;

const auth0WarningState = globalThis as typeof globalThis & {
  __visionTranslateAuth0WarningLogged?: boolean;
};

if (
  !isAuth0Enabled &&
  process.env.NODE_ENV !== "test" &&
  !auth0WarningState.__visionTranslateAuth0WarningLogged
) {
  console.warn(
    `[VisionTranslate] Auth0 is disabled for the website because required env vars are missing: ${missingAuth0Env.join(
      ", "
    )}. Public pages will still load, but sign-in and synced preferences will be unavailable.`
  );
  auth0WarningState.__visionTranslateAuth0WarningLogged = true;
}

export const auth0 = isAuth0Enabled
  ? new Auth0Client({
      domain: auth0Config.domain,
      clientId: auth0Config.clientId,
      clientSecret: auth0Config.clientSecret,
      secret: auth0Config.secret,
      appBaseUrl: auth0Config.appBaseUrl || undefined,
    })
  : null;
