import React from "react";
import ApiKeyInput from "./ApiKeyInput.jsx";
import RichSelect from "./RichSelect.jsx";
import { LLM_MODEL_OPTIONS } from "../../../shared/llm-models.js";

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
    name: "MyMemory",
    description: "Free public translation with no key required and a limited daily quota.",
    needsApiKey: null,
    needsModel: false,
    badgeVariant: "provider",
    badges: ["Free"],
  },
];

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
  allowThirdPartyFallback,
  onAllowThirdPartyFallbackChange,
  migrationNotices = [],
}) {
  const selectedProvider = PROVIDER_OPTIONS.find((option) => option.id === provider);
  const models = LLM_MODEL_OPTIONS[provider] || [];
  const storedModelIsListed = models.some((model) => model.id === llmModel);

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
              {!storedModelIsListed && llmModel ? (
                /*
                 * A controlled <select> silently shows its first option when
                 * the value is not in the list, while the request keeps
                 * using the stored ID. Show the stored ID so what you see
                 * is what gets sent.
                 */
                <option value={llmModel}>{llmModel}</option>
              ) : null}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            {migrationNotices.length > 0 ? (
              <p className="form-hint form-hint--migration" role="status">
                {migrationNotices.join(" ")}
              </p>
            ) : null}
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
            public provider without extra credentials.
          </p>
        </div>
      )}

      {selectedProvider?.needsApiKey !== null && (
        <div className="config-card fade-in">
          <label className="form-label" htmlFor="allow-third-party-fallback">
            <input
              id="allow-third-party-fallback"
              type="checkbox"
              checked={Boolean(allowThirdPartyFallback)}
              onChange={(event) =>
                onAllowThirdPartyFallbackChange(event.target.checked)
              }
            />{" "}
            Allow public-provider fallback
          </label>
          <p className="form-hint">
            Off by default. When enabled, failed private or paid-provider
            requests may be retried through MyMemory.
          </p>
        </div>
      )}
    </div>
  );
}
