import React from "react";
import ApiKeyInput from "./ApiKeyInput.jsx";
import RichSelect from "./RichSelect.jsx";

export const PROVIDER_OPTIONS = [
  {
    id: "openai",
    name: "OpenAI",
    description: "Natural, context-aware translations for nuanced dialogue.",
    needsApiKey: "openai",
    needsModel: true,
    badgeVariant: "provider",
    badges: ["LLM"],
  },
  {
    id: "claude",
    name: "Claude",
    description: "Strong at preserving tone across longer or denser passages.",
    needsApiKey: "claude",
    needsModel: true,
    badgeVariant: "provider",
    badges: ["LLM"],
  },
  {
    id: "gemini",
    name: "Gemini",
    description: "Fast general-purpose model with a good quality-to-cost balance.",
    needsApiKey: "gemini",
    needsModel: true,
    badgeVariant: "provider",
    badges: ["LLM", "Fast"],
  },
  {
    id: "custom",
    name: "Custom OpenAI-compatible API",
    description: "Works with local or hosted APIs that speak the OpenAI chat format.",
    needsApiKey: "custom",
    needsModel: false,
    badgeVariant: "provider",
    badges: ["Custom"],
  },
  {
    id: "libre",
    name: "LibreTranslate / MyMemory",
    description: "Free fallback with no key required and simpler setup.",
    needsApiKey: null,
    needsModel: false,
    badgeVariant: "provider",
    badges: ["Free"],
  },
];

const MODEL_OPTIONS = {
  openai: [
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "gpt-4", name: "GPT-4" },
    { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
  ],
  claude: [
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
    { id: "claude-3-opus-20240229", name: "Claude 3 Opus" },
    { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku" },
  ],
  gemini: [
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
    { id: "gemini-2.5-pro-preview-06-05", name: "Gemini 2.5 Pro" },
    { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
  ],
};

export default function TranslateSettings({
  provider,
  onProviderChange,
  openaiApiKey,
  onOpenaiApiKeyChange,
  claudeApiKey,
  onClaudeApiKeyChange,
  geminiApiKey,
  onGeminiApiKeyChange,
  llmModel,
  onLlmModelChange,
  customApiKey,
  onCustomApiKeyChange,
  customBaseUrl,
  onCustomBaseUrlChange,
  customModelName,
  onCustomModelNameChange,
}) {
  const selectedProvider = PROVIDER_OPTIONS.find((option) => option.id === provider);
  const models = MODEL_OPTIONS[provider] || [];

  return (
    <div className="choice-section">
      <RichSelect
        id="translation-provider-select"
        label="Translation provider"
        value={provider}
        options={PROVIDER_OPTIONS}
        onChange={onProviderChange}
      />

      {selectedProvider?.needsApiKey === "openai" && (
        <div className="config-card fade-in">
          <ApiKeyInput
            label="OpenAI API key"
            placeholder="sk-..."
            storageKey="openaiApiKey"
            value={openaiApiKey}
            onChange={onOpenaiApiKeyChange}
          />
        </div>
      )}

      {selectedProvider?.needsApiKey === "claude" && (
        <div className="config-card fade-in">
          <ApiKeyInput
            label="Anthropic API key"
            placeholder="sk-ant-..."
            storageKey="claudeApiKey"
            value={claudeApiKey}
            onChange={onClaudeApiKeyChange}
          />
        </div>
      )}

      {selectedProvider?.needsApiKey === "gemini" && (
        <div className="config-card fade-in">
          <ApiKeyInput
            label="Gemini API key"
            placeholder="AIza..."
            storageKey="geminiApiKey"
            value={geminiApiKey}
            onChange={onGeminiApiKeyChange}
          />
          <p className="form-hint">
            Create one in{" "}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google AI Studio
            </a>
            .
          </p>
        </div>
      )}

      {selectedProvider?.needsApiKey === "custom" && (
        <div className="config-card fade-in">
          <div className="form-group">
            <label className="form-label" htmlFor="custom-base-url">
              API base URL
            </label>
            <input
              id="custom-base-url"
              type="url"
              className="form-input"
              value={customBaseUrl || ""}
              onChange={(event) => onCustomBaseUrlChange(event.target.value)}
              placeholder="http://localhost:11434/v1"
            />
          </div>

          <ApiKeyInput
            label="API key"
            placeholder="Optional for local servers"
            storageKey="customApiKey"
            value={customApiKey}
            onChange={onCustomApiKeyChange}
          />

          <div className="form-group">
            <label className="form-label" htmlFor="custom-model-name">
              Model name
            </label>
            <input
              id="custom-model-name"
              type="text"
              className="form-input"
              value={customModelName || ""}
              onChange={(event) => onCustomModelNameChange(event.target.value)}
              placeholder="llama3, mistral, gpt-4o..."
            />
            <p className="form-hint">
              Useful for Ollama, LM Studio, hosted compatible APIs, or Azure
              deployments.
            </p>
          </div>
        </div>
      )}

      {selectedProvider?.needsModel && models.length > 0 && (
        <div className="config-card fade-in">
          <div className="form-group">
            <label className="form-label" htmlFor="llm-model">
              Model
            </label>
            <select
              id="llm-model"
              className="form-select"
              value={llmModel}
              onChange={(event) => onLlmModelChange(event.target.value)}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            <p className="form-hint">
              Faster models keep the extension snappy. Larger models usually
              read tone and context better.
            </p>
          </div>
        </div>
      )}

      {selectedProvider?.needsApiKey === null && (
        <div className="config-card fade-in">
          <p className="form-hint">
            No key is required here. Use this when you want quick setup or a
            fallback provider without extra credentials.
          </p>
        </div>
      )}
    </div>
  );
}
