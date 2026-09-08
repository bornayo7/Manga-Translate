// Client-side translation pipeline for the website demo.
// Requires the FastAPI backend at DEFAULT_BACKEND_URL with CORS for localhost:3000.
// All work happens in the browser; no Next.js API route is needed.
//
// The demo shares its contracts with the extension rather than re-deriving
// them: request sizing and the source-language rule for MyMemory, the
// MangaOCR batching/merge, the bounded fetch, and the text-layout algorithm
// all come from extension/shared/*.js.

import { chunkTextByBytes } from "../../extension/shared/text-chunking.js";
import {
  MYMEMORY_BYTE_LIMIT,
  assertMyMemoryStatus,
  buildMyMemoryLangPair,
  ensureTranslatedText,
  exceedsMyMemoryLimit,
  resolveMyMemorySourceLanguage,
} from "../../extension/shared/mymemory.js";
import { describeHttpFailure } from "../../extension/shared/text.js";
import { batchMangaBboxes, mergeMangaResults } from "../../extension/shared/ocr-responses.js";
import { fetchWithTimeout } from "../../extension/shared/fetch-with-timeout.js";
import { layoutTextBlock } from "../../extension/shared/text-layout.js";
import { classifyTranslations } from "../../extension/shared/translation-outcomes.js";

export type ProcessState =
  | "idle"
  | "uploading"
  | "scanning"
  | "translating"
  | "rendering"
  | "done"
  | "error";

export type OcrEngine = "paddleocr" | "mangaocr";

export type OcrBlock = {
  text: string;
  confidence: number;
  bbox: [number, number, number, number]; // x1, y1, x2, y2
  orientation?: "horizontal" | "vertical";
  source?: "paddleocr" | "mangaocr";
};

type BackendDetection = {
  text: string;
  bbox: number[];
  confidence?: number;
  orientation?: string;
};

type BackendOcrResponse = {
  detections?: BackendDetection[];
};

export type TranslateOptions = {
  file: File;
  ocrEngine: OcrEngine;
  sourceLang: string; // e.g. "auto", "ja"
  targetLang: string; // e.g. "en"
  backendUrl?: string;
  onProgress?: (state: ProcessState, detail?: string) => void;
};

export type TranslateResult = {
  blob: Blob;
  url: string;
  blocks: OcrBlock[];
  translations: string[];
  width: number;
  height: number;
  /** Blocks left untouched because no layout fits their region. */
  unfitBlocks: number;
  /** Human-readable notes about partial outcomes (empty when everything rendered). */
  warnings: string[];
};

const DEFAULT_BACKEND_URL = "http://localhost:8000";
const REQUEST_TIMEOUT_MS = 30000;
const MAX_OCR_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_MYMEMORY_RESPONSE_BYTES = 256 * 1024;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 64;

export async function translateImage(
  options: TranslateOptions
): Promise<TranslateResult> {
  const {
    file,
    ocrEngine,
    sourceLang,
    targetLang,
    backendUrl = DEFAULT_BACKEND_URL,
    onProgress,
  } = options;

  onProgress?.("uploading");
  const imageBase64 = await fileToBase64(file);
  const image = await loadImageFromFile(file);

  onProgress?.("scanning");
  const ocr = await runOCR(imageBase64, ocrEngine, backendUrl, sourceLang);
  const blocks = ocr.blocks;

  if (blocks.length === 0) {
    throw new Error(
      "No text regions were detected in this image. Try a different page " +
        "or switch OCR engine / source language."
    );
  }

  onProgress?.("translating");
  // MyMemory has no auto-detect: "auto" is resolved per block from the
  // text's script inside translateOne(), and refused with guidance when
  // that is not decisive. The demo UI always sends an explicit language.
  const translations = await translateTexts(
    blocks.map((b) => b.text),
    sourceLang,
    targetLang
  );

  onProgress?.("rendering");
  const rendered = await renderTranslatedImage(image, blocks, translations);
  const url = URL.createObjectURL(rendered.blob);

  const warnings = [...ocr.warnings];
  if (rendered.unfit > 0) {
    warnings.push(
      `${rendered.unfit} text region${rendered.unfit === 1 ? "" : "s"} kept the original text because the translation does not fit at the minimum font size.`
    );
  }

  onProgress?.("done");
  return {
    blob: rendered.blob,
    url,
    blocks,
    translations,
    width: image.naturalWidth,
    height: image.naturalHeight,
    unfitBlocks: rendered.unfit,
    warnings,
  };
}

// -- File helpers --

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:image/png;base64," prefix — backend wants raw base64
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

