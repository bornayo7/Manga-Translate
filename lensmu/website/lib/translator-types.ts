import type { RegionOutcome } from './image-renderer';

export type ProcessState = 'idle' | 'uploading' | 'scanning' | 'translating' | 'rendering' | 'done' | 'error';
export type OcrEngine = 'paddleocr' | 'mangaocr';
export type OcrBlock = {
  text: string;
  confidence: number;
  bbox: [number, number, number, number];
  orientation?: 'horizontal' | 'vertical';
  source?: 'paddleocr' | 'mangaocr';
};
export type TranslateOptions = {
  file: File;
  ocrEngine: OcrEngine;
  sourceLang: string;
  targetLang: string;
  backendUrl?: string;
  signal?: AbortSignal;
  onProgress?: (state: ProcessState, detail?: string) => void;
};
export type TranslateResult = {
  sourceLang: string;
  targetLang: string;
  blob: Blob;
  blocks: OcrBlock[];
  translations: string[];
  width: number;
  height: number;
  rendered: number;
  skipped: number;
  regions: RegionOutcome[];
  warnings: string[];
};
