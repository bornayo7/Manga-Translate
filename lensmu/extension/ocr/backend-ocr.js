/**
 * =============================================================================
 * LOCAL BACKEND OCR CLIENT — Talks to Our FastAPI Server for ML-Based OCR
 * =============================================================================
 *
 * WHAT THIS FILE DOES:
 * --------------------
 * This module acts as a client for our local Python FastAPI server. It sends
 * image data to the server and receives OCR results back.
 *
 * WHY DO WE NEED A LOCAL SERVER?
 * ------------------------------
 * Some of the best OCR models (PaddleOCR, Manga OCR) are written in Python
 * and use heavy machine learning frameworks (PyTorch, PaddlePaddle). These
 * models CANNOT run directly in a web browser because:
 *
 *   1. SIZE: The models are hundreds of megabytes to several gigabytes.
 *      Browsers would crash trying to load them.
 *
 *   2. DEPENDENCIES: They need Python ML libraries (PyTorch, CUDA for GPU
 *      acceleration, NumPy, OpenCV, etc.) that don't exist in JavaScript.
 *
 *   3. PERFORMANCE: Even if we could port them to JavaScript, they'd be
 *      10-100x slower without GPU acceleration. Python + CUDA can process
 *      an image in <1 second; a JavaScript port might take minutes.
 *
 *   4. WEBASSEMBLY LIMITATIONS: While WASM can run compiled code in the
 *      browser, ML frameworks use GPU compute shaders and specialized
 *      instructions that WASM doesn't support well.
 *
 * So instead, we run a lightweight Python web server (FastAPI) on the user's
 * own machine. The browser extension sends images to this local server via
 * HTTP, and the server runs the ML models and sends back the results.
 *
 * THE USER EXPERIENCE:
 * --------------------
 * For the user, this means they need to:
 *   1. Install Python 3.8+ and pip
 *   2. Install our backend package: pip install lensmu-backend
 *   3. Start the server: lensmu-backend serve
 *   4. The server runs at http://localhost:8000 by default
 *
 * The extension checks if the server is running and shows a helpful message
 * if it's not.
 *
 * PADDLEOCR vs MANGA OCR:
 * -----------------------
 * We support two ML models through the backend:
 *
 *   PaddleOCR:
 *     - General-purpose OCR from Baidu
 *     - Excellent for Chinese, Japanese, Korean text
 *     - Also good for English and other languages
 *     - Handles both detection (finding text regions) and recognition
 *     - Returns polygonal bounding boxes (4-point polygons, not just rectangles)
 *
 *   Manga OCR:
 *     - Specialized for Japanese manga text
 *     - Trained specifically on manga fonts and layouts
 *     - Better than PaddleOCR for: stylized fonts, text in speech bubbles,
 *       vertical text (tategaki), sound effects (onomatopoeia)
 *     - Requires bounding boxes as input (it does recognition only, not detection)
 *     - Only works for Japanese text
 *
 * A common workflow is to use PaddleOCR for TEXT DETECTION (finding where text is)
 * and then Manga OCR for TEXT RECOGNITION (reading what the text says). This
 * hybrid approach gives the best results for manga translation.
 *
 * =============================================================================
 */

/**
 * Default timeout for backend requests in milliseconds.
 *
 * OCR processing can take a while, especially on large images or when the
 * model is loading for the first time (cold start). We set a generous timeout
 * of 60 seconds to handle these cases.
 *
 * The FIRST request after starting the server is always slower because the
 * ML models need to be loaded into memory (and optionally onto the GPU).
 * This "cold start" can take 10-30 seconds. Subsequent requests are fast
 * (usually under 2 seconds).
 */
const REQUEST_TIMEOUT_MS = 60000;


/**
 * recognizePaddle — Sends an image to the local backend for PaddleOCR processing.
 *
 * PaddleOCR performs both text detection (finding where text is in the image)
 * and text recognition (reading what the text says) in a single pass.
 *
 * @param {string} imageBase64 - Raw Base64-encoded image data (no data URL prefix)
 *
 * @param {string} backendUrl - The URL of our local FastAPI server.
 *   Default: "http://localhost:8000"
 *   The user can change this in settings if they're running the server on
 *   a different port or on a different machine (e.g., a home server with a GPU).
 *
 * @returns {Promise<Array>} Array of recognized text blocks:
 *   [{
 *     text: "Hello world",
 *     bbox: [x1, y1, x2, y2],
 *     confidence: 0.95,
 *     orientation: "horizontal"
 *   }]
 *
 * @throws {Error} If the server is not running or returns an error
 */
