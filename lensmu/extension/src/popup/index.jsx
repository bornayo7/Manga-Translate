/**
 * index.jsx — React entry point for the VisionTranslate popup.
 *
 * HOW THIS FILE FITS IN:
 * This is the first JavaScript file that runs when the popup opens. Its only
 * job is to mount the root <App /> component into the #root div in popup.html.
 *
 * WHY React.StrictMode?
 * StrictMode enables additional development warnings and double-invokes certain
 * lifecycle methods to help catch bugs. It has no effect in production builds.
 *
 * BUNDLER NOTE:
 * If you are using Vite, webpack, or another bundler, this file will be the
 * "entry" in your config. The bundler will resolve all imports (React, App, etc.)
 * and produce a single output bundle that popup.html loads.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import "../styles/globals.css";

// Grab the mount point from popup.html
const container = document.getElementById("root");

// createRoot is the React 18+ way to initialize a React tree.
// The older ReactDOM.render() still works but is considered legacy.
const root = createRoot(container);

// Render the app inside StrictMode with an ErrorBoundary to catch crashes.
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