// -- OCR (FastAPI backend) --

type OcrOutcome = { blocks: OcrBlock[]; warnings: string[] };

async function runOCR(
  imageBase64: string,
  engine: OcrEngine,
  backendUrl: string,
  sourceLang: string
): Promise<OcrOutcome> {
  // Map the website's source language (ISO 639-1, or "auto") to a language
  // code the backend understands. For MangaOCR we always use Japanese
  // regardless; for PaddleOCR we forward the user's choice.
  const paddleLang =
    sourceLang && sourceLang !== "auto" ? sourceLang : "japan";

  if (engine === "paddleocr") {
    const data = await postJSON<BackendOcrResponse>(`${backendUrl}/ocr/paddle`, {
      image: imageBase64,
      lang: paddleLang,
    });
    return { blocks: normalizePaddleDetections(data?.detections ?? []), warnings: [] };
  }

  if (engine === "mangaocr") {
    // Two-step: Paddle for detection, MangaOCR for recognition. MangaOCR is
    // Japanese-only, so we force Japanese for the detection pass too.
    const paddleData = await postJSON<BackendOcrResponse>(`${backendUrl}/ocr/paddle`, {
      image: imageBase64,
      lang: "japan",
    });
    const detections = paddleData?.detections ?? [];
    if (detections.length === 0) return { blocks: [], warnings: [] };

    /*
     * The backend validates every box, rejects the whole request on one bad
     * box, and caps a request at 200 boxes / 50 MP. Detections are posted in
     * as many compliant batches as needed and merged back by index, so no
     * region is dropped; a region MangaOCR could not read keeps PaddleOCR's
     * text.
     */
    const plan = batchMangaBboxes(detections);
    const batchResponses: Array<BackendDetection[] | null> = [];
    let firstFailure: Error | null = null;

    for (const batch of plan.batches) {
      try {
        const mangaData = await postJSON<BackendOcrResponse>(`${backendUrl}/ocr/manga`, {
          image: imageBase64,
          bboxes: batch.bboxes,
        });
        batchResponses.push(mangaData?.detections ?? null);
      } catch (error) {
        firstFailure = firstFailure ?? (error instanceof Error ? error : new Error(String(error)));
        batchResponses.push(null);
      }
    }

    if (firstFailure && batchResponses.every((entry) => entry === null)) {
      // MangaOCR unavailable for every batch: say so instead of quietly
      // showing the detector's rough text as the configured engine.
      throw firstFailure;
    }

    const merged = mergeMangaResults(detections, plan.batches, batchResponses);
    const warnings: string[] = [];
    if (merged.fellBack > 0) {
      warnings.push(
        `MangaOCR did not recognise ${merged.fellBack} region${merged.fellBack === 1 ? "" : "s"}; PaddleOCR's text was used there.`
      );
    }
    if (plan.oversized.length > 0 || plan.invalid.length > 0) {
      warnings.push(
        `${plan.oversized.length + plan.invalid.length} region(s) could not be sent to MangaOCR and kept PaddleOCR's text.`
      );
    }

    return {
      blocks: merged.blocks.map((block) => ({
        text: block.text,
        confidence: block.confidence,
        bbox: [block.bbox[0], block.bbox[1], block.bbox[2], block.bbox[3]] as OcrBlock["bbox"],
        orientation: block.orientation,
        source: block.source,
      })),
      warnings,
    };
  }

  throw new Error(`Unsupported OCR engine: ${engine}`);
}

function normalizePaddleDetections(detections: BackendDetection[]): OcrBlock[] {
  return detections
    .map((d) => ({
      text: String(d.text ?? "").trim(),
      confidence: Number(d.confidence ?? 0),
      bbox: [d.bbox[0], d.bbox[1], d.bbox[2], d.bbox[3]] as OcrBlock["bbox"],
      orientation:
        d.orientation === "vertical" ? ("vertical" as const) : ("horizontal" as const),
      source: "paddleocr" as const,
    }))
    .filter((b) => b.text.length > 0);
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { timeoutMs: REQUEST_TIMEOUT_MS, maxResponseBytes: MAX_OCR_RESPONSE_BYTES }
  );
  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    const errorBody: unknown = contentType.includes("application/json")
      ? response.json ?? null
      : response.text ?? "";
    throw new Error(
      `Backend error: ${describeHttpFailure(response.status, response.statusText, errorBody)}. ` +
        `Make sure the backend is running at ${new URL(url).origin}.`
    );
  }
  return response.json as T;
}

// -- Translation (MyMemory free API) --

