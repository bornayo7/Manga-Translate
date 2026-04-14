import React from "react";
import ApiKeyInput from "./ApiKeyInput.jsx";

function clampNumber(value, min, max, fallback) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numericValue));
}

function RangeField({
  id,
  label,
  min,
  max,
  step,
  value,
  onChange,
}) {
  return (
    <div className="range-field">
      <div className="range-field-header">
        <label className="form-label" htmlFor={id}>
          {label}
        </label>
        <span className="range-field-value">{Number(value).toFixed(step < 1 ? 2 : 0)}</span>
      </div>

      <input
        id={id}
        type="range"
        className="range-input"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) =>
          onChange(clampNumber(event.target.value, min, max, value))
        }
      />
    </div>
  );
}

export default function ReadAloudSettings({
  settings,
  onSettingChange,
  voices = [],
  voicesStatus = "",
  isLoadingVoices = false,
  isTestingVoice = false,
  onLoadVoices,
  onTestVoice,
}) {
  const hasApiKey = Boolean(settings.elevenLabsApiKey?.trim());
  const hasVoiceId = Boolean(settings.elevenLabsVoiceId?.trim());

  return (
    <div className="choice-section">
      <div className={`toggle-row ${!settings.enableReadAloud ? "read-aloud-toggle" : ""}`}>
        <div className="toggle-copy">
          <div className="toggle-title-row">
            <span className="toggle-label">Enable per-image Read Aloud</span>
            <span className="mini-badge">Optional</span>
          </div>
          <p className="toggle-description">
            Adds a small Read button after an image finishes translating. It
            uses the translated text only and never auto-plays.
          </p>
        </div>

        <button
          type="button"
          className={`toggle-control ${settings.enableReadAloud ? "is-on" : ""}`}
          role="switch"
          aria-checked={settings.enableReadAloud}
          aria-label="Enable read aloud"
          onClick={() =>
            onSettingChange("enableReadAloud", !settings.enableReadAloud)
          }
        >
          <span className="toggle-thumb" />
        </button>
      </div>

      {settings.enableReadAloud ? (
        <>
          <div className="config-card fade-in">
            <ApiKeyInput
              label="ElevenLabs API key"
              placeholder="Paste your ElevenLabs key"
              storageKey="elevenLabsApiKey"
              value={settings.elevenLabsApiKey}
              onChange={(value) => onSettingChange("elevenLabsApiKey", value)}
            />

            <div className="field-grid field-grid--double">
              <div className="form-group">
                <label className="form-label" htmlFor="elevenlabs-voice-id">
                  Voice ID
                </label>
                <input
                  id="elevenlabs-voice-id"
                  type="text"
                  className="form-input"
                  value={settings.elevenLabsVoiceId}
                  onChange={(event) =>
                    onSettingChange("elevenLabsVoiceId", event.target.value)
                  }
                  placeholder="voice_xxxxx"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="elevenlabs-model-id">
                  Model ID
                </label>
                <input
                  id="elevenlabs-model-id"
                  type="text"
                  className="form-input"
                  value={settings.elevenLabsModelId}
                  onChange={(event) =>
                    onSettingChange("elevenLabsModelId", event.target.value)
                  }
                  placeholder="eleven_flash_v2_5"
                />
              </div>
            </div>

            <div className="field-grid field-grid--double">
              <div className="form-group">
                <label className="form-label" htmlFor="elevenlabs-output-format">
                  Output format
                </label>
                <input
                  id="elevenlabs-output-format"
                  type="text"
                  className="form-input"
                  value={settings.elevenLabsOutputFormat}
                  onChange={(event) =>
                    onSettingChange("elevenLabsOutputFormat", event.target.value)
                  }
                  placeholder="mp3_44100_128"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="elevenlabs-voice-picker">
                  Loaded voices
                </label>
                <select
                  id="elevenlabs-voice-picker"
                  className="form-select"
                  value={settings.elevenLabsVoiceId}
                  onChange={(event) =>
                    onSettingChange("elevenLabsVoiceId", event.target.value)
                  }
                  disabled={!voices.length}
                >
                  <option value="">
                    {voices.length ? "Choose a loaded voice" : "Load voices first"}
                  </option>
                  {voices.map((voice) => (
                    <option key={voice.voiceId} value={voice.voiceId}>
                      {voice.name}
                      {voice.category ? ` · ${voice.category}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="action-row">
              <button
                type="button"
                className="secondary-button"
                onClick={onLoadVoices}
                disabled={!hasApiKey || isLoadingVoices}
              >
                {isLoadingVoices ? "Loading..." : "Load Voices"}
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={onTestVoice}
                disabled={!hasApiKey || !hasVoiceId || isTestingVoice}
              >
                {isTestingVoice ? "Testing..." : "Test Voice"}
              </button>
            </div>

            {voicesStatus ? (
              <p className="inline-status">{voicesStatus}</p>
            ) : (
              <p className="form-hint">
                Use the stored key only. The extension sends speech requests from
                the background worker, not the OCR server.
              </p>
            )}
          </div>

          <div className="config-card fade-in">
            <div className="range-grid">
              <RangeField
                id="elevenlabs-stability"
                label="Stability"
                min={0}
                max={1}
                step={0.01}
                value={settings.elevenLabsStability}
                onChange={(value) => onSettingChange("elevenLabsStability", value)}
              />

              <RangeField
                id="elevenlabs-similarity-boost"
                label="Similarity boost"
                min={0}
                max={1}
                step={0.01}
                value={settings.elevenLabsSimilarityBoost}
                onChange={(value) =>
                  onSettingChange("elevenLabsSimilarityBoost", value)
                }
              />

              <RangeField
                id="elevenlabs-style"
                label="Style"
                min={0}
                max={1}
                step={0.01}
                value={settings.elevenLabsStyle}
                onChange={(value) => onSettingChange("elevenLabsStyle", value)}
              />

              <RangeField
                id="elevenlabs-speed"
                label="Speed"
                min={0.7}
                max={1.2}
                step={0.01}
                value={settings.elevenLabsSpeed}
                onChange={(value) => onSettingChange("elevenLabsSpeed", value)}
              />
            </div>

            <p className="form-hint">
              Recommended defaults: flash v2.5, mp3 44.1k/128k, stability 0.5,
              similarity 0.75, style 0, speed 1.
            </p>
          </div>
        </>
      ) : (
        <p className="section-note">
          Keep this off if you only want image translation overlays with no
          speech controls.
        </p>
      )}
    </div>
  );
}
