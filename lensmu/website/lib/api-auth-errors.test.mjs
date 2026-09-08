import test from "node:test";
import assert from "node:assert/strict";

import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify } from "jose";

import { mapTokenVerificationError } from "./api-auth-errors.js";

// Real jose errors, produced the way api-auth.ts produces them: sign a token
// with a local key and verify it against a JWKS with the expected issuer and
// audience. Only the key source differs from production (local vs remote).
const ISSUER = "https://tenant.example.auth0.com/";
const AUDIENCE = "https://visiontranslate/preferences-api";

const { privateKey, publicKey } = await generateKeyPair("RS256");
const { privateKey: strangerKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const jwks = createLocalJWKSet({ keys: [jwk] });

async function sign(claims = {}, { key = privateKey, kid = "k1", expiresIn = "1h" } = {}) {
  const builder = new SignJWT({ scope: "read:preferences", ...claims })
    .setProtectedHeader({ alg: "RS256", kid })
    .setSubject("auth0|user-1")
    .setIssuedAt();
  if (!("iss" in claims)) builder.setIssuer(ISSUER);
  if (!("aud" in claims)) builder.setAudience(AUDIENCE);
  if (expiresIn) builder.setExpirationTime(expiresIn);
  return builder.sign(key);
}

async function verificationError(token) {
  try {
    await jwtVerify(token, jwks, { issuer: ISSUER, audience: AUDIENCE });
  } catch (error) {
    return error;
  }
  throw new Error("expected verification to fail");
}

test("a valid token verifies and maps to nothing", async () => {
  const token = await sign();
  const { payload } = await jwtVerify(token, jwks, { issuer: ISSUER, audience: AUDIENCE });
  assert.equal(payload.sub, "auth0|user-1");
  assert.equal(mapTokenVerificationError(null), null);
});

test("an expired token is a 401", async () => {
  const token = await sign({ exp: Math.floor(Date.now() / 1000) - 60 }, { expiresIn: null });
  const mapped = mapTokenVerificationError(await verificationError(token));
  assert.deepEqual(mapped, { status: 401, message: "Bearer token has expired." });
});

test("wrong issuer and wrong audience are 401s that do not name the claim", async () => {
  const wrongIssuer = mapTokenVerificationError(await verificationError(await sign({ iss: "https://evil.example/" })));
  const wrongAudience = mapTokenVerificationError(await verificationError(await sign({ aud: "https://other-api" })));
  for (const mapped of [wrongIssuer, wrongAudience]) {
    assert.equal(mapped.status, 401);
    assert.doesNotMatch(mapped.message, /iss|aud|issuer|audience/i);
  }
});

test("a token signed by an unknown key, an unknown kid, and garbage are 401s", async () => {
  const badSignature = await sign({}, { key: strangerKey });
  const unknownKid = await sign({}, { kid: "nope" });
  for (const token of [badSignature, unknownKid, "not.a.jwt", "a.b.c"]) {
    const mapped = mapTokenVerificationError(await verificationError(token));
    assert.equal(mapped.status, 401, `token ${token.slice(0, 12)}…`);
    assert.equal(mapped.message.includes(token.slice(0, 20)), false, "the token is never echoed");
  }
});

test("a JWKS that cannot be fetched or used is a 503, and unrelated errors stay unmapped", async () => {
  const { errors } = await import("jose");
  assert.equal(mapTokenVerificationError(new errors.JWKSTimeout()).status, 503);
  assert.equal(mapTokenVerificationError(new errors.JWKSInvalid()).status, 503);
  assert.equal(mapTokenVerificationError(new TypeError("fetch failed")).status, 503);
  assert.equal(mapTokenVerificationError(new Error("Auth0 Management API quota exceeded")), null);
  assert.equal(mapTokenVerificationError(new TypeError("x is not a function")), null);
});
