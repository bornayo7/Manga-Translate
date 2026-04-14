/**
 * =============================================================================
 * VisionTranslate — Error Boundary Component
 * =============================================================================
 *
 * A React error boundary that catches crashes in the popup UI and displays
 * a friendly fallback message instead of a blank panel.
 *
 * Without this, if App.jsx throws an error (bad API response, storage
 * corruption, null reference), the popup goes blank with no feedback.
 *
 * SETUP:
 *   1. Drop this file into lensmu/extension/src/popup/components/
 *   2. In src/popup/index.jsx, wrap <App /> with <ErrorBoundary>:
 *
 *      import ErrorBoundary from './components/ErrorBoundary.jsx';
 *
 *      root.render(
 *        <ErrorBoundary>
 *          <App />
 *        </ErrorBoundary>
 *      );
 * =============================================================================
 */

import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[VisionTranslate] Popup crashed:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleClearSettings = async () => {
    try {
      await chrome.storage.local.clear();
      this.setState({ hasError: false, error: null });
      window.location.reload();
    } catch (e) {
      console.error('[VisionTranslate] Could not clear settings:', e);
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '20px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          color: '#333',
          minWidth: '320px',
        }}>
          <h2 style={{ color: '#d32f2f', fontSize: '16px', margin: '0 0 12px' }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: '13px', lineHeight: '1.5', margin: '0 0 16px' }}>
            The VisionTranslate popup encountered an error. This is usually
            caused by corrupted settings or a temporary glitch.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={this.handleReset}
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                border: '1px solid #ccc',
                borderRadius: '4px',
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              Try Again
            </button>
            <button
              onClick={this.handleClearSettings}
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                border: '1px solid #d32f2f',
                borderRadius: '4px',
                background: '#fff',
                color: '#d32f2f',
                cursor: 'pointer',
              }}
            >
              Reset Settings
            </button>
          </div>
          <details style={{ marginTop: '16px', fontSize: '11px', color: '#999' }}>
            <summary style={{ cursor: 'pointer' }}>Error details</summary>
            <pre style={{
              marginTop: '8px',
              padding: '8px',
              background: '#f5f5f5',
              borderRadius: '4px',
              overflow: 'auto',
              maxHeight: '100px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {this.state.error?.toString()}
            </pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}