export async function recognizePaddle(imageBase64, backendUrl = 'http://localhost:8000') {
  // -------------------------------------------------------------------------
  // STEP 1: Build the API endpoint URL.
  //
  // Our FastAPI backend exposes these PaddleOCR endpoints:
  //   POST /ocr/paddle — Full OCR (detect + recognize)
  //
  // The request body is JSON with the Base64 image data.
  // -------------------------------------------------------------------------
  const endpoint = `${backendUrl}/ocr/paddle`;

  // -------------------------------------------------------------------------
  // STEP 2: Send the request to the backend.
  // -------------------------------------------------------------------------
  const responseData = await sendBackendRequest(endpoint, {
    image: imageBase64,
  });

  // -------------------------------------------------------------------------
  // STEP 3: Convert PaddleOCR's response format to our normalized format.
  //
  // PaddleOCR returns results in this format:
  //   {
  //     "results": [
  //       {
  //         "text": "Hello",
  //         "confidence": 0.95,
  //         "bbox": [[10, 20], [100, 20], [100, 50], [10, 50]]
  //         // ^^ 4 corners of a polygon: TL, TR, BR, BL
  //       },
  //       ...
  //     ]
  //   }
  //
  // We need to convert the 4-point polygon to our [x1, y1, x2, y2] format.
  // -------------------------------------------------------------------------
  return normalizePaddleResults(responseData);
}


/**
 * recognizeManga — Sends an image and bounding boxes to the local backend
 * for Manga OCR processing.
 *
 * Unlike PaddleOCR, Manga OCR does NOT detect where text is — you have to
 * tell it. You provide bounding boxes (regions of the image that contain text),
 * and it reads the text in each region.
 *
 * Typical workflow:
 *   1. Use PaddleOCR (or manual selection) to find text regions
 *   2. Pass those regions to Manga OCR for better Japanese recognition
 *
 * @param {string} imageBase64 - Raw Base64-encoded image data (no data URL prefix)
 *
 * @param {Array<Array<number>>} bboxes - Array of bounding boxes to recognize.
 *   Each bbox is [x1, y1, x2, y2] in pixel coordinates.
 *   Example: [[10, 20, 100, 50], [200, 300, 350, 400]]
 *
 *   If empty, the entire image is treated as a single text region.
 *
 * @param {string} backendUrl - URL of our local FastAPI server
 *
 * @returns {Promise<Array>} Array of recognized text blocks:
 *   [{
 *     text: "Japanese text here",
 *     bbox: [x1, y1, x2, y2],
 *     confidence: 0.98,
 *     orientation: "vertical"
 *   }]
 *
 * @throws {Error} If the server is not running or returns an error
 */
export async function recognizeManga(imageBase64, bboxes = [], backendUrl = 'http://localhost:8000') {
  // -------------------------------------------------------------------------
  // STEP 1: Build the API endpoint URL.
  //
  // Our FastAPI backend exposes this Manga OCR endpoint:
  //   POST /ocr/manga — Manga-specialized recognition
  // -------------------------------------------------------------------------
  const endpoint = `${backendUrl}/ocr/manga`;

  // -------------------------------------------------------------------------
  // STEP 2: If no bounding boxes provided, use the whole image.
  //
  // When the user hasn't selected specific regions or run a detection step,
  // we pass an empty bbox array and let the backend handle the whole image
  // as one region. The backend will use the full image dimensions.
  // -------------------------------------------------------------------------
  const requestBody = {
    image: imageBase64,
    bboxes: bboxes,
  };

  // -------------------------------------------------------------------------
  // STEP 3: Send the request.
  // -------------------------------------------------------------------------
  const responseData = await sendBackendRequest(endpoint, requestBody);

  // -------------------------------------------------------------------------
  // STEP 4: Convert the response to our normalized format.
  //
  // The Manga OCR endpoint returns:
  //   {
  //     "results": [
  //       {
  //         "text": "Japanese text",
  //         "bbox": [x1, y1, x2, y2],
  //         "confidence": 0.98
  //       },
  //       ...
  //     ]
  //   }
  //
  // The response already uses our bbox format since we defined the backend API.
  // We just need to add the "orientation" field.
  // -------------------------------------------------------------------------
  return normalizeMangaResults(responseData);
}


// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * sendBackendRequest — Sends a POST request to our local FastAPI backend.
 *
 * This is the core HTTP function used by both recognizePaddle and recognizeManga.
 * It handles:
 *   - Timeout (in case the server is hanging)
 *   - Connection errors (server not running)
 *   - HTTP error responses
 *   - JSON parsing
 *
 * @param {string} endpoint - Full URL (e.g., "http://localhost:8000/ocr/paddle")
 * @param {object} body - Request body to send as JSON
 * @returns {Promise<object>} Parsed JSON response from the server
 * @throws {Error} With a user-friendly message if anything goes wrong
 */
async function sendBackendRequest(endpoint, body) {
  // -------------------------------------------------------------------------
  // Set up a timeout using AbortController.
  //
  // AbortController is a browser API that lets us cancel a fetch request.
  // If the server is frozen or processing takes too long, we abort the
  // request and throw an error instead of hanging indefinitely.
  //
  // HOW IT WORKS:
  //   1. Create an AbortController and get its "signal"
  //   2. Pass the signal to fetch()
  //   3. Set a setTimeout to call controller.abort() after our timeout
  //   4. If fetch completes before the timeout, cancel the timer
  //   5. If the timer fires first, the fetch is aborted and throws AbortError
  // -------------------------------------------------------------------------
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (fetchError) {
    // Cancel the timeout since we already got a result (an error).
    clearTimeout(timeoutId);

    // Determine what kind of error occurred.
    if (fetchError.name === 'AbortError') {
      throw new Error(
        `Backend OCR request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds. ` +
        'The image may be too large, or the server is overloaded. ' +
        'Try a smaller image or restart the backend server.'
      );
    }

    // TypeError is thrown by fetch() when the network request fails entirely.
    // This almost always means the server isn't running.
    if (fetchError instanceof TypeError || fetchError.message.includes('fetch')) {
      throw new Error(
        'Cannot connect to the local backend server. ' +
        'Please make sure the LensMU backend is running:\n\n' +
        '  1. Open a terminal\n' +
        '  2. Run: lensmu-backend serve\n' +
        '  3. Wait for "Server running at http://localhost:8000"\n\n' +
        `Attempted to reach: ${endpoint}\n` +
        `Error: ${fetchError.message}`
      );
    }

    // Unknown error — re-throw with context.
    throw new Error(`Backend request failed: ${fetchError.message}`);
  } finally {
    // Always clear the timeout to prevent memory leaks.
    // This is a good practice: if the fetch completes normally (or errors),
    // we don't want the abort timer to fire afterwards.
    clearTimeout(timeoutId);
  }

  // -------------------------------------------------------------------------
  // Handle HTTP error responses from the backend.
  // -------------------------------------------------------------------------
  if (!response.ok) {
    let errorDetail = '';
    try {
      const errorData = await response.json();
      errorDetail = errorData.detail || errorData.message || JSON.stringify(errorData);
    } catch (_parseError) {
      errorDetail = await response.text().catch(() => 'Could not read error response');
    }

    // Provide specific guidance based on the error code.
    if (response.status === 404) {
      throw new Error(
        `Backend endpoint not found: ${endpoint}. ` +
        'Make sure you are running the latest version of the LensMU backend. ' +
        'Update with: pip install --upgrade lensmu-backend'
      );
    }

    if (response.status === 422) {
      // 422 Unprocessable Entity — FastAPI returns this for validation errors.
      throw new Error(
        'Backend rejected the request (invalid data). ' +
        `This may be a bug. Details: ${errorDetail}`
      );
    }

    if (response.status === 500) {
      throw new Error(
        'Backend encountered an internal error. This often means the ML model ' +
        'crashed or ran out of memory. Check the backend terminal for error details. ' +
        `Server response: ${errorDetail}`
      );
    }

    throw new Error(
      `Backend error (HTTP ${response.status}): ${errorDetail}`
    );
  }

  // -------------------------------------------------------------------------
  // Parse and return the successful JSON response.
  // -------------------------------------------------------------------------
  try {
    return await response.json();
  } catch (_jsonError) {
    throw new Error(
      'Backend returned invalid JSON. This may be a server bug. ' +
      'Check the backend terminal for errors.'
    );
  }
}


