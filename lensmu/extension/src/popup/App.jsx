import React, { useState } from "react";
import OcrSettings, { ENGINE_OPTIONS } from "./components/OcrSettings.jsx";
import TranslateSettings, { PROVIDER_OPTIONS } from "./components/TranslateSettings.jsx";
import LanguageSelector from "./components/LanguageSelector.jsx";
import ReadAloudSettings from "./components/ReadAloudSettings.jsx";
import { ToggleRow, NumberField } from "./components/SettingFields.jsx";
import { SETTING_RANGES } from "../../shared/preferences.js";
import { useSettingsSession } from "./use-settings-session.js";
import { usePageSession } from "./use-page-session.js";
import { useAccountSession } from "./use-account-session.js";
import { useSpeechPreview } from "./use-speech-preview.js";

const TAB_ITEMS = [{id:"home",label:"Translate"},{id:"engines",label:"Engines"},{id:"settings",label:"Settings"}];
const OVERLAY_FONT_OPTIONS = [{id:"sans",label:"Sans serif"},{id:"serif",label:"Serif"},{id:"manga",label:"Manga"},{id:"mono",label:"Monospace"}];
const OVERLAY_ALIGNMENT_OPTIONS = [{id:"auto",label:"Auto"},{id:"left",label:"Left"},{id:"center",label:"Center"},{id:"right",label:"Right"}];
const MIN_FONT_SIZE_OPTIONS = [8,10,12,14,16];

export default function App() {
  const session = useSettingsSession();
  const { settings, loaded, migrationNotices, updateSetting } = session;
  const [activeTab, setActiveTab] = useState("home");
  const page = usePageSession(settings, loaded, session.ensureSaved);
  const account = useAccountSession();
  const speech = useSpeechPreview(settings, session.ensureSaved, updateSetting);
  const { tabState, serverStatus, translateDisabled, isTranslating, isTogglingPage } = page;
  const tabUnavailable = page.unavailable;
  const authUser = account.user;
  const isAuthLoading = account.busy;
  const handleAuthLogin = account.login;
  const handleAuthLogout = account.logout;
  const handleTogglePage = page.toggle;
  const handleTranslatePage = page.translate;
  const updateTranslationProvider = session.updateProvider;
  const elevenLabsVoices = speech.voices;
  const readAloudStatus = speech.status;
  const isLoadingVoices = speech.loading;
  const isTestingVoice = speech.testing;
  const handleLoadVoices = speech.loadVoices;
  const handleTestVoice = speech.testVoice;
  const saveError = session.saveState.error?.message || "";
  const selectedEngine = ENGINE_OPTIONS.find((option)=>option.id===settings.ocrEngine) || ENGINE_OPTIONS[0];
  const selectedProvider = PROVIDER_OPTIONS.find((option)=>option.id===settings.translationProvider) || PROVIDER_OPTIONS[0];
  const serverStatusCopy = {online:"Backend ready",offline:"Backend offline",checking:"Checking backend",idle:"No backend needed",unavailable:"OCR unavailable"};
  const pageStatusDescription = tabUnavailable ? "Open an ordinary webpage to use translation controls." : tabState.active ? "Controls are active on this page." : "Turn on image controls for this site.";
  function switchTab(event) {
    const current = TAB_ITEMS.findIndex((item)=>item.id===activeTab);
    const index = event.key === "Home" ? 0 : event.key === "End" ? TAB_ITEMS.length-1 : event.key === "ArrowRight" ? (current+1)%TAB_ITEMS.length : event.key === "ArrowLeft" ? (current+TAB_ITEMS.length-1)%TAB_ITEMS.length : -1;
    if (index < 0) return;
    event.preventDefault();
    setActiveTab(TAB_ITEMS[index].id);
    document.getElementById('tab-'+TAB_ITEMS[index].id)?.focus();
  }
  if (!loaded) return <div className="popup-loading"><h1>lensmu</h1>{session.loadError ? <><p role="alert">{session.loadError}</p><button className="secondary-button" onClick={session.retryLoad}>Retry loading settings</button></> : <p role="status">Loading settings…</p>}</div>;

  return (
    <div className="popup-container">
      <header className="popup-header">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            lµ
          </div>

          <div className="brand-copy">
            <p className="popup-eyebrow">lensmu</p>
            <h1 className="popup-title">Read the next panel.</h1>

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
            id={`tab-${tab.id}`}
            aria-controls={`panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onKeyDown={switchTab}
            aria-selected={activeTab === tab.id}
            className={`tab-button ${activeTab === tab.id ? "is-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {page.error || account.error ? <p className="inline-error" role="alert">{page.error || account.error}</p> : null}
      <main className="popup-content" role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} tabIndex={0}>
        {activeTab === "home" && (
          <>
            <section className="panel-card">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Quick Start</p>
                  <h2 className="section-title">Current page</h2>
                  <p className="section-description">
                    Click an image control or translate the page below.
                  </p>
                </div>

                <div className={`status-chip status-chip--${serverStatus}`}>
                  <span className="status-dot" aria-hidden="true" />
                  <span>{serverStatusCopy[serverStatus]}</span>
                  {["offline", "unavailable"].includes(serverStatus) && <button className="text-button" onClick={page.retryHealth}>Retry</button>}
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
                onSwap={() => session.updatePatch({sourceLanguage: settings.targetLanguage, targetLanguage: settings.sourceLanguage})}
              />
            </section>

            <section className="panel-card">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Overlay Text</p>
                  <h2 className="section-title">Translated text appearance</h2>
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
                    Choose how text is read from an image.
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
                    Choose where extracted text is translated.
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
                onLlmModelChange={(value) => {
                  session.clearNotices();
                  updateSetting("llmModel", value);
                }}
                migrationNotices={migrationNotices}
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
                        Your account
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
                <NumberField
                  id="min-image-width"
                  label="Minimum width"
                  min={SETTING_RANGES.minImageWidth.min}
                  max={SETTING_RANGES.minImageWidth.max}
                  value={settings.minImageWidth}
                  onCommit={(value) => updateSetting("minImageWidth", value)}
                />

                <NumberField
                  id="min-image-height"
                  label="Minimum height"
                  min={SETTING_RANGES.minImageHeight.min}
                  max={SETTING_RANGES.minImageHeight.max}
                  value={settings.minImageHeight}
                  onCommit={(value) => updateSetting("minImageHeight", value)}
                />

                <NumberField
                  id="max-concurrent-images"
                  label="Parallel images"
                  min={SETTING_RANGES.maxConcurrentImages.min}
                  max={SETTING_RANGES.maxConcurrentImages.max}
                  value={settings.maxConcurrentImages}
                  onCommit={(value) => updateSetting("maxConcurrentImages", value)}
                />
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
                  aria-pressed={!settings.darkMode}
                  onClick={() => updateSetting("darkMode", false)}
                >
                  Light
                </button>
                <button
                  type="button"
                  className={`segment-button ${settings.darkMode ? "is-active" : ""}`}
                  aria-pressed={settings.darkMode}
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

        {saveError ? (
          <p className="footer-note footer-note--error" role="alert">
            Settings were not saved: {saveError} <button className="text-button" onClick={() => session.ensureSaved().catch(() => undefined)}>Retry save</button>
          </p>
        ) : (
          <p className="footer-note" role="status">{session.saveState.status === "saving" ? "Saving settings…" : "Settings saved on this device."}</p>
        )}
      </footer>
    </div>
  );
}
