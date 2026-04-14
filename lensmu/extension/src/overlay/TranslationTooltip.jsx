/**
 * TranslationTooltip.jsx — Hover tooltip for translated text regions.
 *
 * WHEN THIS APPEARS:
 * After VisionTranslate overlays translated text on the page, the user might
 * want to see the ORIGINAL text underneath. When they hover over a translated
 * region, this tooltip appears near the cursor showing:
 *   - The original (pre-translation) text
 *   - The detected source language
 *   - A confidence score from the OCR engine (how sure it is about the text)
 *
 * POSITIONING:
 * The tooltip follows the mouse cursor with a small offset (16px right, 16px
 * below the cursor). It also checks viewport bounds to avoid being clipped
 * at the edges of the screen — if it would overflow the right edge, it flips
 * to appear to the LEFT of the cursor instead, and similarly for the bottom.
 *
 * SHADOW DOM NOTE:
 * Like the OverlayToolbar, this component is rendered inside a Shadow DOM
 * to avoid style conflicts with the host page. The content script manages
 * the Shadow DOM container and mounts/unmounts this component as the user
 * hovers over translated regions.
 *
 * PROPS:
 *   originalText     — The text before translation (what was in the image)
 *   translatedText   — The translated text (what's shown on the page)
 *   detectedLanguage — Language code detected by OCR (e.g., "ja")
 *   confidence       — OCR confidence score, 0.0 to 1.0
 *   mouseX           — Current mouse X position (viewport coordinates)
 *   mouseY           — Current mouse Y position (viewport coordinates)
 *   visible          — Whether the tooltip should be shown
 */

import React, { useState, useEffect, useRef, useMemo } from "react";

/**
 * LANGUAGE_NAMES — Maps language codes to human-readable names.
 * Used to display "Japanese" instead of "ja" in the tooltip.
 */
const LANGUAGE_NAMES = {
  auto: "Auto-detected",
  en: "English",
  ja: "Japanese",
  "zh-CN": "Chinese (Simplified)",
  "zh-TW": "Chinese (Traditional)",
  ko: "Korean",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ru: "Russian",
  ar: "Arabic",
  hi: "Hindi",
  th: "Thai",
  vi: "Vietnamese",
  it: "Italian",
};

/**
 * getConfidenceLevel — Converts a numeric confidence score to a human-readable
 * label and a CSS class for color coding.
 *
 *   0.90 - 1.00 => "High"   (green)
 *   0.70 - 0.89 => "Medium" (yellow)
 *   0.00 - 0.69 => "Low"    (red)
 */
function getConfidenceLevel(score) {
  if (score >= 0.9) return { label: "High", className: "confidence--high" };
  if (score >= 0.7) return { label: "Medium", className: "confidence--medium" };
  return { label: "Low", className: "confidence--low" };
}

export default function TranslationTooltip({
  originalText = "",
  translatedText = "",
  detectedLanguage = "auto",
  confidence = 0,
  mouseX = 0,
  mouseY = 0,
  visible = false,
}) {
  // Reference to the tooltip element for measuring its dimensions
  const tooltipRef = useRef(null);

  // Computed position after viewport-boundary checks
  const [adjustedPosition, setAdjustedPosition] = useState({ x: 0, y: 0 });

  // ─── Viewport-aware positioning ──────────────────────────────────────
  useEffect(() => {
    if (!visible || !tooltipRef.current) return;

    const tooltip = tooltipRef.current;
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Default offset: 16px right and 16px below the cursor
    const offsetX = 16;
    const offsetY = 16;

    let x = mouseX + offsetX;
    let y = mouseY + offsetY;

    // Flip horizontally if tooltip would overflow the right edge
    if (x + tooltipRect.width > viewportWidth - 8) {
      x = mouseX - tooltipRect.width - offsetX;
    }

    // Flip vertically if tooltip would overflow the bottom edge
    if (y + tooltipRect.height > viewportHeight - 8) {
      y = mouseY - tooltipRect.height - offsetY;
    }

    // Ensure tooltip stays within viewport (clamp to edges)
    x = Math.max(8, Math.min(x, viewportWidth - tooltipRect.width - 8));
    y = Math.max(8, Math.min(y, viewportHeight - tooltipRect.height - 8));

    setAdjustedPosition({ x, y });
  }, [mouseX, mouseY, visible]);

  // ─── Derived values ──────────────────────────────────────────────────
  const languageName = LANGUAGE_NAMES[detectedLanguage] || detectedLanguage;
  const confidenceInfo = useMemo(
    () => getConfidenceLevel(confidence),
    [confidence]
  );
  const confidencePercent = Math.round(confidence * 100);

  // ─── Don't render if not visible ─────────────────────────────────────
  if (!visible) return null;

  return (
    <div
      ref={tooltipRef}
      className="translation-tooltip"
      style={{
        position: "fixed",
        left: `${adjustedPosition.x}px`,
        top: `${adjustedPosition.y}px`,
        zIndex: 2147483647,
        // Prevent the tooltip itself from triggering mouse events
        // (which would cause flickering as the mouse enters/leaves the tooltip)
        pointerEvents: "none",
      }}
      role="tooltip"
      aria-hidden={!visible}
    >
      {/* ── Original text section ──────────────────────────────────── */}
      <div className="tooltip-section">
        <div className="tooltip-section-label">Original</div>
        <div className="tooltip-original-text">
          {originalText || "(empty)"}
        </div>
      </div>

      {/* ── Translated text section ────────────────────────────────── */}
      <div className="tooltip-section">
        <div className="tooltip-section-label">Translated</div>
        <div className="tooltip-translated-text">
          {translatedText || "(empty)"}
        </div>
      </div>

      {/* ── Metadata row: language and confidence ──────────────────── */}
      <div className="tooltip-meta">
        {/* Detected language */}
        <span className="tooltip-language">
          {languageName}
        </span>

        {/* Separator dot */}
        <span className="tooltip-separator" aria-hidden="true">
          {" \u00B7 "}
        </span>

        {/* Confidence score with color coding */}
        <span className={`tooltip-confidence ${confidenceInfo.className}`}>
          {confidenceInfo.label} ({confidencePercent}%)
        </span>
      </div>
    </div>
  );
}
