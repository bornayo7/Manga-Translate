import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { ApiAuthError, authenticateRequest } from "@/lib/api-auth";
import { applyCorsHeaders, buildCorsHeaders } from "@/lib/extension-cors";
import {
  findSensitiveKeys,
  formatValidationError,
  parsePreferenceEnvelope,
} from "@/lib/preferences-schema";
import {
  getUserPreferenceEnvelope,
  saveUserPreferenceEnvelope,
} from "@/lib/preferences-store";

function jsonResponse(
  request: NextRequest,
  payload: Record<string, unknown>,
  status = 200
) {
  return applyCorsHeaders(NextResponse.json(payload, { status }), request);
}

export function OPTIONS(request: NextRequest) {
  const headers = buildCorsHeaders(request);

  if (!headers["Access-Control-Allow-Origin"]) {
    return new NextResponse(null, { status: 403 });
  }

  return new NextResponse(null, {
    status: 204,
    headers,
  });
}

export async function GET(request: NextRequest) {
  try {
    const user = await authenticateRequest(request, "read:preferences");
    const preferenceState = await getUserPreferenceEnvelope(user.sub);

    return jsonResponse(request, {
      ...preferenceState.envelope,
      hasStoredPreferences: preferenceState.hasStoredPreferences,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return jsonResponse(request, { error: error.message }, error.status);
    }

    console.error("[VisionTranslate] GET /api/preferences failed:", error);
    return jsonResponse(
      request,
      { error: "Could not load preferences from Auth0 right now." },
      500
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await authenticateRequest(request, "write:preferences");
    const payload = await request.json();
    const sensitiveKeys = findSensitiveKeys(payload);

    if (sensitiveKeys.length > 0) {
      return jsonResponse(
        request,
        {
          error: `These settings are local-only and cannot be synced: ${sensitiveKeys.join(
            ", "
          )}.`,
        },
        400
      );
    }

    const parsedPayload = parsePreferenceEnvelope(payload);
    const savedEnvelope = await saveUserPreferenceEnvelope(
      user.sub,
      parsedPayload.preferences
    );

    return jsonResponse(request, {
      ...savedEnvelope,
      hasStoredPreferences: true,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return jsonResponse(request, { error: error.message }, error.status);
    }

    if (error instanceof ZodError) {
      return jsonResponse(
        request,
        { error: formatValidationError(error) },
        400
      );
    }

    if (error instanceof SyntaxError) {
      return jsonResponse(request, { error: "Request body must be valid JSON." }, 400);
    }

    console.error("[VisionTranslate] PUT /api/preferences failed:", error);
    return jsonResponse(
      request,
      { error: "Could not save preferences to Auth0 right now." },
      500
    );
  }
}
