/**
 * content-overlay/index.jsx — Entry point for the content-overlay bundle.
 *
 * This file is built by Vite into a single IIFE (Immediately Invoked Function
 * Expression) file at dist/content-overlay.js. The content script (content.js)
 * loads this bundle into the page when the user activates translation.
 *
 * It exports the overlay React components so content.js can mount them
 * into a Shadow DOM container on the page.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import OverlayToolbar from "../overlay/OverlayToolbar.jsx";
import TranslationTooltip from "../overlay/TranslationTooltip.jsx";

/**
 * Mount the overlay toolbar into a given DOM container.
 *
 * Called by content.js after it creates a Shadow DOM host element.
 * The props are callbacks that content.js provides so the toolbar
 * can communicate back (toggle translations, close, etc.).
 *
 * @param {HTMLElement} container — The DOM element to mount into
 * @param {Object}      props    — Props for the OverlayToolbar component
 * @returns {Object}             — { root, update, unmount } for lifecycle control
 */
function mountToolbar(container, props = {}) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <OverlayToolbar {...props} />
    </React.StrictMode>
  );

  return {
    root,
    /** Re-render with new props (e.g., updated status text) */
    update(newProps) {
      root.render(
        <React.StrictMode>
          <OverlayToolbar {...newProps} />
        </React.StrictMode>
      );
    },
    /** Clean up when deactivating */
    unmount() {
      root.unmount();
    },
  };
}

/**
 * Mount a translation tooltip into a given DOM container.
 *
 * @param {HTMLElement} container — The DOM element to mount into
 * @param {Object}      props    — Props for the TranslationTooltip component
 * @returns {Object}             — { root, update, unmount }
 */
function mountTooltip(container, props = {}) {
  const root = createRoot(container);
  root.render(<TranslationTooltip {...props} />);

  return {
    root,
    update(newProps) {
      root.render(<TranslationTooltip {...newProps} />);
    },
    unmount() {
      root.unmount();
    },
  };
}

/*
 * Attach to the global window object so content.js can access these
 * functions after loading the bundle via a <script> tag.
 *
 * Usage from content.js:
 *   const toolbar = window.VisionTranslateOverlay.mountToolbar(container, props);
 *   toolbar.update({ status: "Translating..." });
 *   toolbar.unmount();
 */
window.VisionTranslateOverlay = {
  mountToolbar,
  mountTooltip,
  OverlayToolbar,
  TranslationTooltip,
};