async function translateTexts(
  texts: string[],
  sourceLang: string,
  targetLang: string
): Promise<string[]> {
  console.log("[VisionTranslate Website] Dispatching translation request", {
    sourceLang,
    targetLang,
    textCount: texts.filter((text) => text.trim().length > 0).length,
    characterCount: texts.reduce((total, text) => total + text.length, 0),
  });

  const out: string[] = [];
  for (let index = 0; index < texts.length; index++) {
    const text = texts[index];
    if (!text.trim()) {
      out.push("");
      continue;
    }

    try {
      out.push(await translateOne(text, sourceLang, targetLang));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Translation failed for block ${index}: ${message}`);
    }
  }

  const { verdict, translated } = classifyTranslations({
    blocks: texts.map((text) => ({ text })),
    translations: out,
    sourceLanguage: sourceLang,
    targetLanguage: targetLang,
  });

  if (verdict?.reason === "identical-output") {
    console.error("[VisionTranslate Website] Blocking render because every translation matches the source text", {
      sourceLang,
      targetLang,
      translationCount: translated.length,
    });
    throw new Error(
      "Translation failed: provider returned text identical to the source for every block."
    );
  }

  return out;
}

async function translateOne(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  // The language is decided once, from the whole block, and every chunk
  // below inherits it. A single chunk carries far less evidence than the
  // block it came from, so re-deciding per chunk would refuse text the
  // extension translates happily.
  const source = resolveMyMemorySourceLanguage(sourceLang, text);

  // MyMemory limits `q` to 500 UTF-8 bytes (not characters): a 200-character
  // Japanese bubble is already 600 bytes. Split by bytes at sentence, word,
  // then grapheme boundaries and translate the pieces in order.
  if (exceedsMyMemoryLimit(text)) {
    const chunks = chunkTextByBytes(text, MYMEMORY_BYTE_LIMIT);
    const translated: string[] = [];
    for (const chunk of chunks) {
      translated.push(await translateSegment(chunk, source.language, targetLang));
    }
    return translated.join(" ");
  }

  return translateSegment(text, source.language, targetLang);
}

/** One MyMemory request for a segment already within the byte limit. */
async function translateSegment(
  text: string,
  sourceLanguage: string,
  targetLang: string
): Promise<string> {
  const params = new URLSearchParams({
    q: text,
    langpair: buildMyMemoryLangPair(sourceLanguage, targetLang),
  });
  console.log("[VisionTranslate Website] MyMemory request", {
    provider: "mymemory",
    sourceLang: sourceLanguage,
    targetLang,
    characterCount: text.length,
  });
  const response = await fetchWithTimeout(
    `https://api.mymemory.translated.net/get?${params.toString()}`,
    {},
    { timeoutMs: REQUEST_TIMEOUT_MS, maxResponseBytes: MAX_MYMEMORY_RESPONSE_BYTES }
  );
  if (!response.ok) {
    throw new Error(`MyMemory ${response.status} ${response.statusText}`);
  }
  const data = response.json as { responseData?: { translatedText?: unknown } };
  assertMyMemoryStatus(data);
  return ensureTranslatedText(data?.responseData?.translatedText, text, "MyMemory");
}

// -- Canvas rendering --

type RenderOutcome = { blob: Blob; rendered: number; unfit: number };

async function renderTranslatedImage(
  image: HTMLImageElement,
  blocks: OcrBlock[],
  translations: string[]
): Promise<RenderOutcome> {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");

  // Draw the original image as the base layer.
  ctx.drawImage(image, 0, 0, width, height);

  const fontFamily =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", "Noto Sans CJK JP", sans-serif';
  const measureText = (text: string, fontSize: number) => {
    ctx.font = `${fontSize}px ${fontFamily}`;
    return ctx.measureText(text).width;
  };

  let rendered = 0;
  let unfit = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const translated = translations[i];
    if (!translated) continue;

    const [x1, y1, x2, y2] = block.bbox;
    const boxX = Math.max(0, Math.min(x1, width));
    const boxY = Math.max(0, Math.min(y1, height));
    const boxW = Math.max(0, Math.min(x2 - x1, width - boxX));
    const boxH = Math.max(0, Math.min(y2 - y1, height - boxY));
    if (boxW < 10 || boxH < 8) continue;

    const padding = Math.max(4, Math.min(boxW, boxH) * 0.08);
    const innerW = boxW - padding * 2;
    const innerH = boxH - padding * 2;
    if (innerW < 5 || innerH < 5) continue;

    /*
     * Lay the text out BEFORE erasing anything. Unicode-aware wrapping
     * (per grapheme for unspaced Japanese/Chinese) and a layout that is
     * validated in both dimensions; if nothing fits even at the minimum
     * size the region is left exactly as it was, so the exported PNG never
     * contains an erased bubble with overflowing or missing text.
     */
    const layout = layoutTextBlock({
      measureText,
      text: translated,
      maxWidth: innerW,
      maxHeight: innerH,
      minFontSize: MIN_FONT_SIZE,
      maxFontSize: MAX_FONT_SIZE,
    });

    if (!layout.fits) {
      unfit += 1;
      continue;
    }

    // 1. Sample background color near the edges of the box so we can paint
    //    over the original text in a matching color.
    const bgColor = sampleBackgroundColor(ctx, boxX, boxY, boxW, boxH);

    // 2. Paint a rounded rect over the original text to erase it.
    const BLEED = 3;
    const fillX = boxX - BLEED;
    const fillY = boxY - BLEED;
    const fillW = boxW + BLEED * 2;
    const fillH = boxH + BLEED * 2;
    const radius = Math.min(6, fillW * 0.1, fillH * 0.1);
    ctx.fillStyle = `rgb(${bgColor.r}, ${bgColor.g}, ${bgColor.b})`;
    drawRoundedRect(ctx, fillX, fillY, fillW, fillH, radius);
    ctx.fill();

    // 3. Draw the validated layout, centred.
    const { fontSize, lines, lineHeight } = layout;
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const totalTextHeight = lines.length * lineHeight;
    const startY = boxY + padding + Math.max(0, (innerH - totalTextHeight) / 2);
    const centerX = boxX + padding + innerW / 2;

    const textColor = getContrastColor(bgColor);
    const outlineColor =
      textColor === "black" ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)";

    for (let j = 0; j < lines.length; j++) {
      const y = startY + j * lineHeight;
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = Math.max(2, fontSize * 0.12);
      ctx.lineJoin = "round";
      ctx.strokeText(lines[j], centerX, y);
      ctx.fillStyle = textColor;
      ctx.fillText(lines[j], centerX, y);
    }
    rendered += 1;
  }

  if (rendered === 0 && unfit > 0) {
    throw new Error(
      "The translated text does not fit any of the detected regions at the minimum font size, so nothing was drawn. Try a larger image."
    );
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Failed to export canvas"));
    }, "image/png");
  });

  return { blob, rendered, unfit };
}

