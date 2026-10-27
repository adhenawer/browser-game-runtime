# Browser Game Runtime

An engine-neutral TypeScript library for bringing native, WebAssembly, and JavaScript games to the browser. It provides verified asset loading, input aggregation, lifecycle coordination, local persistence, and an offline worker generator. It has no runtime dependencies and includes ESM JavaScript and TypeScript declarations.

Extracted from DOOM Classic Browser, with game rules, renderer code, asset names, DOM layout, and storage namespaces left in the host application. **This is an integration library, not a renderer or a game engine.** No game assets are included.

## Get started

The package is not published to npm; the registry name has not been reserved.
Download a `.tgz` from GitHub Releases when available, or build it from source:

```sh
git clone https://github.com/adhenawer/browser-game-runtime.git
cd browser-game-runtime
npm ci
npm test
npm pack
# In another project:
npm install /path/to/browser-game-runtime-0.1.0.tgz
```

The repository is self-contained: no DOOM checkout, game assets, native engine
compiler, or external service is needed to build the library or run its Node tests.
See [CONTRIBUTING.md](CONTRIBUTING.md) for development and release instructions.

Use Node 22 or later for building and testing. Browser code needs ES2022, typed arrays and the APIs used by each module. SHA-256 uses Web Crypto in a secure context. IndexedDB, Cache Storage, and Service Worker support are needed only when using their corresponding modules. Serve through HTTPS or localhost.

## Verified asset loading

```ts
import { loadAssetBundle } from 'browser-game-runtime';

// Produce this manifest during your build from the exact distributed bytes.
const manifest = await fetch('./assets.json').then(response => response.json());
const controller = new AbortController();
const bytes = await loadAssetBundle(manifest, {
  signal: controller.signal,
  maxBytes: 1024 * 1024 * 1024,
  onProgress: ({ phase, received, total }) => {
    console.log(phase, `${received} / ${total} bytes`);
  }
});
// Adapter example: module.FS.writeFile('/game/assets.pack', bytes, { canOwn: true });
```

The manifest has `{ bytes, parts: [{ url, offset, bytes, sha256 }] }`. Parts must cover the output contiguously, starting at zero. Each hash is 64 hexadecimal characters. The default allocation limit is 512 MiB; select a suitable limit explicitly for your application. Progress uses a zero-based `part` index. `verified` means the part's digest passed, not that the game has started.

`loadAssetBundle` validates the layout before allocation or fetch, loads parts sequentially into a single output allocation, and returns only after every digest matches. Supply `fetch(url, init)` to integrate Cache Storage or a custom transport; honor its AbortSignal. Fetch uses `cache: 'no-store'` by default. The complete output still resides in memory: this is not progressive asset decoding or bounded-memory loading. Web Crypto and browser internals may allocate additional memory.

For an existing buffer, use `readVerifiedPart(response, target, sha256, { signal, onProgress, onVerifying })`. `target` must use an ordinary ArrayBuffer. Discard its contents on failure: unverified bytes are written before the digest can be checked. Errors carry stable `AssetError.code` values: `http`, `size`, `hash`, or `manifest`; aborts retain AbortSignal semantics. Messages are English; applications can localize by code. SHA-256 checks consistency with a trusted manifest; it does not authenticate an untrusted manifest.

## Input from multiple sources

```ts
import { ActionState } from 'browser-game-runtime';
const input = new ActionState({ jump: ['Space', 'KeyJ'], moveLeft: ['KeyA', 'ArrowLeft'] });
input.press('Space');
input.setActions('touch:1', ['jump']);
input.release('Space');
console.log(input.active('jump')); // true: the touch source still holds it
input.setActions('touch:1', []);
input.clear(); // On blur, cancellation, menu changes, or suspension.
```

The application owns DOM listeners, key conflict/remapping policy, text entry, and mapping actions to native engine commands. Distinct touch pointers or gamepads need distinct source IDs. The library does not assume FPS controls, weapon slots, a particular keyboard layout, Pointer Lock, or touch-only input.

## Lifecycle and native adapters

```ts
import { GameLifecycle, bindBrowserLifecycle } from 'browser-game-runtime';
const lifecycle = new GameLifecycle({
  pause: () => engine.pauseAtCompletedTick(),
  resume: () => engine.resume(),
  releaseInputs: () => engine.clearInputs()
});
// The engine starts paused. Call this only after actual scene presentation and
// completion of the native tick, not just a splash screen or WASM initialization.
lifecycle.markReady();
const unbind = bindBrowserLifecycle(lifecycle, { onError: console.error });
resumeButton.addEventListener('click', () => {
  // If required, request audio unlock synchronously here, within the user gesture.
  void lifecycle.resume().catch(console.error);
});
```

