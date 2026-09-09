import { createTextDisplayPlan, detectCJK } from "../../extension/shared/text-layout.js";
import type { OcrBlock } from "./translator-types";
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 64;

export type RegionOutcome = { index: number; status: "rendered" | "skipped"; reason?: "too-small" | "does-not-fit" | "translation-failed" };
export type RenderOutcome = { blob: Blob; rendered: number; unfit: number; skipped: number; regions: RegionOutcome[] };

export async function renderTranslatedImage(
  image: HTMLImageElement,
  blocks: OcrBlock[],
  translations: string[],
  signal?: AbortSignal,
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')
): Promise<RenderOutcome> {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = createCanvas();
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
  const regions: RegionOutcome[] = [];

  for (let i = 0; i < blocks.length; i++) {
    signal?.throwIfAborted();
    if (i % 16 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    signal?.throwIfAborted();
    const block = blocks[i];
    const translated = translations[i];
    if (!translated) { regions.push({index: i, status: "skipped", reason: "translation-failed"}); continue; }

    const [x1, y1, x2, y2] = block.bbox;
    const boxX = Math.max(0, Math.min(x1, width));
    const boxY = Math.max(0, Math.min(y1, height));
    const boxW = Math.max(0, Math.min(x2, width) - boxX);
    const boxH = Math.max(0, Math.min(y2, height) - boxY);
    if (boxW < 10 || boxH < 8) { regions.push({index: i, status: "skipped", reason: "too-small"}); continue; }

    const padding = Math.max(4, Math.min(boxW, boxH) * 0.08);
    const innerW = boxW - padding * 2;
    const innerH = boxH - padding * 2;
    if (innerW < 5 || innerH < 5) { regions.push({index: i, status: "skipped", reason: "too-small"}); continue; }

    /*
     * Lay the text out BEFORE erasing anything. Unicode-aware wrapping
     * (per grapheme for unspaced Japanese/Chinese) and a layout that is
     * validated in both dimensions; if nothing fits even at the minimum
     * size the region is left exactly as it was, so the exported PNG never
     * contains an erased bubble with overflowing or missing text.
     */
    const layout = createTextDisplayPlan({
      measureText,
      text: translated,
      maxWidth: innerW,
      maxHeight: innerH,
      minFontSize: MIN_FONT_SIZE,
      maxFontSize: MAX_FONT_SIZE,
      alignment: "center",
      isVertical: block.orientation === "vertical" && detectCJK(translated),
    });

    if (!layout.fits) {
      unfit += 1;
      regions.push({index: i, status: "skipped", reason: "does-not-fit"});
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

    // Paint the exact shared plan, including whole graphemes.
    const { fontSize, placements } = layout;
    ctx.font = fontSize + "px " + fontFamily;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const textColor = getContrastColor(bgColor);
    ctx.strokeStyle = textColor === "black" ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)";
    ctx.lineWidth = Math.max(2, fontSize * 0.12);
    ctx.lineJoin = "round";
    ctx.fillStyle = textColor;
    for (const placement of placements) {
      ctx.strokeText(placement.text, boxX + padding + placement.x, boxY + padding + placement.y);
      ctx.fillText(placement.text, boxX + padding + placement.x, boxY + padding + placement.y);
    }
    regions.push({ index: i, status: "rendered" });
    rendered += 1;
  }

  if (rendered === 0) {
    throw new Error(
      "No translated regions could be drawn. The regions are too small or the translation does not fit. Try a larger image."
    );
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Failed to export canvas"));
    }, "image/png");
  });

  signal?.throwIfAborted();
  return { blob, rendered, unfit, skipped: regions.length - rendered, regions };
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
