export const DEFAULT_REQUEST_TIMEOUT_MS: number;
export const DEFAULT_MAX_RESPONSE_BYTES: number;

export class RequestTimeoutError extends Error {
  timeoutMs: number;
}

export class ResponseTooLargeError extends Error {
  maxBytes: number;
}

export function isAbortError(error: unknown): boolean;
export function isTimeoutError(error: unknown): boolean;

/** The whole exchange, already read within the deadline. */
export type FetchResult = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  url: string;
  bytes: Uint8Array;
  /** Decoded body, or undefined when `as: "bytes"` was requested. */
  text: string | undefined;
  /** Parsed body, or undefined when the payload is not JSON. */
  json: unknown;
};

export type FetchWithTimeoutOptions = {
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** "bytes" skips text/JSON decoding for binary payloads. */
  as?: 'bytes';
};

export function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: FetchWithTimeoutOptions
): Promise<FetchResult>;
