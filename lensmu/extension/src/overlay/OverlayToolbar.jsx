/**
 * OverlayToolbar.jsx — Floating toolbar injected into web pages.
 *
 * HOW CONTENT SCRIPT UI INJECTION WORKS:
 *
 * When the user triggers translation, the content script needs to show UI
 * elements on the web page (this toolbar, translation overlays, tooltips).
 * There are two approaches:
 *
 *   1. DIRECT DOM INJECTION — Append elements directly to the page's DOM.
 *      Simple but risky: the page's CSS can clash with our styles, and our
 *      elements can break the page's layout.
 *
 *   2. SHADOW DOM (recommended) — Create a Shadow DOM root that encapsulates
 *      our UI. Styles inside the shadow root don't leak out, and the page's
 *      styles don't leak in. This is what we use.
 *
 * The content script creates a <div> on the page, attaches a Shadow DOM to it,
 * and mounts this React component inside the shadow root. This keeps our
 * toolbar visually isolated from the host page.
 *
 * DRAGGING:
 * The toolbar is draggable so the user can move it out of the way. We implement
 * this with mouse event handlers (mousedown/mousemove/mouseup) rather than the
 * HTML drag API because the drag API is designed for drag-and-drop transfers,
 * not for repositioning elements.
 *
 * Z-INDEX:
 * We use a very high z-index (2147483647 — the max 32-bit integer) to ensure
 * the toolbar floats above all page content, including modals and sticky headers.
 *
 * PROPS:
 *   status           — Current translation status string
 *   regionsFound     — Number of text regions detected by OCR
 *   isTranslating    — Whether translation is currently in progress
 *   translationsVisible — Whether translated overlays are currently shown
 *   onToggleTranslations — Callback to show/hide translation overlays
 *   onClose          — Callback when the user closes the toolbar entirely
 */

import React, { useState, useCallback, useRef, useEffect } from "react";

export default function OverlayToolbar({
  status = "Ready",
  regionsFound = 0,
  isTranslating = false,
  translationsVisible = true,
  onToggleTranslations = () => {},
  onClose = () => {},
}) {
  // Whether the toolbar is collapsed to just a small icon
  const [minimized, setMinimized] = useState(false);

  // ─── Dragging state ──────────────────────────────────────────────────
  // Position of the toolbar (bottom-right by default)
  const [position, setPosition] = useState({ x: null, y: null });

  // Whether the user is currently dragging
  const [isDragging, setIsDragging] = useState(false);

  // Offset between the mouse cursor and the toolbar's top-left corner
  // at the moment dragging started. This prevents the toolbar from
  // "jumping" so its corner is under the cursor.
  const dragOffset = useRef({ x: 0, y: 0 });

  // Reference to the toolbar DOM element (for measuring its dimensions)
  const toolbarRef = useRef(null);

  /**
   * handleMouseDown — Called when the user presses the mouse on the drag handle.
   * Records the initial offset and starts listening for mouse movement.
   */
  const handleMouseDown = useCallback(
    (e) => {
      // Only respond to left mouse button
      if (e.button !== 0) return;

      // Prevent text selection while dragging
      e.preventDefault();

      const toolbar = toolbarRef.current;
      if (!toolbar) return;

      const rect = toolbar.getBoundingClientRect();
      dragOffset.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      setIsDragging(true);
    },
    []
  );

  /**
   * Mouse move and mouse up handlers are attached to the DOCUMENT (not the
   * toolbar) so that dragging continues even if the cursor moves outside
   * the toolbar element. We add/remove these listeners based on isDragging.
   */
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      // Calculate new position, clamped to the viewport bounds
      const newX = Math.max(
        0,
        Math.min(
          window.innerWidth - (toolbarRef.current?.offsetWidth || 200),
          e.clientX - dragOffset.current.x
        )
      );
      const newY = Math.max(
        0,
        Math.min(
          window.innerHeight - (toolbarRef.current?.offsetHeight || 48),
          e.clientY - dragOffset.current.y
        )
      );
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // ─── Compute inline styles for positioning ───────────────────────────
  /**
   * If position.x is null, the toolbar hasn't been dragged yet and we use
   * CSS to position it in the bottom-right corner. Once dragged, we switch
   * to absolute positioning at the dragged coordinates.
   */
  const toolbarStyle = {
    position: "fixed",
    zIndex: 2147483647,
    ...(position.x !== null
      ? {
          left: `${position.x}px`,
          top: `${position.y}px`,
          right: "auto",
          bottom: "auto",
        }
      : {
          right: "20px",
          bottom: "20px",
          left: "auto",
          top: "auto",
        }),
    // Disable transitions while dragging for responsive movement
    transition: isDragging ? "none" : "all 0.2s ease",
  };

  // ─── Minimized view: just a small clickable icon ─────────────────────
  if (minimized) {
    return (
      <div
        ref={toolbarRef}
        className="overlay-toolbar overlay-toolbar--minimized"
        style={toolbarStyle}
        title="VisionTranslate — click to expand"
      >
        <button
          className="toolbar-expand-button"
          onClick={() => setMinimized(false)}
          aria-label="Expand VisionTranslate toolbar"
        >
          {/* Simple "VT" monogram as the minimized icon */}
          <span className="toolbar-icon-text">VT</span>
        </button>
      </div>
    );
  }

  // ─── Full toolbar view ───────────────────────────────────────────────
  return (
    <div
      ref={toolbarRef}
      className="overlay-toolbar"
      style={toolbarStyle}
      role="toolbar"
      aria-label="VisionTranslate toolbar"
    >
      {/*
        Drag handle — this is the only part that initiates dragging.
        The rest of the toolbar contains interactive buttons that shouldn't
        trigger a drag when clicked.
      */}
      <div
        className="toolbar-drag-handle"
        onMouseDown={handleMouseDown}
        title="Drag to reposition"
        aria-hidden="true"
      >
        {/* Six-dot drag indicator (using middle-dot characters) */}
        <span className="drag-dots">
          {"::"}
        </span>
      </div>

      {/* Status text area */}
      <div className="toolbar-status">
        {isTranslating && <span className="toolbar-spinner" />}
        <span className="toolbar-status-text">
          {isTranslating
            ? status
            : regionsFound > 0
              ? `${regionsFound} region${regionsFound !== 1 ? "s" : ""} found`
              : status}
        </span>
      </div>

      {/* Action buttons */}
      <div className="toolbar-actions">
        {/*
          Toggle button: shows or hides the translation overlays on the page.
          The user might want to see the original text underneath.
        */}
        <button
          className={`toolbar-button ${translationsVisible ? "toolbar-button--active" : ""}`}
          onClick={onToggleTranslations}
          aria-label={
            translationsVisible ? "Hide translations" : "Show translations"
          }
          title={translationsVisible ? "Hide translations" : "Show translations"}
          disabled={isTranslating}
        >
          {translationsVisible ? "Hide" : "Show"}
        </button>

        {/* Minimize button: collapses the toolbar to a small icon */}
        <button
          className="toolbar-button toolbar-button--minimize"
          onClick={() => setMinimized(true)}
          aria-label="Minimize toolbar"
          title="Minimize"
        >
          {/* Em dash as a minimize icon */}
          &#8212;
        </button>

        {/* Close button: removes the toolbar and all overlays */}
        <button
          className="toolbar-button toolbar-button--close"
          onClick={onClose}
          aria-label="Close VisionTranslate"
          title="Close"
        >
          {/* Multiplication sign as a close icon */}
          &#215;
        </button>
      </div>
    </div>
  );
}
