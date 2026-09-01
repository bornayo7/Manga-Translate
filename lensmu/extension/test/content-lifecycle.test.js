import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('content cleanup restores the exact original inline style', async () => {
  const source = await readFile(new URL('../content.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    chrome: {
      runtime: {
        id: 'test-extension',
        onMessage: { addListener() {} }
      }
    },
    console: { log() {}, warn() {}, error() {} },
    WeakMap,
    Map,
    Set,
    AbortController,
    crypto: globalThis.crypto
  });
  vm.runInContext(source, context);

  let styleAttribute = 'display:inline; width:42px';
  const element = {
    isConnected: true,
    getAttribute(name) {
      return name === 'style' ? styleAttribute : null;
    },
    setAttribute(name, value) {
      if (name === 'style') styleAttribute = value;
    },
    removeAttribute(name) {
      if (name === 'style') styleAttribute = null;
    }
  };

  context.rememberOriginalInlineStyle(element);
  styleAttribute = 'display:block; width:100%; height:100%';
  context.restoreOriginalInlineStyles();

  assert.equal(styleAttribute, 'display:inline; width:42px');
});
