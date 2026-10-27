import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createOfflineWorkerSource } from '../dist/offline.js';

const options = {version: 'v2', cachePrefix: 'example-', resources: ['./index.html', './engine.wasm']};
function worker({fail = false} = {}) {
  const listeners = {}, messages = [], requests = [], deleted = [];
  const prefix = 'example-%2Fgame%2F-';
  const stores = new Map([[prefix + 'v1', new Map()], ['unrelated-cache', new Map()]]);
  let claimed = false;
  vm.runInNewContext(createOfflineWorkerSource(options), {
    URL, Request,
    self: {
      registration: {scope: 'https://example.test/game/'},
      addEventListener: (type, fn) => { listeners[type] = fn; },
      clients: { matchAll: async () => [{url: 'https://example.test/game/', postMessage: m => messages.push(m)}], claim: async () => {claimed = true;} }
    },
    caches: {
      async open(key) {
        if (!stores.has(key)) stores.set(key, new Map());
        const data = stores.get(key);
        return {
          async add(req) {
            requests.push(req);
            if (fail && req.url.endsWith('.wasm')) throw new Error('Network failure');
            data.set(req.url, req.url.endsWith('index.html') ? 'cached page' : 'cached engine');
          },
          async match(key) { return data.get(typeof key === 'string' ? key : key.url); }
        };
      },
      async keys() { return [...stores.keys()]; },
      async delete(key) { deleted.push(key); return stores.delete(key); }
    },
    fetch: async () => 'network fallback'
  });
  return {listeners, stores, messages, requests, deleted, claimed: () => claimed, prefix};
}
async function dispatch(listener) {
  let promise;
  listener({waitUntil: p => {promise = p;}});
  await promise;
}
test('failed installation removes partial cache and preserves active version', async () => {
  const w = worker({fail:true});
  await assert.rejects(dispatch(w.listeners.install), /Network failure/);
  assert(w.stores.has(w.prefix+'v1'));
  assert(!w.stores.has(w.prefix+'v2'));
  assert.equal(w.messages[0].type, 'game-offline-error');
  assert(w.requests.every(r => r.cache === 'no-store'));
});
test('complete installation activates only its own scope and serves offline navigation', async () => {
  const w = worker();
  await dispatch(w.listeners.install);
  assert(w.stores.has(w.prefix+'v1')); // No skipWaiting or eager removal.
  await dispatch(w.listeners.activate);
  assert.deepEqual(w.deleted, [w.prefix+'v1']);
  assert(w.stores.has('unrelated-cache')); assert(w.claimed());
  let response;
  w.listeners.fetch({request:{url:'https://example.test/game/level/1',method:'GET',mode:'navigate'}, respondWith:p=>{response=p;}});
  assert.equal(await response, 'cached page');
  response = undefined;
  w.listeners.fetch({request:{url:'https://example.test/other/',method:'GET'}, respondWith:p=>{response=p;}});
  assert.equal(response, undefined);
});
test('invalid manifests cannot escape the worker scope', () => {
  for (const path of ['../outside', '/root', 'https://another.test/a', './file?x=1', './file#x']) {
    assert.throws(() => createOfflineWorkerSource({...options,resources:['./index.html',path]}));
  }
  assert.throws(() => createOfflineWorkerSource({...options,resources:['./engine.wasm']}), /entrypoint/);
});
