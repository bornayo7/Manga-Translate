import React, { useEffect, useRef, useState } from "react";
import OcrSettings, { ENGINE_OPTIONS } from "./components/OcrSettings.jsx";
import TranslateSettings, {
  PROVIDER_OPTIONS,
} from "./components/TranslateSettings.jsx";
import LanguageSelector from "./components/LanguageSelector.jsx";
import ReadAloudSettings from "./components/ReadAloudSettings.jsx";
import {
  DEFAULT_EXTENSION_SETTINGS,
  SETTINGS_STORAGE_KEY,
  mergeWithDefaults,
} from "../../shared/preferences.js";

const TAB_ITEMS = [
  { id: "home", label: "Home" },
  { id: "engines", label: "Engines" },
  { id: "settings", label: "Settings" },
];

const OVERLAY_FONT_OPTIONS = [
  { id: "sans", label: "Sans Serif" },
  { id: "serif", label: "Serif" },
  { id: "manga", label: "Manga-Friendly" },
  { id: "mono", label: "Monospace" },
];

const OVERLAY_ALIGNMENT_OPTIONS = [
  { id: "auto", label: "Auto" },
  { id: "left", label: "Left" },
  { id: "center", label: "Center" },
  { id: "right", label: "Right" },
];

const MIN_FONT_SIZE_OPTIONS = [8, 10, 12, 14, 16];
const READ_ALOUD_TEST_TEXT = "This is a VisionTranslate read aloud test.";
const DEFAULT_PROVIDER_MODELS = {
  openai: "gpt-4o-mini",
  claude: "claude-sonnet-4-20250514",
  gemini: "gemini-2.0-flash",
};

const PROVIDER_MODEL_PREFIXES = {
  openai: ["gpt-"],
  claude: ["claude-"],
  gemini: ["gemini-"],
};

function normalizeLoadedSettings(rawSettings = {}) {
  const nextSettings = { ...rawSettings };

  if (nextSettings.translationProvider === "google") {
    nextSettings.translationProvider = "libre";
  }

  const provider = nextSettings.translationProvider;
  const prefixes = PROVIDER_MODEL_PREFIXES[provider];
  if (
    prefixes &&
    !prefixes.some((prefix) => String(nextSettings.llmModel || "").startsWith(prefix))
  ) {
    nextSettings.llmModel = DEFAULT_PROVIDER_MODELS[provider];
  }

  return nextSettings;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      resolve(null);
      return;
    }

    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function queryActiveTab() {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.tabs?.query) {
      resolve(null);
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0] || null);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.tabs?.sendMessage || !tabId) {
      resolve(null);
      return;
    }

    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

async function persistSettingsSnapshot(settings) {
  try {
    await sendRuntimeMessage({
      action: "SAVE_SETTINGS",
      payload: { settings },
    });
  } catch (error) {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({
        [SETTINGS_STORAGE_KEY]: mergeWithDefaults(settings),
      });
      return;
    }

    throw error;
  }
}