/**
 * normalizePaddleResults — Converts PaddleOCR's response to our standard format.
 *
 * PaddleOCR returns 4-point polygonal bounding boxes (because detected text
 * regions can be rotated/skewed). We convert these to axis-aligned rectangles
 * by taking the min/max of all corner coordinates.
 *
 * PaddleOCR polygon format:
 *   [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
 *   where points are: top-left, top-right, bottom-right, bottom-left
 *
 * Our format:
 *   [x_min, y_min, x_max, y_max]
 *
 * @param {object} responseData - Raw JSON response from the backend
 * @returns {Array} Normalized text blocks
 */
function normalizePaddleResults(responseData) {
  const results = responseData.results || responseData.data || [];

  return results.map(item => {
    // Convert the 4-point polygon to a simple [x1, y1, x2, y2] rectangle.
    const bbox = polygonToBbox(item.bbox);

    // Determine text orientation from the bounding box shape.
    // If the box is significantly taller than wide, the text is likely vertical.
    const orientation = inferOrientationFromBbox(bbox);

    return {
      text: item.text || '',
      bbox: bbox,
      confidence: item.confidence || 0,
      orientation: orientation,
    };
  });
}


/**
 * normalizeMangaResults — Converts Manga OCR's response to our standard format.
 *
 * Manga OCR already returns results in a format close to ours because we
 * designed the backend API to match. We just need to add the orientation
 * field (Manga OCR is almost always used for vertical Japanese text).
 *
 * @param {object} responseData - Raw JSON response from the backend
 * @returns {Array} Normalized text blocks
 */
function normalizeMangaResults(responseData) {
  const results = responseData.results || responseData.data || [];

  return results.map(item => {
    // Manga OCR bboxes should already be in [x1, y1, x2, y2] format.
    // But we still validate and convert just in case.
    const bbox = Array.isArray(item.bbox)
      ? (item.bbox.length === 4
          ? item.bbox.map(v => Math.round(Number(v) || 0))
          : polygonToBbox(item.bbox))
      : [0, 0, 0, 0];

    const orientation = inferOrientationFromBbox(bbox);

    return {
      text: item.text || '',
      bbox: bbox,
      // Manga OCR doesn't always report confidence. When it does, it's
      // usually very high because it's specialized for manga. Default to
      // a reasonable value.
      confidence: item.confidence || 0.9,
      orientation: orientation,
    };
  });
}


/**
 * polygonToBbox — Converts a polygon (array of [x, y] points) to an
 * axis-aligned bounding box [x_min, y_min, x_max, y_max].
 *
 * This handles both PaddleOCR's format (array of 2-element arrays) and
 * other formats gracefully.
 *
 * @param {Array} polygon - Array of [x, y] coordinate pairs, or a flat
 *   [x1, y1, x2, y2] array (which we return as-is)
 * @returns {number[]} [x_min, y_min, x_max, y_max]
 */
function polygonToBbox(polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) {
    return [0, 0, 0, 0];
  }

  // If it's already a flat 4-element array of numbers, return as-is.
  if (polygon.length === 4 && typeof polygon[0] === 'number') {
    return polygon.map(v => Math.round(Number(v) || 0));
  }

  // Otherwise, it's an array of [x, y] pairs — extract min/max.
  const xValues = [];
  const yValues = [];

  for (const point of polygon) {
    if (Array.isArray(point) && point.length >= 2) {
      xValues.push(Number(point[0]) || 0);
      yValues.push(Number(point[1]) || 0);
    }
  }

  if (xValues.length === 0) {
    return [0, 0, 0, 0];
  }

  return [
    Math.round(Math.min(...xValues)),
    Math.round(Math.min(...yValues)),
    Math.round(Math.max(...xValues)),
    Math.round(Math.max(...yValues)),
  ];
}


/**
 * inferOrientationFromBbox — Guesses text orientation from bounding box shape.
 *
 * Simple heuristic: if the box is more than 1.5x taller than wide, it's
 * probably vertical text (common in Japanese manga).
 *
 * This is a rough estimate. For more accurate orientation detection, the
 * backend ML models could return this information directly.
 *
 * @param {number[]} bbox - [x1, y1, x2, y2] bounding box
 * @returns {string} "horizontal" or "vertical"
 */
function inferOrientationFromBbox(bbox) {
  if (!bbox || bbox.length < 4) return 'horizontal';

  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];

  // Avoid division by zero for zero-width boxes.
  if (width <= 0) return 'vertical';

  return (height / width > 1.5) ? 'vertical' : 'horizontal';
}
