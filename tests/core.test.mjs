// SPDX-License-Identifier: GPL-2.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readVerifiedPart, loadAssetBundle, ActionState, GameLifecycle, bindBrowserLifecycle } from '../dist/index.js';
const data = new TextEncoder().encode('browser game');
const digest = async bytes => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');

test('streaming reader authenticates only its target view and reports byte progress', async () => {
  const output = new Uint8Array(data.length + 4).fill(99);
  const progress = [];
  await readVerifiedPart(new Response(new ReadableStream({ start(c) { c.enqueue(data.slice(0, 3)); c.enqueue(data.slice(3)); c.close(); } })), output.subarray(2, -2), await digest(data), { onProgress: n => progress.push(n) });
  assert.deepEqual(output.subarray(2, -2), data);
  assert.equal(output[0], 99); assert.equal(output.at(-1), 99);
  assert.deepEqual(progress, [3, data.length]);
});
test('reader rejects HTTP failures, truncation, overflow and digest mismatch', async () => {
  const hash = await digest(data);
  for (const [response, size, code] of [[new Response('', {status: 503}), data.length, 'http'], [new Response(data), data.length + 1, 'size'], [new Response(data), 2, 'size'], [new Response(data), data.length, 'hash']]) {
    await assert.rejects(readVerifiedPart(response, new Uint8Array(size), code === 'hash' ? '0'.repeat(64) : hash), error => error.code === code);
  }
});
test('abort cancels a pending stream read and releases its lock', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const controller = new AbortController();
  const pending = readVerifiedPart(new Response(stream), new Uint8Array(2), '0'.repeat(64), { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(cancelled, true); assert.equal(stream.locked, false);
});
test('bundle validates layout before fetch and authenticates every part', async () => {
  const first = data.slice(0, 4), second = data.slice(4);
  const manifest = {bytes: data.length, parts: [{url:'a', offset:0, bytes:first.length, sha256: await digest(first)}, {url:'b', offset:4, bytes:second.length, sha256:await digest(second)}]};
  let requests = 0;
  const fetch = async url => { requests++; return new Response(url === 'a' ? first : second); };
  const events = [];
  assert.deepEqual(await loadAssetBundle(manifest, {fetch, onProgress: e => events.push(e)}), data);
  assert.equal(requests, 2); assert.equal(events.at(-1).phase, 'verified'); assert.equal(events.at(-1).received, data.length);
  requests = 0;
  await assert.rejects(loadAssetBundle({...manifest, parts: [{...manifest.parts[0], offset: 1}]}, {fetch}), error => error.code === 'manifest');
  await assert.rejects(loadAssetBundle(manifest, {fetch, maxBytes:2}), error => error.code === 'manifest');
  assert.equal(requests, 0);
});
test('action aliases and virtual sources remain held until every source releases', () => {
  const bindings = {jump:['Space', 'KeyJ']};
  const input = new ActionState(bindings);
  bindings.jump.length = 0;
  input.press('Space'); input.press('KeyJ'); input.setActions('touch:1', ['jump']); input.setActions('touch:2', ['jump']);
  input.release('Space'); input.release('KeyJ'); input.setActions('touch:1', []);
  assert.equal(input.active('jump'), true);
  input.setActions('touch:2', []); assert.equal(input.active('jump'), false);
  input.press('Space'); input.setActions('pad:1', ['jump']); input.clear();
  assert.equal(input.active('jump'), false);
  assert.equal(input.active('toString'), false);
  assert.equal(input.active('constructor'), false);
});
test('lifecycle gates readiness and reconciles pause during asynchronous resume', async () => {
  const calls = [];
  let finish;
  const lifecycle = new GameLifecycle({resume: () => {calls.push('resume'); return new Promise(resolve => { finish = resolve; });}, pause: () => {calls.push('pause');}, releaseInputs: () => calls.push('release')});
  await assert.rejects(lifecycle.resume(), /not ready/);
  lifecycle.markReady(); const pending = lifecycle.resume(); await Promise.resolve();
  const paused = lifecycle.pause(); assert.equal(lifecycle.state, 'pausing');
  finish(); await pending; await paused;
  assert.deepEqual(calls, ['resume', 'release', 'pause']); assert.equal(lifecycle.state, 'paused');
});
test('lifecycle recovers after adapter errors and browser focus never resumes', async () => {
  let resumes = 0;
  const lifecycle = new GameLifecycle({resume: () => {resumes++; throw new Error('blocked');}, pause() {}, releaseInputs() {}});
  lifecycle.markReady(); await assert.rejects(lifecycle.resume(), /blocked/); assert.equal(lifecycle.state, 'error');
  await lifecycle.pause(); assert.equal(lifecycle.state, 'paused');
  const win = new EventTarget(), doc = new EventTarget(); doc.hidden = false;
  const errors = [];
  const dispose = bindBrowserLifecycle(lifecycle, {window:win, document:doc, onError:e => errors.push(e)});
  win.dispatchEvent(new Event('focus')); assert.equal(resumes, 1);
  win.dispatchEvent(new Event('blur')); await Promise.resolve(); await Promise.resolve();
  assert.equal(errors.length, 0); dispose();
});
