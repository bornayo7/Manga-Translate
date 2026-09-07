export function normalizeForComparison(text: unknown): string;

export function isEffectivelyIdenticalTranslation(
  sourceText: unknown,
  translatedText: unknown
): boolean;

export function stripDataUrlPrefix(imageBase64: string): string;

export function toErrorMessage(error: unknown, fallback?: string): string;

export function describeHttpFailure(status: number, statusText: string, body: unknown): string;

export const MAX_MANGA_REGIONS: number;
export const MAX_MANGA_COORDINATE: number;
export const MAX_MANGA_TOTAL_REGION_PIXELS: number;

export function selectMangaBboxes(
  detections?: ReadonlyArray<{ bbox?: unknown }>
): Array<[number, number, number, number]>;

export type ContentScriptBlock = {
  text: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
  orientation: "horizontal" | "vertical";
};

export function toContentScriptBlocks(
  blocks?: unknown,
  options?: { defaultConfidence?: number; defaultOrientation?: "horizontal" | "vertical" }
): ContentScriptBlock[];

export function trimTrailingSlashes(url: unknown): string;