function sampleBackgroundColor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
): { r: number; g: number; b: number } {
  const SAMPLES = 8;
  const OFFSET = 2;
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const samples: Array<[number, number, number]> = [];

  const sample = (px: number, py: number) => {
    const sx = Math.max(0, Math.min(Math.round(px), cw - 1));
    const sy = Math.max(0, Math.min(Math.round(py), ch - 1));
    try {
      const pixel = ctx.getImageData(sx, sy, 1, 1).data;
      samples.push([pixel[0], pixel[1], pixel[2]]);
    } catch {
      /* tainted canvas — ignore */
    }
  };

  for (let i = 0; i < SAMPLES; i++) {
    const t = i / Math.max(1, SAMPLES - 1);
    sample(x + w * t, y - OFFSET);
    sample(x + w * t, y + h + OFFSET);
    sample(x - OFFSET, y + h * t);
    sample(x + w + OFFSET, y + h * t);
  }

  if (samples.length === 0) return { r: 255, g: 255, b: 255 };

  // Quantize to find the mode (handles noise/anti-aliasing).
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  const Q = 8;
  for (const [r, g, b] of samples) {
    const key = `${Math.round(r / Q) * Q},${Math.round(g / Q) * Q},${Math.round(b / Q) * Q}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count++;
      existing.r += r;
      existing.g += g;
      existing.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  let best = { count: 0, r: 255, g: 255, b: 255 };
  const bucketList = Array.from(buckets.values());
  for (let i = 0; i < bucketList.length; i++) {
    if (bucketList[i].count > best.count) best = bucketList[i];
  }
  return {
    r: Math.round(best.r / best.count),
    g: Math.round(best.g / best.count),
    b: Math.round(best.b / best.count),
  };
}

function getContrastColor(bg: { r: number; g: number; b: number }): "black" | "white" {
  const lum =
    0.2126 * Math.pow(bg.r / 255, 2.2) +
    0.7152 * Math.pow(bg.g / 255, 2.2) +
    0.0722 * Math.pow(bg.b / 255, 2.2);
  return lum > 0.179 ? "black" : "white";
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
