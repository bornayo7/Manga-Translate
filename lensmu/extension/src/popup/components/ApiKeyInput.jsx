import React, { useEffect, useState } from "react";

export default function ApiKeyInput({
  label,
  placeholder = "Enter API key...",
  storageKey = "apiKey",
  value,
  onChange,
}) {
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setSaved(false), 1200);
    return () => window.clearTimeout(timeoutId);
  }, [saved]);

  function getMaskedValue(input) {
    if (!input || input.length <= 4) {
      return input;
    }

    return "•".repeat(input.length - 4) + input.slice(-4);
  }

  function handleChange(event) {
    onChange(event.target.value);
    setSaved(true);
  }

  const inputId = `${storageKey}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <div className="api-key-input">
      <div className="api-key-header">
        <label className="api-key-label" htmlFor={inputId}>
          {label}
        </label>
        {saved ? <span className="api-key-saved">Saved</span> : null}
      </div>

      <div className="api-key-field">
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          className="api-key-input-field"
          placeholder={placeholder}
          value={value || ""}
          onChange={handleChange}
          autoComplete="off"
          spellCheck={false}
        />

        <button
          type="button"
          className="api-key-toggle"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide API key" : "Show API key"}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>

      {value && value.length > 4 && !visible ? (
        <div className="api-key-preview">Stored: {getMaskedValue(value)}</div>
      ) : null}
    </div>
  );
}
