export type MangaBbox = [number, number, number, number];
export type BackendDetection = { text: string; bbox: number[]; confidence?: number; orientation?: string; error?: string | null; source?: string;
  status?: 'recognized' | 'empty' | 'failed' | 'outside_image' };
export function decodeBackendOcrResponse(data: unknown, options?: { engine?: 'paddle' | 'manga'; expectedCount?: number }):
  { detections: BackendDetection[]; warnings: string[] };

export type MangaBatch = { indices: number[]; bboxes: MangaBbox[] };

export type MangaBatchPlan = {
  batches: MangaBatch[];
  invalid: number[];
  oversized: number[];
};

export type MergedOcrBlock = {
  text: string;
  bbox: number[];
  confidence: number;
  orientation: 'horizontal' | 'vertical';
  source: 'mangaocr' | 'paddleocr';
};

export type MergedMangaResult = {
  blocks: MergedOcrBlock[];
  recognized: number;
  fellBack: number;
  dropped: number;
  unexpectedBatches: number;
};

export function normalizeMangaBbox(detection: unknown): MangaBbox | null;

export function batchMangaBboxes(detections?: ReadonlyArray<unknown>): MangaBatchPlan;

export function mergeMangaResults(
  detections?: ReadonlyArray<unknown>,
  batches?: ReadonlyArray<MangaBatch>,
  batchResponses?: ReadonlyArray<unknown>
): MergedMangaResult;

export function parseGoogleVisionResponse(data: unknown): {
  blocks: Array<{ text: string; confidence: number; bbox: { x: number; y: number; width: number; height: number } }>;
  sourceLang: string;
  noText: boolean;
};
