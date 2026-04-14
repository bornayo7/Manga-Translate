import React from "react";

const LANGUAGES = [
  { code: "en", name: "English", native: "English" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "zh-CN", name: "Chinese (Simplified)", native: "简体中文" },
  { code: "zh-TW", name: "Chinese (Traditional)", native: "繁體中文" },
  { code: "ko", name: "Korean", native: "한국어" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "fr", name: "French", native: "Français" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "ar", name: "Arabic", native: "العربية" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "th", name: "Thai", native: "ไทย" },
  { code: "vi", name: "Vietnamese", native: "Tiếng Việt" },
  { code: "it", name: "Italian", native: "Italiano" },
];

export default function LanguageSelector({
  sourceLanguage,
  onSourceChange,
  targetLanguage,
  onTargetChange,
}) {
  function handleSwap() {
    if (sourceLanguage === "auto") {
      return;
    }

    onSourceChange(targetLanguage);
    onTargetChange(sourceLanguage);
  }

  return (
    <div className="language-selector">
      <div className="language-grid">
        <div className="form-group">
          <label className="form-label" htmlFor="source-language">
            Source
          </label>
          <select
            id="source-language"
            className="form-select"
            value={sourceLanguage}
            onChange={(event) => onSourceChange(event.target.value)}
          >
            <option value="auto">Auto-detect</option>
            <option disabled>---</option>
            {LANGUAGES.map((language) => (
              <option key={`source-${language.code}`} value={language.code}>
                {language.name} ({language.native})
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className="language-swap-button"
          onClick={handleSwap}
          disabled={sourceLanguage === "auto"}
          aria-label="Swap source and target languages"
          title={
            sourceLanguage === "auto"
              ? "Pick a source language to swap"
              : "Swap languages"
          }
        >
          ⇄
        </button>

        <div className="form-group">
          <label className="form-label" htmlFor="target-language">
            Target
          </label>
          <select
            id="target-language"
            className="form-select"
            value={targetLanguage}
            onChange={(event) => onTargetChange(event.target.value)}
          >
            {LANGUAGES.map((language) => (
              <option key={`target-${language.code}`} value={language.code}>
                {language.name} ({language.native})
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="form-hint">
        Auto-detect works well for most pages. Set the source manually if OCR
        or translation keeps guessing wrong.
      </p>
    </div>
  );
}
