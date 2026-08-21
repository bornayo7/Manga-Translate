// Client-side translation pipeline for the website demo.
// Requires the FastAPI backend at DEFAULT_BACKEND_URL with CORS for localhost:3000.
// All work happens in the browser; no Next.js API route is needed.

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
};

const DEFAULT_BACKEND_URL = "http://localhost:8000";
const MYMEMORY_CHAR_LIMIT = 500;
const REQUEST_TIMEOUT_MS = 30000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function previewText(text: string, maxLength = 120): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

function normalizeForComparison(text: string): string {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isEffectivelyIdenticalTranslation(
  sourceText: string,
  translatedText: string
): boolean {
  return normalizeForComparison(sourceText) === normalizeForComparison(translatedText);
}

function languagesClearlyDiffer(sourceLang: string, targetLang: string): boolean {
  const normalizedSource = normalizeForComparison(sourceLang);
  const normalizedTarget = normalizeForComparison(targetLang);

  if (!normalizedSource || !normalizedTarget || normalizedSource === "auto" || normalizedSource === "autodetect") {
    return false;
  }

  return normalizedSource !== normalizedTarget;
}

function ensureTranslatedText(
  rawTranslatedText: unknown,
  originalText: string,
  providerName: string
): string {
  const cleaned = String(rawTranslatedText ?? "")
    .replace(/MYMEMORY WARNING:.*$/i, "")
    .trim();

  if (!cleaned) {
    throw new Error(`${providerName} returned an empty translatedText payload.`);
  }

  if (isEffectivelyIdenticalTranslation(originalText, cleaned)) {
    console.warn("[VisionTranslate Website] Provider returned text identical to source", {
      provider: providerName,
      sourcePreview: previewText(originalText),
      translatedPreview: previewText(cleaned),
    });
  }

  return cleaned;
}

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
  const blocks = await runOCR(imageBase64, ocrEngine, backendUrl, sourceLang);

  if (blocks.length === 0) {
    throw new Error(
      "No text regions were detected in this image. Try a different page " +
        "or switch OCR engine / source language."
    );
  }

  onProgress?.("translating");
  // When source is "auto", let MyMemory auto-detect. It accepts "autodetect"
  // as a langpair source; otherwise use the explicit ISO code.
  const resolvedSource =
    sourceLang === "auto" ? "autodetect" : sourceLang;
  const translations = await translateTexts(
    blocks.map((b) => b.text),
    resolvedSource,
    targetLang
  );

  onProgress?.("rendering");
  const blob = await renderTranslatedImage(image, blocks, translations);
  const url = URL.createObjectURL(blob);

  onProgress?.("done");
  return {
    blob,
    url,
    blocks,
    translations,
    width: image.naturalWidth,
    height: image.naturalHeight,
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

async function runOCR(
  imageBase64: string,
  engine: OcrEngine,
  backendUrl: string,
  sourceLang: string
): Promise<OcrBlock[]> {
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
    return normalizePaddleDetections(data?.detections ?? []);
  }

  if (engine === "mangaocr") {
    // Two-step: Paddle for detection, MangaOCR for recognition. MangaOCR is
    // Japanese-only, so we force Japanese for the detection pass too.
    const paddleData = await postJSON<BackendOcrResponse>(`${backendUrl}/ocr/paddle`, {
      image: imageBase64,
      lang: "japan",
    });
    const detections = paddleData?.detections ?? [];
    if (detections.length === 0) return [];

    const bboxes = detections.map((d: { bbox: number[] }) => d.bbox);
    const mangaData = await postJSON<BackendOcrResponse>(`${backendUrl}/ocr/manga`, {
      image: imageBase64,
      bboxes,
    });
    const mangaDetections: Array<{
      text: string;
      bbox: number[];
      confidence?: number;
    }> = mangaData?.detections ?? [];

    if (mangaDetections.length === 0) {
      // Fall back to Paddle's own text if MangaOCR returned nothing.
      return normalizePaddleDetections(detections);
    }

    return mangaDetections
      .map((d) => ({
        text: String(d.text ?? "").trim(),
        confidence: Number(d.confidence ?? 0.9),
        bbox: [d.bbox[0], d.bbox[1], d.bbox[2], d.bbox[3]] as OcrBlock["bbox"],
        orientation: "vertical" as const,
      }))
      .filter((b) => b.text.length > 0);
  }

  throw new Error(`Unsupported OCR engine: ${engine}`);
}

function normalizePaddleDetections(
  detections: Array<{
    text: string;
    bbox: number[];
    confidence?: number;
    orientation?: string;
  }>
): OcrBlock[] {
  return detections
    .map((d) => ({
      text: String(d.text ?? "").trim(),
      confidence: Number(d.confidence ?? 0),
      bbox: [d.bbox[0], d.bbox[1], d.bbox[2], d.bbox[3]] as OcrBlock["bbox"],
      orientation:
        d.orientation === "vertical" ? ("vertical" as const) : ("horizontal" as const),
    }))
    .filter((b) => b.text.length > 0);
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const data = await response.json();
      const rawDetail = data?.detail || data?.message || data;
      detail = typeof rawDetail === "string" ? rawDetail : JSON.stringify(rawDetail);
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new Error(
      `Backend error ${response.status}: ${detail || response.statusText}. ` +
        `Make sure the backend is running at ${new URL(url).origin}.`
    );
  }
  return response.json() as Promise<T>;
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
    texts: texts.map((text, index) => ({
      index,
      sourcePreview: previewText(text),
    })),
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

  const translatedEntries = texts
    .map((text, index) => ({
      index,
      sourceText: text,
      translation: String(out[index] ?? "").trim(),
      identical: isEffectivelyIdenticalTranslation(text, out[index] ?? ""),
    }))
    .filter((entry) => entry.sourceText.trim().length > 0);

  const allTranslationsMatchSource =
    translatedEntries.length > 0 &&
    translatedEntries.every(
      (entry) => entry.translation.length > 0 && entry.identical
    );

  if (languagesClearlyDiffer(sourceLang, targetLang) && allTranslationsMatchSource) {
    console.error("[VisionTranslate Website] Blocking render because every translation matches the source text", {
      sourceLang,
      targetLang,
      translations: translatedEntries.map((entry) => ({
        index: entry.index,
        sourcePreview: previewText(entry.sourceText),
        translationPreview: previewText(entry.translation),
      })),
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
  // MyMemory has a 500-char limit per request; split long text at sentence
  // boundaries. Manga bubbles are almost always under 500 chars so this
  // rarely fires, but include it to avoid silent truncation.
  if (text.length > MYMEMORY_CHAR_LIMIT) {
    const chunks = text.match(/[^.!?。！？]+[.!?。！？]*/g) ?? [text];
    const translated: string[] = [];
    for (const chunk of chunks) {
      translated.push(await translateOne(chunk, sourceLang, targetLang));
    }
    return translated.join(" ");
  }

  const params = new URLSearchParams({
    q: text,
    langpair: `${sourceLang}|${targetLang}`,
  });
  console.log("[VisionTranslate Website] MyMemory request", {
    provider: "mymemory",
    sourceLang,
    targetLang,
    sourcePreview: previewText(text),
  });
  const response = await fetchWithTimeout(
    `https://api.mymemory.translated.net/get?${params.toString()}`
  );
  if (!response.ok) {
    throw new Error(`MyMemory ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  console.log("[VisionTranslate Website] MyMemory raw response", {
    provider: "mymemory",
    sourceLang,
    targetLang,
    rawResponse: data,
  });
  if (data?.responseStatus && data.responseStatus !== 200) {
    throw new Error(
      `MyMemory error ${data.responseStatus}: ${data.responseDetails ?? "unknown"}`
    );
  }
  return ensureTranslatedText(
    data?.responseData?.translatedText,
    text,
    "MyMemory"
  );
}

// -- Canvas rendering --

async function renderTranslatedImage(
  image: HTMLImageElement,
  blocks: OcrBlock[],
  translations: string[]
): Promise<Blob> {
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
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", sans-serif';

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

    // 3. Auto-size the font to fit, then draw the translated text centered.
    const padding = Math.max(4, Math.min(boxW, boxH) * 0.08);
    const innerW = boxW - padding * 2;
    const innerH = boxH - padding * 2;
    if (innerW < 5 || innerH < 5) continue;

    const { fontSize, lines } = autoSizeFont(
      ctx,
      translated,
      innerW,
      innerH,
      fontFamily
    );
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const lineHeight = fontSize * 1.3;
    const totalTextHeight = lines.length * lineHeight;
    const startY = boxY + padding + (innerH - totalTextHeight) / 2;
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
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to export canvas"));
    }, "image/png");
  });
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

function autoSizeFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxHeight: number,
  fontFamily: string
): { fontSize: number; lines: string[] } {
  const MIN = 8;
  const MAX = Math.min(maxHeight, 64);

  const tryFit = (size: number): string[] | null => {
    ctx.font = `${size}px ${fontFamily}`;
    const lineHeight = size * 1.3;
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    if (lines.length * lineHeight > maxHeight) return null;
    for (const line of lines) {
      if (ctx.measureText(line).width > maxWidth) return null;
    }
    return lines;
  };

  let low = MIN;
  let high = MAX;
  let bestSize = MIN;
  let bestLines: string[] = [text];
  while (high - low > 0.5) {
    const mid = (low + high) / 2;
    const lines = tryFit(mid);
    if (lines) {
      bestSize = mid;
      bestLines = lines;
      low = mid;
    } else {
      high = mid;
    }
  }
  return { fontSize: Math.floor(bestSize), lines: bestLines };
}