The adapter must begin paused and implement safe pause/resume semantics for its own engine. Transitions are serialized; a pause arriving during asynchronous resume releases input immediately and queues the final pause. Superseded queued resumes are skipped. Browser blur, pagehide, and hidden documents request pause; focus never resumes gameplay automatically. `bindBrowserLifecycle` returns listener cleanup; it does not shut down the engine. Recreate the controller for a new engine instance.

Native clock accounting, audio context policies, safe tick detection, and world-frame completion remain adapter responsibilities. `markReady()` records evidence supplied by your adapter; it cannot detect native readiness itself. Audio activation that requires a user gesture must happen synchronously in that gesture handler, before asynchronous lifecycle work. The DOOM integration currently consumes the asset, input, storage and offline components; this generic lifecycle controller is tested separately and does not replace DOOM's native lifecycle bridge.

## Local persistence

```ts
import { createStore } from 'browser-game-runtime';
const saves = createStore({ database: 'my-game-saves-v1', store: 'slots' });
await saves.write('slot-1', { engine: 'my-engine-v1', data: saveBytes });
const save = await saves.read('slot-1');
await saves.close();
```

Writes resolve only when the IndexedDB transaction commits. Database names, object-store names, engine/content save identifiers, schemas, migrations, and backup formats belong to the application. Keep existing namespaces when integrating with an established game. Increasing a database version may require closing other tabs. Local browser storage may be evicted; provide user-controlled backups when durability matters. The store does not serialize an engine's in-memory state or synchronize Emscripten IDBFS.

## Offline builds

```js
// Build-time script, executed with Node after creating application assets.
import { writeFile } from 'node:fs/promises';
import { createOfflineWorkerSource } from 'browser-game-runtime';
await writeFile('dist/sw.js', createOfflineWorkerSource({
  version: 'build-content-hash',
  cachePrefix: 'my-game-',
  resources: ['./index.html', './game.js', './game.wasm', './assets.pack'],
  entrypoint: './index.html'
}));
// Application: await navigator.serviceWorker.register('./sw.js');
```

Generate a new version whenever resource bytes change, preferably from a hash of all build resources. Every required offline resource must be included explicitly; only relative paths within the registration scope are accepted. Installation succeeds only after the entire list is cached, and failed installs remove their incomplete cache. The worker does not call `skipWaiting`; existing clients keep their active version until normal worker activation. Cache names include the registration scope. Avoid sharing the same prefix between unrelated applications in one scope.

The worker caches responses, but does not verify asset SHA-256 itself. Use a trusted build and the verified loader where appropriate. Registration alone does not prove offline readiness: observe activation/control and verify a real offline reopen. Storage quotas and eviction still apply. Assets outside the inventory fall back to network and are not guaranteed offline.

## Standalone example and checks

```sh
npm test
npx playwright install --with-deps chromium webkit
npm run test:browser
npm run build
python3 -m http.server 8080
# Open http://localhost:8080/examples/
```

The English Canvas example demonstrates a non-DOOM host with keyboard movement, explicit start/pause, blur suspension, and local save/load. It loads the built package directly, without a bundler or CDN. It is an integration example, not a performance benchmark or a complete game port. The example does not install a service worker; adapt the offline build recipe above for your application.

Node tests cover corrupted/truncated assets, cancellation, manifest validation, input aliases and multiple sources, lifecycle races, and offline-worker installation failures. The separate `test:browser` suite checks real IndexedDB commit/abort behavior, namespace isolation, and offline reload in Chromium and WebKit. Browser binaries and system libraries must be installed first. A JavaScript demo does not certify arbitrary native engines or mobile hardware. Renderer capabilities, frame rate, memory, and audio latency must be measured in each target game and device.

## License and provenance

GPL-2.0-or-later; see [LICENSE](LICENSE) and [NOTICE](NOTICE). Extraction preserves the original license; it does not make the inherited code permissively licensed. Applications distributing combined code must satisfy the applicable GPL terms. No renderer or third-party engine implementation is copied into this package. Its license does not grant rights to game assets. The npm archive includes sources, declarations, build configuration, examples and tests.
