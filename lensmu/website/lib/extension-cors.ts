import type { NextRequest, NextResponse } from "next/server";

const CORS_METHODS = "GET,PUT,OPTIONS";
const CORS_HEADERS = "Authorization, Content-Type";

function getAllowedOrigins() {
  return new Set(
    (process.env.VT_EXTENSION_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

export function buildCorsHeaders(request: NextRequest) {
  const origin = request.headers.get("origin");

  if (!origin) {
    return {};
  }

  const allowedOrigins = getAllowedOrigins();

  if (!allowedOrigins.has(origin)) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": CORS_METHODS,
    "Access-Control-Allow-Headers": CORS_HEADERS,
    Vary: "Origin",
  };
}

export function applyCorsHeaders(response: NextResponse, request: NextRequest) {
  const headers = buildCorsHeaders(request);

  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }

  return response;
}
