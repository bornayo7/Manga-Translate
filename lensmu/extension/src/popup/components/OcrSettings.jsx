import React from "react";
import ApiKeyInput from "./ApiKeyInput.jsx";
import RichSelect from "./RichSelect.jsx";

export const ENGINE_OPTIONS = [
  {
    id: "paddleocr",
    name: "PaddleOCR",
    description: "Balanced, high-accuracy OCR with strong CJK coverage.",
    type: "server",
    badgeVariant: "server",
    badges: ["Server", "CJK"],
  },
  {
    id: "mangaocr",
    name: "MangaOCR",
    description: "Best for Japanese manga bubbles, stylized lettering, and vertical text.",
    type: "server",
    badgeVariant: "server",
    badges: ["Server", "JP"],
  },
  {
    id: "tesseract",
    name: "Tesseract.js",
    description: "Runs fully in the browser with zero backend setup.",
    type: "local",
    badgeVariant: "local",
    badges: ["Local", "No setup"],
  },
  {
    id: "google_vision",
    name: "Google Cloud Vision",
    description: "Commercial OCR with broad language support and fast setup once keyed.",
    type: "cloud",
    badgeVariant: "cloud",
    badges: ["Cloud", "API key"],
  },
  {
    id: "custom_ocr",
    name: "Custom OCR API",
    description: "Connect your own OCR endpoint and keep the response format normalized.",
    type: "custom",
    badgeVariant: "custom",
    badges: ["Custom", "API"],
  },
];

export default function OcrSettings({
  engine,
  onEngineChange,
  backendUrl,
  onBackendUrlChange,
  googleCloudApiKey,
  onGoogleCloudApiKeyChange,
  customOcrUrl,
  onCustomOcrUrlChange,
  customOcrApiKey,
  onCustomOcrApiKeyChange,
}) {
  const selectedEngine = ENGINE_OPTIONS.find((option) => option.id === engine);

  return (
    <div className="choice-section">
      <RichSelect
        id="ocr-engine-select"
        label="OCR engine"
        value={engine}
        options={ENGINE_OPTIONS}
        onChange={onEngineChange}
      />

      {selectedEngine?.type === "server" && (
        <div className="config-card fade-in">
          <div className="form-group">
            <label className="form-label" htmlFor="ocr-backend-url">
              Backend server URL
            </label>
            <input
              id="ocr-backend-url"
              type="url"
              className="form-input"
              value={backendUrl}
              onChange={(event) => onBackendUrlChange(event.target.value)}
              placeholder="http://localhost:8000"
            />
            <p className="form-hint">
              Used by PaddleOCR and MangaOCR. Keep it pointed at the FastAPI
              backend that exposes `/health` and OCR routes.
            </p>
          </div>
        </div>
      )}

      {selectedEngine?.type === "cloud" && (
        <div className="config-card fade-in">
          <ApiKeyInput
            label="Google Cloud Vision API key"
            placeholder="AIza..."
            storageKey="googleCloudApiKey"
            value={googleCloudApiKey}
            onChange={onGoogleCloudApiKeyChange}
          />
          <p className="form-hint">
            Enable Cloud Vision in Google Cloud, then paste the key used for
            OCR requests here.
          </p>

          <div className="card-divider" />

          <ApiKeyInput
            label="Custom OCR API key"
            placeholder="Optional override"
            storageKey="customOcrApiKey"
            value={customOcrApiKey}
            onChange={onCustomOcrApiKeyChange}
          />
          <p className="form-hint">
            Optional override for OCR-only setups. If this is filled in, the
            OCR engine will use it before the standard Google Vision key.
          </p>
        </div>
      )}

      {selectedEngine?.type === "custom" && (
        <div className="config-card fade-in">
          <div className="form-group">
            <label className="form-label" htmlFor="custom-ocr-url">
              OCR endpoint URL
            </label>
            <input
              id="custom-ocr-url"
              type="url"
              className="form-input"
              value={customOcrUrl || ""}
              onChange={(event) => onCustomOcrUrlChange(event.target.value)}
              placeholder="http://localhost:3000/ocr"
            />
          </div>

          <ApiKeyInput
            label="Custom OCR API key"
            placeholder="Optional for local servers"
            storageKey="customOcrApiKey"
            value={customOcrApiKey}
            onChange={onCustomOcrApiKeyChange}
          />

          <p className="form-hint">
            Sends `image` and `imageBase64` in a JSON POST body. Return either
            `detections` with `[x1, y1, x2, y2]` boxes or normalized `blocks`.
          </p>
        </div>
      )}

      {selectedEngine?.type === "local" && (
        <div className="config-card fade-in">
          <p className="form-hint">
            Tesseract.js needs no backend or API key. The first run may be
            slower while language data is cached.
          </p>
        </div>
      )}
    </div>
  );
}
