/**
 * =============================================================================
 * GOOGLE CLOUD VISION API WRAPPER — Cloud-Based OCR with Excellent Accuracy
 * =============================================================================
 *
 * WHAT THIS FILE DOES:
 * --------------------
 * This module sends images to Google's Cloud Vision API for text recognition.
 * Cloud Vision is Google's commercial OCR service that provides:
 *
 *   - Excellent accuracy across many languages (including CJK)
 *   - Good handling of both horizontal and vertical text
 *   - Detailed bounding box information for every detected text region
 *   - Automatic language detection
 *   - Support for handwritten text (though we use TEXT_DETECTION, not
 *     DOCUMENT_TEXT_DETECTION, which is more specialized)
 *
 * HOW THE API WORKS:
 * ------------------
 * Cloud Vision is a REST API. We send an HTTP POST request containing:
 *   - The image (as Base64-encoded data)
 *   - What we want to detect (TEXT_DETECTION for OCR)
 *
 * The API returns a JSON response containing:
 *   - Full text found in the image
 *   - Individual text "annotations" with bounding polygons
 *
 * IMPORTANT: CLOUD VISION RESPONSE FORMAT
 * ----------------------------------------
 * The response has a specific structure that's worth understanding:
 *
 *   {
 *     "responses": [{
 *       "textAnnotations": [
 *         {
 *           // The FIRST element is special — it contains ALL the text
 *           // found in the image as one big string, with the bounding
 *           // box covering the entire text area.
 *           "description": "Hello World\nLine 2\nLine 3",
 *           "boundingPoly": { "vertices": [{ "x": 0, "y": 0 }, ...] }
 *         },
 *         {
 *           // Every subsequent element is an individual WORD with its
 *           // own bounding box.
 *           "description": "Hello",
 *           "boundingPoly": { "vertices": [{ "x": 10, "y": 20 }, ...] }
 *         },
 *         {
 *           "description": "World",
 *           "boundingPoly": { "vertices": [{ "x": 90, "y": 20 }, ...] }
 *         },
 *         // ... more words
 *       ],
 *       "fullTextAnnotation": {
 *         // This contains a more structured breakdown with pages,
 *         // blocks, paragraphs, words, and individual symbols.
 *         // We use this for more detailed extraction.
 *         "pages": [{ "blocks": [{ "paragraphs": [{ ... }] }] }],
 *         "text": "Hello World\nLine 2\nLine 3"
 *       }
 *     }]
 *   }
 *
 * We primarily use `fullTextAnnotation` because it preserves the hierarchical
 * structure (blocks > paragraphs > words) and gives us better grouping than
 * the flat `textAnnotations` array.
 *
 * PRICING:
 * --------
 *   - First 1,000 requests/month: FREE
 *   - After that: $1.50 per 1,000 requests
 *   - For more details: https://cloud.google.com/vision/pricing
 *
 * SETUP REQUIRED:
 * ---------------
 * The user needs to:
 *   1. Create a Google Cloud project
 *   2. Enable the Cloud Vision API
 *   3. Create an API key (or service account)
 *   4. Paste the API key into our extension's settings
 *
 * =============================================================================
 */

/**
 * The Cloud Vision API endpoint URL.
 * We use v1 of the API. The ":annotate" suffix is the method for image annotation.
 * The API key is appended as a query parameter.
 */
const CLOUD_VISION_API_URL = 'https://vision.googleapis.com/v1/images:annotate';


/**
 * recognize — Sends an image to Google Cloud Vision and returns recognized text.
 *
 * @param {string} imageBase64 - Raw Base64-encoded image data (no data URL prefix).
 *   The OCR Manager handles prefix stripping before calling us.
 *
 * @param {string} apiKey - The user's Google Cloud Vision API key.
 *   This is a string that looks like "AIzaSyB..." (typically 39 characters).
 *   It's passed as a URL parameter in the API request.
 *
 * @returns {Promise<Array>} Array of recognized text blocks:
 *   [{
 *     text: "Hello world",
 *     bbox: [x1, y1, x2, y2],
 *     confidence: 0.98,
 *     orientation: "horizontal"
 *   }]
 *
 * @throws {Error} If the API call fails (network error, invalid key, quota exceeded)
 */
