// Maps a jose verification failure onto an HTTP outcome for the
// preferences API. Kept as plain JavaScript (with a .d.ts twin) so it can be
// exercised by `node --test` against real jose errors without a TypeScript
// toolchain; api-auth.ts is the only production caller.
//
//   401  the caller presented a token we will not accept: malformed,
//        expired, signed by an unknown key, wrong issuer or audience
//   503  we could not check the token at all: the JWKS could not be fetched
//        or was unusable (Auth0 or the network is the problem, not the caller)
//   null anything else — the caller keeps its generic 500 path
//
// Messages are deliberately generic: which claim failed, or the token
// itself, is never echoed back.

import { errors } from "jose";

const INVALID_TOKEN_ERRORS = [
  errors.JWSSignatureVerificationFailed,
  errors.JWSInvalid,
  errors.JWTInvalid,
  errors.JWKSNoMatchingKey,
  errors.JWKSMultipleMatchingKeys,
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
];

const JWKS_UNAVAILABLE_ERRORS = [errors.JWKSTimeout, errors.JWKSInvalid];

export function mapTokenVerificationError(error) {
  if (!error || typeof error !== "object") {
    return null;
  }

  if (error instanceof errors.JWTExpired) {
    return { status: 401, message: "Bearer token has expired." };
  }

  if (error instanceof errors.JWTClaimValidationFailed) {
    // Issuer, audience, nbf/iat and similar claim checks.
    return { status: 401, message: "Bearer token is not valid for this API." };
  }

  if (INVALID_TOKEN_ERRORS.some((errorClass) => error instanceof errorClass)) {
    return { status: 401, message: "Bearer token is invalid." };
  }

  if (JWKS_UNAVAILABLE_ERRORS.some((errorClass) => error instanceof errorClass)) {
    return { status: 503, message: "Could not verify the bearer token against Auth0 right now." };
  }

  // createRemoteJWKSet surfaces a failed key fetch as the runtime's fetch
  // error (a TypeError in Node and browsers), not as a JOSEError.
  if (error instanceof TypeError && /fetch/i.test(String(error.message))) {
    return { status: 503, message: "Could not reach Auth0 to verify the bearer token." };
  }

  return null;
}