function ToggleRow({
  label,
  description,
  checked,
  onToggle,
  badge,
  disabled = false,
}) {
  return (
    <div className={`toggle-row ${disabled ? "is-disabled" : ""}`}>
      <div className="toggle-copy">
        <div className="toggle-title-row">
          <span className="toggle-label">{label}</span>
          {badge ? <span className="mini-badge">{badge}</span> : null}
        </div>
        {description ? <p className="toggle-description">{description}</p> : null}
      </div>

      <button
        type="button"
        className={`toggle-control ${checked ? "is-on" : ""}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onToggle}
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState(DEFAULT_EXTENSION_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [serverStatus, setServerStatus] = useState("checking");
  const [activeTabId, setActiveTabId] = useState(null);
  const [tabState, setTabState] = useState({ active: false });
  const [activeTab, setActiveTab] = useState("home");
  const [isTogglingPage, setIsTogglingPage] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [tabUnavailable, setTabUnavailable] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [elevenLabsVoices, setElevenLabsVoices] = useState([]);
  const [readAloudStatus, setReadAloudStatus] = useState("");
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const hasHydrated = useRef(false);
  const testAudioRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPopupState() {
      try {
        const [settingsResponse, currentTab, authState] = await Promise.all([
          sendRuntimeMessage({ action: "GET_SETTINGS" }).catch(() => null),
          queryActiveTab(),
          sendRuntimeMessage({ action: "GET_AUTH_STATE" }).catch(() => null),
        ]);

        if (!cancelled && authState?.isAuthenticated) {
          setAuthUser(authState.user);
        }

        if (cancelled) {
          return;
        }

        setSettings(
          mergeWithDefaults(
            normalizeLoadedSettings(settingsResponse?.settings || {})
          )
        );

        if (currentTab?.id) {
          setActiveTabId(currentTab.id);

          const tabStateResponse = await sendRuntimeMessage({
            action: "GET_TAB_STATE",
            payload: { tabId: currentTab.id },
          }).catch(() => null);

          if (!cancelled) {
            setTabState(tabStateResponse?.state || { active: false });
          }
        } else {
          setTabUnavailable(true);
        }
      } finally {
        if (!cancelled) {
          setLoaded(true);
        }
      }
    }

    loadPopupState();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.darkMode);
  }, [settings.darkMode]);

  useEffect(() => {
    return () => {
      if (testAudioRef.current) {
        testAudioRef.current.pause();
        testAudioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!loaded) {
      return undefined;
    }

    if (!hasHydrated.current) {
      hasHydrated.current = true;
      return undefined;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        await persistSettingsSnapshot(settings);
      } catch (error) {
        console.warn("[VisionTranslate] Could not save settings:", error);
      }
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [settings, loaded]);

  useEffect(() => {
    if (!loaded) {
      return undefined;
    }

    const serverBackedEngine = settings.ocrEngine === "paddleocr" || settings.ocrEngine === "mangaocr";

    if (!serverBackedEngine) {
      setServerStatus("idle");
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    async function checkServer() {
      setServerStatus("checking");

      try {
        const timeoutId = window.setTimeout(() => controller.abort(), 3000);
        const response = await fetch(`${settings.backendUrl}/health`, {
          method: "GET",
          signal: controller.signal,
        });
        window.clearTimeout(timeoutId);

        if (!cancelled) {
          if (!response.ok) {
            setServerStatus("offline");
            return;
          }

          const health = await response.json().catch(() => null);
          const selectedServerEngine = settings.ocrEngine;
          const selectedEngineAvailable =
            selectedServerEngine === "paddleocr"
              ? health?.paddle_ocr_available
              : health?.manga_full_available ??
                (health?.paddle_ocr_available && health?.manga_ocr_available);

          setServerStatus(selectedEngineAvailable ? "online" : "unavailable");
        }
      } catch {
        if (!cancelled) {
          setServerStatus("offline");
        }
      }
    }

    checkServer();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [loaded, settings.backendUrl, settings.ocrEngine]);

  const updateSetting = (key, value) => {
    setSettings((previous) => ({
      ...previous,
      [key]: value,
    }));
  };

  const updateTranslationProvider = (provider) => {
    setSettings((previous) => ({
      ...previous,
      translationProvider: provider,
      llmModel: DEFAULT_PROVIDER_MODELS[provider] || previous.llmModel,
    }));
  };

  const selectedEngine =
    ENGINE_OPTIONS.find((option) => option.id === settings.ocrEngine) || ENGINE_OPTIONS[0];
  const selectedProvider =
    PROVIDER_OPTIONS.find((option) => option.id === settings.translationProvider) ||
    PROVIDER_OPTIONS[0];

  const translateRequiresServer =
    settings.ocrEngine === "paddleocr" || settings.ocrEngine === "mangaocr";
  const translateDisabled =
    !activeTabId ||
    isTranslating ||
    isTogglingPage ||
    (translateRequiresServer && serverStatus !== "online");

  const serverStatusCopy = {
    online: "Backend online",
    offline: "Backend offline",
    checking: "Checking backend",
    idle: "Local engine selected",
    unavailable:
      settings.ocrEngine === "mangaocr"
        ? "MangaOCR unavailable"
        : "PaddleOCR unavailable",
  };

  const pageStatusDescription = tabUnavailable
    ? "This tab does not allow extension scripts."
    : tabState.active
      ? "Active on this site. Turning it off will keep it disabled for this domain."
      : settings.autoTranslate
        ? "Disabled for this site. Turning it on will re-enable it for future visits."
        : "Inactive on this page. Automatic activation is off, so you stay in control.";

  async function handleTogglePage() {
    if (!activeTabId) {
      return;
    }

    setIsTogglingPage(true);

    try {
      const response = await sendRuntimeMessage({
        action: "TOGGLE_TRANSLATION",
        payload: { tabId: activeTabId },
      });

      if (response?.state) {
        setTabState(response.state);
      }
    } catch (error) {
      console.error("[VisionTranslate] Could not toggle page translation:", error);
    } finally {
      setIsTogglingPage(false);
    }
  }

  async function handleAuthLogin() {
    setIsAuthLoading(true);
    try {
      const response = await sendRuntimeMessage({ action: "AUTH_LOGIN" });
      if (response?.success) {
        setAuthUser(response.user);
      } else {
        console.error("[VisionTranslate] Login failed:", response?.error);
      }
    } catch (error) {
      console.error("[VisionTranslate] Login error:", error);
    } finally {
      setIsAuthLoading(false);
    }
  }

  async function handleAuthLogout() {
    setIsAuthLoading(true);
    try {
      await sendRuntimeMessage({ action: "AUTH_LOGOUT" });
      setAuthUser(null);
    } catch (error) {
      console.error("[VisionTranslate] Logout error:", error);
    } finally {
      setIsAuthLoading(false);
    }
  }

  async function handleTranslatePage() {
    if (!activeTabId) {
      return;
    }

    setIsTranslating(true);

    try {
      await persistSettingsSnapshot(settings);

      if (!tabState.active) {
        const toggleResponse = await sendRuntimeMessage({
          action: "TOGGLE_TRANSLATION",
          payload: { tabId: activeTabId },
        });

        if (toggleResponse?.state) {
          setTabState(toggleResponse.state);
        }
      }

      await sendTabMessage(activeTabId, {
        action: "TRANSLATE_ALL_IMAGES",
        payload: {},
      });

      window.close();
    } catch (error) {
      console.error("[VisionTranslate] Could not translate page:", error);
    } finally {
      setIsTranslating(false);
    }
  }

  async function handleLoadVoices() {
    setIsLoadingVoices(true);
    setReadAloudStatus("");

    try {
      await persistSettingsSnapshot(settings);

      const response = await sendRuntimeMessage({
        action: "LOAD_ELEVENLABS_VOICES",
      });

      if (!response?.ok) {
        throw new Error(response?.body?.error || "Could not load ElevenLabs voices.");
      }

      const voices = response.body?.voices || [];
      setElevenLabsVoices(voices);

      if (!settings.elevenLabsVoiceId && voices[0]?.voiceId) {
        updateSetting("elevenLabsVoiceId", voices[0].voiceId);
      }

      setReadAloudStatus(
        voices.length
          ? `Loaded ${voices.length} voice${voices.length === 1 ? "" : "s"}.`
          : "No voices returned for this account."
      );
    } catch (error) {
      console.error("[VisionTranslate] Could not load ElevenLabs voices:", error);
      setReadAloudStatus(error.message);
    } finally {
      setIsLoadingVoices(false);
    }
  }

  async function handleTestVoice() {
    setIsTestingVoice(true);
    setReadAloudStatus("");

    try {
      await persistSettingsSnapshot(settings);

      const response = await sendRuntimeMessage({
        action: "TEST_ELEVENLABS_VOICE",
        payload: {
          text: READ_ALOUD_TEST_TEXT,
          language: settings.targetLanguage,
        },
      });

      if (!response?.ok) {
        throw new Error(response?.body?.error || "Could not generate test audio.");
      }

      if (testAudioRef.current) {
        testAudioRef.current.pause();
        testAudioRef.current = null;
      }

      const audio = new Audio(response.body?.audioDataUrl || "");
      audio.onended = () => {
        setReadAloudStatus("Preview finished.");
      };
      audio.onerror = () => {
        setReadAloudStatus("Preview playback failed.");
      };

      testAudioRef.current = audio;
      await audio.play();

      setReadAloudStatus("Playing preview...");
    } catch (error) {
      console.error("[VisionTranslate] Could not test ElevenLabs voice:", error);
      setReadAloudStatus(error.message);
    } finally {
      setIsTestingVoice(false);
    }
  }

  if (!loaded) {
    return (
      <div className="popup-loading">
        <div className="spinner" />
        <p>Loading VisionTranslate...</p>
      </div>
    );
  }

  return (
    <div className="popup-container">
      <header className="popup-header">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            VT
          </div>

          <div className="brand-copy">
            <p className="popup-eyebrow">VisionTranslate</p>
            <h1 className="popup-title">Image translation controls</h1>
            <p className="popup-subtitle">
              Keep everyday actions close, and push engine setup into its own
              space.
            </p>
          </div>
        </div>

        <div className="summary-pills" aria-label="Current engine summary">
          <span className="summary-pill">OCR · {selectedEngine.name}</span>
          <span className="summary-pill">Translate · {selectedProvider.name}</span>
        </div>
      </header>

      <nav className="tab-nav" role="tablist" aria-label="Popup sections">
        {TAB_ITEMS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`tab-button ${activeTab === tab.id ? "is-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="popup-content">
        {activeTab === "home" && (
          <>
            <section className="panel-card">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Quick Start</p>
                  <h2 className="section-title">Current page</h2>
                  <p className="section-description">
                    Start here when you just want the extension ready on the
                    page.
                  </p>
                </div>

                <div className={`status-chip status-chip--${serverStatus}`}>
                  <span className="status-dot" aria-hidden="true" />
                  <span>{serverStatusCopy[serverStatus]}</span>
                </div>
              </div>

              <ToggleRow
                label="Enable translation on this page"
                description={pageStatusDescription}
                checked={Boolean(tabState.active)}
                onToggle={handleTogglePage}
                disabled={tabUnavailable || isTogglingPage}
              />
            </section>

            <section className="panel-card">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Languages</p>
                  <h2 className="section-title">Translation direction</h2>
                  <p className="section-description">
                    Choose what the image text starts as and what it should
                    become.
                  </p>
                </div>
              </div>

              <LanguageSelector
                sourceLanguage={settings.sourceLanguage}
                onSourceChange={(value) => updateSetting("sourceLanguage", value)}
                targetLanguage={settings.targetLanguage}
                onTargetChange={(value) => updateSetting("targetLanguage", value)}
              />
            </section>

            <section className="panel-card">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Overlay Text</p>
                  <h2 className="section-title">English overlay styling</h2>
                  <p className="section-description">
                    Tune the translated text without opening the engine config.
                  </p>
                </div>
              </div>

              <div className="field-grid field-grid--triple">
                <div className="form-group">
                  <label className="form-label" htmlFor="overlay-font-family">
                    Font family
                  </label>
                  <select
                    id="overlay-font-family"
                    className="form-select"
                    value={settings.overlayFontFamily}
                    onChange={(event) =>
                      updateSetting("overlayFontFamily", event.target.value)
                    }
                  >
                    {OVERLAY_FONT_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="overlay-min-font-size">
                    Minimum size
                  </label>
                  <select
                    id="overlay-min-font-size"
                    className="form-select"
                    value={String(settings.overlayMinFontSize)}
                    onChange={(event) =>
                      updateSetting("overlayMinFontSize", Number(event.target.value))
                    }
                  >
                    {MIN_FONT_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size}px
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="overlay-text-align">
                    Alignment
                  </label>
                  <select
                    id="overlay-text-align"
                    className="form-select"
                    value={settings.overlayTextAlign}
                    onChange={(event) =>
                      updateSetting("overlayTextAlign", event.target.value)
                    }
                  >
                    {OVERLAY_ALIGNMENT_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="range-field">
                <div className="range-field-header">
                  <label className="form-label" htmlFor="overlay-opacity">
                    Overlay opacity
                  </label>
                  <span className="range-field-value">
                    {Math.round(Number(settings.overlayOpacity) * 100)}%
                  </span>
                </div>
                <input
                  id="overlay-opacity"
                  className="range-input"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.overlayOpacity}
                  onChange={(event) =>
                    updateSetting("overlayOpacity", Number(event.target.value))
                  }
                />
              </div>

              <div className="card-divider" />

              <ToggleRow
                label="Translate on click only"
                description="Default behavior. Images stay visually unchanged until you click that image’s translate icon."
                checked={true}
                badge="Default"
                disabled={true}
                onToggle={() => {}}
              />

              <div className="card-divider" />

              <ToggleRow
                label="Preprocess in background for faster click translation"
                description="Optional. OCR and translation may be prepared early, but translated text is never displayed until you click the image."
                checked={Boolean(settings.prefetchTranslations)}
                onToggle={() =>
                  updateSetting(
                    "prefetchTranslations",
                    !settings.prefetchTranslations
                  )
                }
              />

            </section>
          </>
        )}

        {activeTab === "engines" && (
          <>
            <section className="panel-card">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">OCR</p>
                  <h2 className="section-title">Text detection engine</h2>
                  <p className="section-description">
                    Pick the OCR path and only show the setup that engine needs.
                  </p>
                </div>
              </div>

              <OcrSettings
                engine={settings.ocrEngine}
                onEngineChange={(value) => updateSetting("ocrEngine", value)}
                backendUrl={settings.backendUrl}
                onBackendUrlChange={(value) => updateSetting("backendUrl", value)}
                googleCloudApiKey={settings.googleCloudApiKey}
                onGoogleCloudApiKeyChange={(value) =>
                  updateSetting("googleCloudApiKey", value)
                }
                customOcrUrl={settings.customOcrUrl}
                onCustomOcrUrlChange={(value) =>
                  updateSetting("customOcrUrl", value)
                }
                customOcrApiKey={settings.customOcrApiKey}
                onCustomOcrApiKeyChange={(value) =>
                  updateSetting("customOcrApiKey", value)
                }
              />
            </section>

            <section className="panel-card">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Translation</p>
                  <h2 className="section-title">Provider and model</h2>
                  <p className="section-description">
                    Move API keys, model choices, and custom endpoints into one
                    scan-friendly section.
                  </p>
                </div>
              </div>

              <TranslateSettings
                provider={settings.translationProvider}
                onProviderChange={updateTranslationProvider}
                openaiApiKey={settings.openaiApiKey}
                onOpenaiApiKeyChange={(value) =>
                  updateSetting("openaiApiKey", value)
                }
                claudeApiKey={settings.claudeApiKey}
                onClaudeApiKeyChange={(value) =>
                  updateSetting("claudeApiKey", value)
                }
                geminiApiKey={settings.geminiApiKey}
                onGeminiApiKeyChange={(value) =>
                  updateSetting("geminiApiKey", value)
                }
                llmModel={settings.llmModel}
                onLlmModelChange={(value) => updateSetting("llmModel", value)}
                customApiKey={settings.customApiKey}
                onCustomApiKeyChange={(value) =>
                  updateSetting("customApiKey", value)
                }
                customBaseUrl={settings.customBaseUrl}
                onCustomBaseUrlChange={(value) =>
                  updateSetting("customBaseUrl", value)
                }
                customModelName={settings.customModelName}
                onCustomModelNameChange={(value) =>
                  updateSetting("customModelName", value)
                }
                allowThirdPartyFallback={settings.allowThirdPartyFallback}
                onAllowThirdPartyFallbackChange={(value) =>
                  updateSetting("allowThirdPartyFallback", value)
                }
              />
            </section>
          </>
        )}

        {activeTab === "settings" && (
          <>
            <section className={`panel-card auth-card ${authUser ? "auth-card--signed-in" : ""}`}>
              {authUser ? (
                <>
                  <div className="auth-signed-in-header">
                    <span className="auth-status-badge">Signed in</span>
                  </div>

                  <div className="auth-profile">
                    {authUser.picture ? (
                      <img
                        className="auth-avatar"
                        src={authUser.picture}
                        alt=""
                        width="44"
                        height="44"
                      />
                    ) : (
                      <div className="auth-avatar auth-avatar--placeholder">
                        {(authUser.name || authUser.email || "?").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="auth-profile-copy">
                      <span className="auth-profile-name">
                        {authUser.name || "User"}
                      </span>
                      {authUser.email ? (
                        <span className="auth-profile-email">{authUser.email}</span>
                      ) : null}
                    </div>
                  </div>

                  <p className="auth-note">
                    Your account is linked. Extension settings remain local in
                    this build.
                  </p>

                  <button
                    type="button"
                    className="auth-button auth-button--secondary"
                    onClick={handleAuthLogout}
                    disabled={isAuthLoading}
                  >
                    {isAuthLoading ? "Signing out..." : "Sign out"}
                  </button>
                </>
              ) : (
                <>
                  <div className="auth-promo">
                    <div className="auth-shield" aria-hidden="true">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                    </div>
                    <div className="auth-promo-copy">
                      <h2 className="auth-promo-title">
                        Protect and save your data!
                      </h2>
                      <p className="auth-promo-description">
                        Sign in for account features. Cross-device settings sync
                        is not enabled in this build.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="auth-button auth-button--primary"
                    onClick={handleAuthLogin}
                    disabled={isAuthLoading}
                  >
                    {isAuthLoading ? (
                      <>
                        <span className="auth-button-spinner" />
                        Signing in...
                      </>
                    ) : (
                      "Sign in"
                    )}
                  </button>
                </>
              )}
            </section>

            <section className="panel-card">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Page Behavior</p>
                  <h2 className="section-title">Discovery and performance</h2>
                  <p className="section-description">
                    Control when page tools appear and how much work runs at once.
                  </p>
                </div>
              </div>

              <ToggleRow
                label="Activate automatically on allowed sites"
                description="Shows per-image translation controls after a page loads. It never translates an image until you click or choose Translate This Page."
                checked={Boolean(settings.autoTranslate)}
                onToggle={() =>
                  updateSetting("autoTranslate", !settings.autoTranslate)
                }
              />

              <div className="card-divider" />

              <div className="field-grid field-grid--triple">
                <div className="form-group">
                  <label className="form-label" htmlFor="min-image-width">
                    Minimum width
                  </label>
                  <input
                    id="min-image-width"
                    className="form-input"
                    type="number"
                    min="32"
                    max="4096"
                    value={settings.minImageWidth}
                    onChange={(event) =>
                      updateSetting("minImageWidth", Number(event.target.value))
                    }
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="min-image-height">
                    Minimum height
                  </label>
                  <input
                    id="min-image-height"
                    className="form-input"
                    type="number"
                    min="32"
                    max="4096"
                    value={settings.minImageHeight}
                    onChange={(event) =>
                      updateSetting("minImageHeight", Number(event.target.value))
                    }
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="max-concurrent-images">
                    Parallel images
                  </label>
                  <input
                    id="max-concurrent-images"
                    className="form-input"
                    type="number"
                    min="1"
                    max="12"
                    value={settings.maxConcurrentImages}
                    onChange={(event) =>
                      updateSetting("maxConcurrentImages", Number(event.target.value))
                    }
                  />
                </div>
              </div>
            </section>

            <section className="panel-card">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Read Aloud</p>
                  <h2 className="section-title">ElevenLabs voice settings</h2>
                  <p className="section-description">
                    Keep speech generation separate from OCR and translation.
                  </p>
                </div>
              </div>

              <ReadAloudSettings
                settings={settings}
                onSettingChange={updateSetting}
                voices={elevenLabsVoices}
                voicesStatus={readAloudStatus}
                isLoadingVoices={isLoadingVoices}
                isTestingVoice={isTestingVoice}
                onLoadVoices={handleLoadVoices}
                onTestVoice={handleTestVoice}
              />
            </section>

            <section className="panel-card">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Appearance</p>
                  <h2 className="section-title">Popup theme</h2>
                  <p className="section-description">
                    Keep the popup readable in bright or dark browser chrome.
                  </p>
                </div>
              </div>

              <div className="segmented-grid" role="group" aria-label="Theme">
                <button
                  type="button"
                  className={`segment-button ${!settings.darkMode ? "is-active" : ""}`}
                  onClick={() => updateSetting("darkMode", false)}
                >
                  Light
                </button>
                <button
                  type="button"
                  className={`segment-button ${settings.darkMode ? "is-active" : ""}`}
                  onClick={() => updateSetting("darkMode", true)}
                >
                  Dark
                </button>
              </div>
            </section>

            <section className="panel-card">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Overlay Feedback</p>
                  <h2 className="section-title">Confidence markers</h2>
                  <p className="section-description">
                    Keep subtle cues visible when OCR confidence is weaker.
                  </p>
                </div>
              </div>

              <ToggleRow
                label="Show low-confidence markers"
                description="Displays a thin warning underline on weaker OCR regions."
                checked={Boolean(settings.showConfidenceBorders)}
                onToggle={() =>
                  updateSetting(
                    "showConfidenceBorders",
                    !settings.showConfidenceBorders
                  )
                }
              />

              <p className="section-note">
                Settings and provider credentials are stored locally in the
                extension.
              </p>
            </section>
          </>
        )}
      </main>

      <footer className="popup-footer">
        <button
          className="translate-button"
          onClick={handleTranslatePage}
          disabled={translateDisabled}
        >
          {isTranslating ? "Translating..." : "Translate This Page"}
        </button>

        <p className="footer-note">
          {!tabState.active
            ? "Page controls will be enabled automatically before translation."
            : "Runs on the current tab with your current engine settings."}
        </p>
      </footer>
    </div>
  );
}