export async function recognize(imageBase64, apiKey) {
  // -------------------------------------------------------------------------
  // STEP 1: Build the API request body.
  //
  // The Cloud Vision API accepts a JSON body with one or more "requests",
  // each containing an image and a list of "features" (what we want detected).
  //
  // We use TEXT_DETECTION which finds blocks of text and returns their
  // positions. There's also DOCUMENT_TEXT_DETECTION which is optimized for
  // dense text (like book pages), but TEXT_DETECTION works better for our
  // use case (scattered text in manga panels, signs, etc.).
  // -------------------------------------------------------------------------
  const requestBody = {
    requests: [
      {
        image: {
          // Send the image as Base64 content. The alternative is to provide
          // a URL to an image hosted online (using "source.imageUri"), but
          // sending the data directly is simpler and works for screenshots.
          content: imageBase64,
        },
        features: [
          {
            type: 'TEXT_DETECTION',
            // maxResults limits how many text annotations are returned.
            // We set a high number to avoid missing text. In practice,
            // Cloud Vision rarely returns more than a few hundred annotations.
            maxResults: 500,
          },
        ],
        // imageContext can contain hints about the image, like expected
        // languages. This can improve accuracy.
        imageContext: {
          languageHints: [],
          // We leave languageHints empty to let Cloud Vision auto-detect.
          // If we know the source language, we could pass it here as e.g.,
          // ["ja", "en"] for Japanese and English.
        },
      },
    ],
  };

  // -------------------------------------------------------------------------
  // STEP 2: Send the request to the Cloud Vision API.
  //
  // We use the standard fetch() API which is available in both the browser
  // and Chrome extension service workers. The API key is passed as a URL
  // parameter (this is how Google Cloud APIs handle authentication for
  // API keys — the alternative is OAuth2 which is more complex).
  // -------------------------------------------------------------------------
  let response;
  try {
    response = await fetch(`${CLOUD_VISION_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  } catch (networkError) {
    // fetch() throws if the network request itself fails (no internet,
    // DNS resolution failed, server unreachable, etc.).
    console.error('[Cloud Vision] Network error:', networkError);
    throw new Error(
      'Could not reach Google Cloud Vision API. Check your internet connection.'
    );
  }

  // -------------------------------------------------------------------------
  // STEP 3: Handle HTTP error responses.
  //
  // The API returns standard HTTP status codes:
  //   200 = Success
  //   400 = Bad request (invalid image, malformed JSON)
  //   401 = Invalid API key
  //   403 = API not enabled or billing not set up
  //   429 = Rate limit exceeded (too many requests)
  //   500+ = Google's servers are having issues
  // -------------------------------------------------------------------------
  if (!response.ok) {
    const errorBody = await parseResponseSafely(response);
    const errorMessage = extractApiErrorMessage(errorBody, response.status);
    console.error('[Cloud Vision] API error:', response.status, errorBody);
    throw new Error(errorMessage);
  }

  // -------------------------------------------------------------------------
  // STEP 4: Parse the successful response.
  // -------------------------------------------------------------------------
  const data = await response.json();

  // The API returns an array of "responses" (one per image we sent, and we
  // only sent one). Check for per-image errors.
  const imageResponse = data.responses && data.responses[0];

  if (!imageResponse) {
    throw new Error('Cloud Vision returned an empty response. The image may be invalid.');
  }

  // Check for per-image errors (different from HTTP errors — the request
  // succeeded but this particular image had a problem).
  if (imageResponse.error) {
    const errMsg = imageResponse.error.message || 'Unknown error processing image';
    throw new Error(`Cloud Vision image error: ${errMsg}`);
  }

  // -------------------------------------------------------------------------
  // STEP 5: Extract text blocks from the response.
  //
  // We prefer fullTextAnnotation because it gives us structured data
  // (blocks > paragraphs) rather than just a flat list of words. This
  // produces better results for translation because related text stays
  // grouped together.
  // -------------------------------------------------------------------------
  if (imageResponse.fullTextAnnotation) {
    return extractFromFullTextAnnotation(imageResponse.fullTextAnnotation);
  }

  // Fallback: if fullTextAnnotation is missing (rare, but happens with very
  // simple images), use the flat textAnnotations array.
  if (imageResponse.textAnnotations && imageResponse.textAnnotations.length > 0) {
    return extractFromTextAnnotations(imageResponse.textAnnotations);
  }

  // No text found in the image — return empty array.
  // This is not an error; the image simply doesn't contain any text.
  console.info('[Cloud Vision] No text detected in the image.');
  return [];
}


// =============================================================================
// RESPONSE PARSING HELPERS
// =============================================================================

/**
 * extractFromFullTextAnnotation — Extracts text blocks from Cloud Vision's
 * structured fullTextAnnotation response.
 *
 * The hierarchy is: pages > blocks > paragraphs > words > symbols.
 * We extract at the PARAGRAPH level for translation (a good middle ground
 * between word-level and block-level granularity).
 *
 * @param {object} fullTextAnnotation - The fullTextAnnotation object from the API
 * @returns {Array} Normalized text blocks
 */
function extractFromFullTextAnnotation(fullTextAnnotation) {
  const results = [];

  // Safety check
  if (!fullTextAnnotation.pages || fullTextAnnotation.pages.length === 0) {
    return results;
  }

  // Cloud Vision can return multiple "pages" (for multi-page documents like
  // PDFs), but for single images there's always exactly one page.
  for (const page of fullTextAnnotation.pages) {
    if (!page.blocks) continue;

    for (const block of page.blocks) {
      // Skip non-text blocks. Cloud Vision can detect different block types:
      //   TEXT = regular text
      //   TABLE = tabular data
      //   PICTURE = image region
      //   RULER = separator line
      //   BARCODE = barcode
      // We only want text blocks.
      if (block.blockType !== 'TEXT') continue;
      if (!block.paragraphs) continue;

      for (const paragraph of block.paragraphs) {
        // Build the paragraph text from its words.
        const paragraphText = extractParagraphText(paragraph);

        if (!paragraphText) continue;

        // Get the bounding box for the entire paragraph.
        const bbox = vertexArrayToBbox(paragraph.boundingBox);

        // Calculate the average confidence for the paragraph by averaging
        // the confidence of all its symbols (characters).
        const confidence = calculateParagraphConfidence(paragraph);

        // Determine if the text is vertical (common in CJK writing).
        // Cloud Vision doesn't directly tell us this, but we can infer it
        // from the bounding box aspect ratio and the language.
        const orientation = inferOrientation(paragraph, bbox);

        results.push({
          text: paragraphText,
          bbox: bbox,
          confidence: confidence,
          orientation: orientation,
        });
      }
    }
  }

  return results;
}


/**
 * extractParagraphText — Builds the full text string for a paragraph by
 * concatenating its words and symbols.
 *
 * Cloud Vision breaks text down to the symbol (character) level, and each
 * symbol can have a "detectedBreak" property indicating what comes after it:
 *
 *   - SPACE: a regular space between words
 *   - SURE_SPACE: a wide space (like between columns)
 *   - EOL_SURE_SPACE: end of line with space
 *   - HYPHEN: a hyphenated line break
 *   - LINE_BREAK: a line break
 *
 * We use these break types to reconstruct the text with proper spacing.
 *
 * @param {object} paragraph - A paragraph object from Cloud Vision
 * @returns {string} The reconstructed paragraph text
 */
function extractParagraphText(paragraph) {
  if (!paragraph.words) return '';

  let text = '';

  for (const word of paragraph.words) {
    if (!word.symbols) continue;

    for (const symbol of word.symbols) {
      // Append the character itself
      text += symbol.text;

      // Check if there's a break after this symbol
      const breakInfo = symbol.property && symbol.property.detectedBreak;
      if (breakInfo) {
        switch (breakInfo.type) {
          case 'SPACE':
          case 'SURE_SPACE':
            text += ' ';
            break;
          case 'EOL_SURE_SPACE':
            // End of line — for translation purposes, a space is usually
            // better than a newline (keeps sentences together).
            text += ' ';
            break;
          case 'HYPHEN':
            // Hyphenated word break — remove the hyphen and join
            // (the word continues on the next line).
            // Actually, keep the character as-is; the hyphen is already
            // in the symbol text if present.
            text += ' ';
            break;
          case 'LINE_BREAK':
            text += ' ';
            break;
          // No default needed — if there's no break, nothing is appended.
        }
      }
    }
  }

  return text.trim();
}


/**
 * calculateParagraphConfidence — Calculates the average confidence score
 * for all symbols in a paragraph.
 *
 * @param {object} paragraph - A paragraph object from Cloud Vision
 * @returns {number} Average confidence from 0.0 to 1.0
 */
function calculateParagraphConfidence(paragraph) {
  let totalConfidence = 0;
  let symbolCount = 0;

  if (!paragraph.words) return 0;

  for (const word of paragraph.words) {
    if (!word.symbols) continue;

    for (const symbol of word.symbols) {
      // Cloud Vision returns confidence as a float from 0.0 to 1.0.
      if (typeof symbol.confidence === 'number') {
        totalConfidence += symbol.confidence;
        symbolCount++;
      }
    }
  }

  return symbolCount > 0 ? totalConfidence / symbolCount : 0;
}


/**
 * inferOrientation — Determines if a paragraph's text is horizontal or vertical.
 *
 * Cloud Vision doesn't directly report text orientation in TEXT_DETECTION mode.
 * We infer it from the bounding box aspect ratio: if the box is taller than
 * it is wide by a significant margin, the text is likely vertical.
 *
 * This heuristic works well for CJK vertical text (tategaki) which produces
 * tall, narrow bounding boxes. It's not perfect, but it's a good starting point.
 *
 * @param {object} paragraph - A paragraph object from Cloud Vision (for word count)
 * @param {number[]} bbox - The [x1, y1, x2, y2] bounding box
 * @returns {string} "horizontal" or "vertical"
 */
function inferOrientation(paragraph, bbox) {
  if (!bbox || bbox.length < 4) return 'horizontal';

  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];

  // If height is more than 2x the width AND there are enough characters,
  // the text is probably vertical. Single characters can have any aspect
  // ratio, so we only flag multi-character text as vertical.
  const wordCount = paragraph.words ? paragraph.words.length : 0;

  // For very short text (1-2 words), don't guess vertical — it's unreliable.
  if (wordCount <= 2) return 'horizontal';

  // Aspect ratio check: height/width > 2 suggests vertical text.
  if (width > 0 && height / width > 2.0) {
    return 'vertical';
  }

  return 'horizontal';
}


/**
 * extractFromTextAnnotations — Fallback extraction from the flat textAnnotations
 * array when fullTextAnnotation is not available.
 *
 * The first element in textAnnotations is the full image text (we skip it).
 * Each subsequent element is an individual word.
 *
 * Since we don't have paragraph grouping here, we return each word as its
 * own block. The OCR Manager can optionally merge nearby blocks later.
 *
 * @param {Array} textAnnotations - Array of text annotation objects
 * @returns {Array} Normalized text blocks
 */
function extractFromTextAnnotations(textAnnotations) {
  // Skip the first element — it's the full-image summary text.
  return textAnnotations.slice(1).map(annotation => ({
    text: annotation.description || '',
    bbox: vertexArrayToBbox(annotation.boundingPoly),
    confidence: 0.9, // textAnnotations don't include confidence; assume high
    orientation: 'horizontal', // Can't determine from this format
  }));
}


/**
 * vertexArrayToBbox — Converts Cloud Vision's polygon format to our [x1,y1,x2,y2] format.
 *
 * Cloud Vision represents bounding boxes as polygons with 4 vertices:
 *   { "vertices": [{ "x": 10, "y": 20 }, { "x": 80, "y": 20 }, { "x": 80, "y": 45 }, { "x": 10, "y": 45 }] }
 *
 * The vertices are in order: top-left, top-right, bottom-right, bottom-left.
 * But they can also be slightly rotated for angled text.
 *
 * We convert to an axis-aligned bounding box by taking the min/max of all
 * x and y coordinates.
 *
 * NOTE: Vertices sometimes have missing x or y values (the API returns
 * 0 by omitting the field). We default missing values to 0.
 *
 * @param {object} boundingPoly - Cloud Vision's boundingPoly object
 * @returns {number[]} [x1, y1, x2, y2] bounding box
 */
function vertexArrayToBbox(boundingPoly) {
  // Handle both "vertices" and "normalizedVertices" (the latter uses 0-1 coordinates).
  const vertices = (boundingPoly && (boundingPoly.vertices || boundingPoly.normalizedVertices)) || [];

  if (vertices.length === 0) {
    return [0, 0, 0, 0];
  }

  // Extract all x and y values, defaulting missing values to 0.
  const xValues = vertices.map(v => Number(v.x) || 0);
  const yValues = vertices.map(v => Number(v.y) || 0);

  // Return the axis-aligned bounding box.
  return [
    Math.round(Math.min(...xValues)),
    Math.round(Math.min(...yValues)),
    Math.round(Math.max(...xValues)),
    Math.round(Math.max(...yValues)),
  ];
}


// =============================================================================
// ERROR HANDLING HELPERS
// =============================================================================

/**
 * parseResponseSafely — Tries to parse an HTTP response as JSON.
 * Returns an empty object if parsing fails (so we don't throw on top of
 * an error we're already handling).
 *
 * @param {Response} response - The fetch Response object
 * @returns {Promise<object>} Parsed JSON or empty object
 */
async function parseResponseSafely(response) {
  try {
    return await response.json();
  } catch (_parseError) {
    return {};
  }
}


/**
 * extractApiErrorMessage — Converts an API error response into a
 * user-friendly error message.
 *
 * Different HTTP status codes indicate different problems, and we provide
 * specific guidance for each one so the user knows how to fix the issue.
 *
 * @param {object} errorBody - Parsed JSON error response from the API
 * @param {number} statusCode - HTTP status code
 * @returns {string} A user-friendly error message
 */
function extractApiErrorMessage(errorBody, statusCode) {
  // Try to extract Google's error message from the response.
  const googleMessage =
    (errorBody.error && errorBody.error.message) ||
    JSON.stringify(errorBody).slice(0, 200);

  switch (statusCode) {
    case 400:
      return (
        'Cloud Vision: Bad request. The image may be too large (max 20 MB), ' +
        'in an unsupported format, or corrupted. ' +
        `Details: ${googleMessage}`
      );

    case 401:
      return (
        'Cloud Vision: Invalid API key. Please check your API key in the ' +
        'extension settings. Make sure you copied the entire key. ' +
        `Details: ${googleMessage}`
      );

    case 403:
      return (
        'Cloud Vision: Access denied. This usually means one of:\n' +
        '  1. The Cloud Vision API is not enabled in your Google Cloud project\n' +
        '  2. Billing is not enabled on the project\n' +
        '  3. The API key has restrictions that block this request\n' +
        'Go to https://console.cloud.google.com/apis/library/vision.googleapis.com to enable it. ' +
        `Details: ${googleMessage}`
      );

    case 429:
      return (
        'Cloud Vision: Rate limit exceeded. You have sent too many requests ' +
        'in a short time. Wait a minute and try again, or upgrade your quota. ' +
        `Details: ${googleMessage}`
      );

    default:
      if (statusCode >= 500) {
        return (
          `Cloud Vision: Server error (HTTP ${statusCode}). ` +
          "Google's servers are having issues. Try again in a few moments. " +
          `Details: ${googleMessage}`
        );
      }
      return (
        `Cloud Vision: Unexpected error (HTTP ${statusCode}). ` +
        `Details: ${googleMessage}`
      );
  }
}
