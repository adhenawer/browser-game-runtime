// Real-browser checks for the standalone package; no game engine or assets required.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, readdir} from 'node:fs/promises';
import {chromium, webkit} from '@playwright/test';
import {createOfflineWorkerSource} from '../dist/offline.js';

const directory = new URL('../dist/', import.meta.url);
const modules = (await readdir(directory)).filter(name => name.endsWith('.js'));
const worker = createOfflineWorkerSource({
  version:'integration-v1', cachePrefix:'runtime-test-',
  resources:['./index.html', ...modules.map(name=>'./dist/'+name)]
});
const html = '<!doctype html><html lang="en"><title>Runtime integration</title><script type="module">window.runtime = await import("./dist/index.js");</script><body>Runtime integration</body></html>';

for (const [name, browserType] of Object.entries({chromium, webkit})) {
  test(`${name}: committed storage, abort recovery, namespace isolation and offline reopening`, {timeout:60000}, async () => {
    const server = createServer(async (req,res) => {
      const path = new URL(req.url, 'http://localhost').pathname;
      res.setHeader('Cache-Control','no-store');
      if (path === '/game/' || path === '/game/index.html') {
        res.setHeader('Content-Type','text/html'); res.end(html);
      } else if (path === '/game/sw.js') {
        res.setHeader('Content-Type','text/javascript'); res.end(worker);
      } else if (path.startsWith('/game/dist/') && modules.includes(path.slice('/game/dist/'.length))) {
        res.setHeader('Content-Type','text/javascript'); res.end(await readFile(new URL(path.slice('/game/dist/'.length),directory)));
      } else { res.statusCode=404; res.end(); }
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    let browser;
    try {
      browser = await browserType.launch();
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      const url = `http://127.0.0.1:${server.address().port}/game/`;
      await page.goto(url); await page.waitForFunction(()=>!!window.runtime);
      const result = await page.evaluate(async () => {
        const store = window.runtime.createStore({database:'example-game'});
        const other = window.runtime.createStore({database:'another-game'});
        await store.write('save',{level:3});
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(...args) {
          const request = put.apply(this,args);
          request.addEventListener('success',()=>this.transaction.abort());
          return request;
        };
        let aborted = false;
        try { await store.write('save',{level:9}); } catch { aborted = true; }
        finally { IDBObjectStore.prototype.put = put; }
        const saved = await store.read('save');
        const isolated = await other.read('save');
        await store.write('temporary',true); await store.remove('temporary');
        const removed = await store.read('temporary');
        await store.close(); await other.close();
        return {aborted,saved,isolated,removed};
      });
      assert.deepEqual(result,{aborted:true,saved:{level:3},isolated:undefined,removed:undefined});
      await page.evaluate(async () => {
        await navigator.serviceWorker.register('./sw.js');
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
      });
      // Stop the origin for both browsers: no network fallback can satisfy reload.
      // WPE WebKit's offline emulation can fail navigation before consulting its worker.
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      if (name === 'chromium') await context.setOffline(true);
      await page.reload(); await page.waitForFunction(()=>!!window.runtime);
      assert.deepEqual(await page.evaluate(async () => {
        const store = window.runtime.createStore({database:'example-game'});
        const value = await store.read('save'); await store.close(); return value;
      }),{level:3});
      assert.deepEqual(errors,[]);
      await context.close();
    } finally {
      await browser?.close();
      await new Promise(resolve=>server.close(resolve));
    }
  });
}
