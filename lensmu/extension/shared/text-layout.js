// Pure text-layout logic shared by the extension overlay renderer and the
// website demo renderer: tokenising, wrapping and finding the largest font
// size at which a translation fits inside a region.
//
// Nothing here touches a canvas. Callers supply `measureText(text, fontSize)`
// returning the rendered width in pixels for their own font, so the same
// algorithm runs against a real 2D context in the browser and against a
// deterministic fake in tests.
//
// The contract that matters: a layout is only reported as fitting when
// EVERY line's width is within maxWidth AND the stacked line heights are
// within maxHeight (or, vertically, every column is within the height and
// the columns together are within the width). A block that cannot satisfy
// that even at the minimum font size comes back with `fits: false`; the
// caller must then leave the region alone rather than paint outside it.

export const TEXT_LAYOUT_TUNING = Object.freeze({
  minFontSize: 8,
  maxFontSize: 72,
  minLineHeight: 1.08,
  maxLineHeight: 1.3,
  /*
   * Vertical (tategaki) layout: the column pitch and glyph pitch are used
   * both when measuring whether a font size fits and when drawing, so the
   * two can never disagree about how wide a column is.
   */
  verticalColumnWidthRatio: 1.2,
  verticalCharHeightRatio: 1.1
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeTranslationText(text) {
  return String(text || '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function detectCJK(text) {
  return /[一-鿿぀-ゟ゠-ヿ가-힯]/.test(String(text || ''));
}

function splitGraphemes(text) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (segment) => segment.segment);
  }
  return Array.from(text);
}

/*
 * Whitespace-separated words when there are several; otherwise CJK text
 * (and any long unspaced run) is broken per grapheme so it can wrap at all.
 */
export function tokenizeForWrap(text) {
  const normalized = normalizeTranslationText(text);

  if (!normalized) {
    return { tokens: [], separator: ' ' };
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return { tokens: words, separator: ' ' };
  }

  if (detectCJK(normalized) || normalized.length > 20) {
    return { tokens: splitGraphemes(normalized), separator: '' };
  }

  return { tokens: [normalized], separator: '' };
}

/*
 * Breaks one token that is wider than maxWidth into the largest pieces that
 * fit. A single grapheme wider than maxWidth is returned on its own; the
 * caller detects that the piece still does not fit.
 */
export function splitOversizedToken(measure, token, maxWidth) {
  const pieces = [];
  let current = '';

  for (const grapheme of splitGraphemes(token)) {
    const next = current + grapheme;
    if (!current || measure(next) <= maxWidth) {
      current = next;
      continue;
    }

    pieces.push(current);
    current = grapheme;
  }

  if (current) {
    pieces.push(current);
  }

  return pieces;
}

/*
 * Wraps `text` into lines no wider than maxWidth. Every token, including
 * the first, is measured; a token wider than the line is split. Returns
 * { lines, fits }: fits is false only when some single grapheme is wider
 * than maxWidth, in which case that grapheme is still placed on its own
 * line so the caller can see what overflowed.
 */
export function wrapText(measure, text, maxWidth) {
  const { tokens, separator } = tokenizeForWrap(text);

  if (!tokens.length) {
    return { lines: [], fits: true };
  }

  const lines = [];
  let currentLine = '';
  let fits = true;

  const pushLine = (line) => {
    if (measure(line) > maxWidth) {
      fits = false;
    }
    lines.push(line);
  };

  const placeToken = (token) => {
    const candidate = currentLine ? `${currentLine}${separator}${token}` : token;
    if (measure(candidate) <= maxWidth) {
      currentLine = candidate;
      return;
    }

    if (measure(token) <= maxWidth) {
      if (currentLine) {
        pushLine(currentLine);
      }
      currentLine = token;
      return;
    }

    // The token alone is too wide: flush what we have and place its pieces.
    if (currentLine) {
      pushLine(currentLine);
      currentLine = '';
    }
    const pieces = splitOversizedToken(measure, token, maxWidth);
    for (let index = 0; index < pieces.length; index++) {
      const piece = pieces[index];
      if (index < pieces.length - 1) {
        pushLine(piece);
      } else {
        currentLine = piece;
        if (measure(piece) > maxWidth) {
          fits = false;
        }
      }
    }
  };

  for (const token of tokens) {
    placeToken(token);
  }

  if (currentLine) {
    pushLine(currentLine);
  }

  return { lines, fits };
}

/*
 * Finds the largest font size in [minFontSize, maxFontSize] at which the
 * text fits the region, validating both dimensions of every accepted
 * layout. Returns { fits, fontSize, lines, lineHeight, orientation }. With
 * fits === false the other fields describe the minimum-size attempt for
 * diagnostics only and must not be drawn.
 */
