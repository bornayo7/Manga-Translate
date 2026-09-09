export type TextLayoutTuning = {
  minFontSize: number;
  maxFontSize: number;
  minLineHeight: number;
  maxLineHeight: number;
  verticalColumnWidthRatio: number;
  verticalCharHeightRatio: number;
};

export const TEXT_LAYOUT_TUNING: Readonly<TextLayoutTuning>;

export function normalizeTranslationText(text: unknown): string;
export function detectCJK(text: unknown): boolean;
export function tokenizeForWrap(text: unknown): { tokens: string[]; separator: string };
export function splitOversizedToken(
  measure: (text: string) => number,
  token: string,
  maxWidth: number
): string[];
export function wrapText(
  measure: (text: string) => number,
  text: unknown,
  maxWidth: number
): { lines: string[]; fits: boolean };

export type TextLayout = {
  fits: boolean;
  fontSize: number;
  lines: string[];
  lineHeight: number;
  orientation: 'horizontal' | 'vertical';
};

export function layoutTextBlock(options: {
  measureText: (text: string, fontSize: number) => number;
  text: unknown;
  maxWidth: number;
  maxHeight: number;
  minFontSize?: number;
  maxFontSize?: number;
  isVertical?: boolean;
  tuning?: Partial<TextLayoutTuning>;
}): TextLayout;

export type TextDisplayPlan = TextLayout & {
  placements: Array<{ text: string; x: number; y: number }>;
};

export function createTextDisplayPlan(options: Parameters<typeof layoutTextBlock>[0] & {
  alignment?: 'left' | 'center' | 'right';
}): TextDisplayPlan;
