import type { ProcessState, TranslateOptions, TranslateResult } from './translator-types';
export type DemoState = {
  phase: ProcessState;
  detail: string;
  error: string;
  result: (TranslateResult & { url: string }) | null;
};
export function createTranslationSession(options: {
  translate: (input: TranslateOptions) => Promise<TranslateResult>;
  publish: (state: DemoState) => void;
  createUrl?: (blob: Blob) => string;
  revokeUrl?: (url: string) => void;
}): {
  run: (input: TranslateOptions) => Promise<(TranslateResult & { url: string }) | null>;
  cancel: () => void;
  dispose: () => void;
};