export function layoutTextBlock({
  measureText,
  text,
  maxWidth,
  maxHeight,
  minFontSize,
  maxFontSize,
  isVertical = false,
  tuning = TEXT_LAYOUT_TUNING
}) {
  const normalizedText = normalizeTranslationText(text);
  const settings = { ...TEXT_LAYOUT_TUNING, ...(tuning || {}) };
  const lowerBound = Math.max(settings.minFontSize, Number(minFontSize) || settings.minFontSize);
  const upperBound = Math.min(
    settings.maxFontSize,
    Number(maxFontSize) || settings.maxFontSize,
    isVertical ? maxWidth : Math.max(maxWidth, maxHeight)
  );
  const orientation = isVertical ? 'vertical' : 'horizontal';
  const noFit = (fontSize, lines = [normalizedText], lineHeight = fontSize * settings.minLineHeight) => ({
    fits: false,
    fontSize,
    lines,
    lineHeight,
    orientation
  });

  if (!normalizedText) {
    return { fits: true, fontSize: lowerBound, lines: [], lineHeight: lowerBound * settings.minLineHeight, orientation };
  }

  if (!(maxWidth > 1) || !(maxHeight > 1) || typeof measureText !== 'function') {
    return noFit(lowerBound);
  }

  const measureAt = (size) => (value) => measureText(value, size);

  const tryFontSize = (size) => {
    const measure = measureAt(size);

    if (isVertical) {
      const charHeight = size * settings.verticalCharHeightRatio;
      const columnWidth = size * settings.verticalColumnWidthRatio;
      const graphemes = splitGraphemes(normalizedText);
      const charsPerColumn = Math.max(1, Math.floor(maxHeight / charHeight));

      if (charHeight > maxHeight) {
        return null;
      }

      const columns = [];
      for (let index = 0; index < graphemes.length; index += charsPerColumn) {
        columns.push(graphemes.slice(index, index + charsPerColumn).join(''));
      }

      if (columns.length * columnWidth > maxWidth) {
        return null;
      }

      // Every glyph must sit inside its column.
      for (const grapheme of graphemes) {
        if (measure(grapheme) > columnWidth) {
          return null;
        }
      }

      return { lines: columns, lineHeight: charHeight };
    }

    const wrapped = wrapText(measure, normalizedText, maxWidth);
    if (!wrapped.fits || wrapped.lines.length === 0) {
      return null;
    }

    const desiredMultiplier = maxHeight / Math.max(1, wrapped.lines.length * size);
    const lineHeightMultiplier = clamp(desiredMultiplier, settings.minLineHeight, settings.maxLineHeight);
    const lineHeight = size * lineHeightMultiplier;

    if (wrapped.lines.length * lineHeight > maxHeight) {
      return null;
    }

    for (const line of wrapped.lines) {
      if (measure(line) > maxWidth) {
        return null;
      }
    }

    return { lines: wrapped.lines, lineHeight };
  };

  const minimumLayout = tryFontSize(lowerBound);
  if (!minimumLayout) {
    return noFit(lowerBound);
  }

  let bestLayout = { fits: true, fontSize: lowerBound, lines: minimumLayout.lines, lineHeight: minimumLayout.lineHeight, orientation };

  if (upperBound <= lowerBound) {
    return bestLayout;
  }

  let low = lowerBound;
  let high = upperBound;

  while (high - low > 0.5) {
    const mid = (low + high) / 2;
    const layout = tryFontSize(mid);

    if (layout) {
      bestLayout = { fits: true, fontSize: mid, lines: layout.lines, lineHeight: layout.lineHeight, orientation };
      low = mid;
    } else {
      high = mid;
    }
  }

  return bestLayout;
}

/** A fitted plan in region-relative coordinates. Paint never tokenizes again. */
export function createTextDisplayPlan(options) {
  const layout = layoutTextBlock(options);
  const placements = [];
  if (!layout.fits) return { ...layout, placements };

  const { maxWidth, maxHeight, measureText, alignment = 'left' } = options;
  const tuning = { ...TEXT_LAYOUT_TUNING, ...(options.tuning || {}) };
  if (layout.orientation === 'vertical') {
    const pitch = layout.fontSize * tuning.verticalColumnWidthRatio;
    for (const [columnIndex, column] of layout.lines.entries()) {
      const glyphs = splitGraphemes(column);
      const top = Math.max(0, (maxHeight - glyphs.length * layout.lineHeight) / 2);
      for (const [index, text] of glyphs.entries()) {
        placements.push({
          text,
          x: maxWidth - (columnIndex + 1) * pitch + (pitch - measureText(text, layout.fontSize)) / 2,
          y: top + index * layout.lineHeight
        });
      }
    }
  } else {
    const top = alignment === 'center' && layout.lines.length <= 2
      ? Math.max(0, (maxHeight - layout.lines.length * layout.lineHeight) / 2)
      : 0;
    for (const [index, text] of layout.lines.entries()) {
      const width = measureText(text, layout.fontSize);
      const x = alignment === 'center' ? (maxWidth - width) / 2 : alignment === 'right' ? maxWidth - width : 0;
      placements.push({ text, x, y: top + index * layout.lineHeight });
    }
  }
  return { ...layout, placements };
}
