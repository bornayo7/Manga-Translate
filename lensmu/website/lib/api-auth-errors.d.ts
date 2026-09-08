export function mapTokenVerificationError(
  error: unknown
): { status: 401 | 503; message: string } | null;
