import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsStore } from '../utils/storage.js';

function fixture(seed = {}) {
  const data = structuredClone(seed);
  let writes = 0, failRead = false, failWrite = false, revision = 0;
  const storage = {
    async get() { if (failRead) throw new Error('read failed'); return structuredClone(data); },
    async set(patch) { if (failWrite) throw new Error('write failed'); writes++; Object.assign(data, structuredClone(patch)); },
    async remove(keys) { for (const key of keys) delete data[key]; }
  };
  return { store: createSettingsStore(storage, () => `revision-${++revision}`), data,
    get writes() { return writes; }, failRead(value) { failRead = value; }, failWrite(value) { failWrite = value; } };
}

test('failed authoritative read cannot overwrite existing settings', async () => {
  const f = fixture({ vt_settings: { targetLanguage: 'fr', customBaseUrl: 'https://example.test' } });
  f.failRead(true);
  await assert.rejects(f.store.applyPatch({ darkMode: true }), /read failed/);
  assert.equal(f.writes, 0);
  assert.equal(f.data.vt_settings.targetLanguage, 'fr');
  f.failRead(false);
  assert.equal((await f.store.applyPatch({ darkMode: true })).targetLanguage, 'fr');
});

test('concurrent patches preserve every acknowledged field and persisted revision', async () => {
  const f = fixture();
  const [a,b] = await Promise.all([f.store.applyPatch({ sourceLanguage: 'ja' }), f.store.applyPatch({ targetLanguage: 'fr' })]);
  assert.notEqual(a.settingsRevision, b.settingsRevision);
  assert.equal(b.sourceLanguage, 'ja');
  assert.equal(b.targetLanguage, 'fr');
  assert.equal((await f.store.load()).settingsRevision, b.settingsRevision);
  assert.equal((await f.store.applyPatch({})).settingsRevision, b.settingsRevision);
});

test('credential rotation invalidates preparation but visual changes preserve it', async () => {
  const f = fixture();
  const a = await f.store.applyPatch({ openaiApiKey: 'dummy-first' });
  const b = await f.store.applyPatch({ openaiApiKey: 'dummy-second' });
  const c = await f.store.applyPatch({ overlayOpacity: 0.5 });
  assert.notEqual(a.preparationRevision, b.preparationRevision);
  assert.equal(c.preparationRevision, b.preparationRevision);
  assert.notEqual(c.settingsRevision, b.settingsRevision);
  assert.equal(b.preparationRevision.includes('dummy'), false);
});

test('failed writes reject and later patches preserve the last saved snapshot', async () => {
  const f = fixture({ vt_settings: { targetLanguage: 'fr' } });
  f.failWrite(true);
  await assert.rejects(f.store.applyPatch({ targetLanguage: 'es' }), /write failed/);
  f.failWrite(false);
  assert.equal((await f.store.applyPatch({ darkMode: true })).targetLanguage, 'fr');
});

test('legacy fields are removed only after successful migration', async () => {
  const f = fixture({ targetLanguage: 'fr', openaiApiKey: 'dummy' });
  f.failWrite(true);
  await assert.rejects(f.store.load(), /write failed/);
  assert.equal(f.data.openaiApiKey, 'dummy');
  f.failWrite(false);
  const result = await f.store.load();
  assert.equal(result.openaiApiKey, 'dummy');
  assert.equal(result.targetLanguage, 'fr');
  assert.equal(f.data.openaiApiKey, undefined);
});

test('corrupt settings cannot be replaced by a patch', async () => {
  const f = fixture({ vt_settings: [] });
  await assert.rejects(f.store.applyPatch({ darkMode: true }), /invalid/);
  assert.equal(f.writes, 0);
});

test('domain updates serialize and read errors preserve the disable list', async () => {
  const f = fixture();
  await Promise.all([f.store.setDomainDisabled('one.test', true), f.store.setDomainDisabled('two.test', true)]);
  assert.deepEqual(await f.store.disabledDomains(), ['one.test', 'two.test']);
  f.failRead(true);
  await assert.rejects(f.store.setDomainDisabled('one.test', false), /read failed/);
  assert.deepEqual(f.data.vt_disabled_domains, ['one.test', 'two.test']);
});
