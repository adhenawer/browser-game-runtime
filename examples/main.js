// SPDX-License-Identifier: GPL-2.0-or-later
import { ActionState, GameLifecycle, bindBrowserLifecycle, createStore } from '../dist/index.js';
const canvas = document.querySelector('canvas');
const context = canvas.getContext('2d');
const status = document.querySelector('#status');
const button = document.querySelector('#resume');
const input = new ActionState({ left:['ArrowLeft','KeyA'], right:['ArrowRight','KeyD'], up:['ArrowUp','KeyW'], down:['ArrowDown','KeyS'] });
const saves = createStore({ database:'browser-game-runtime-example-v1' });
let running = false, x = 320, y = 180, previous = performance.now();
const report = error => { status.textContent = error instanceof Error ? error.message : String(error); };
const lifecycle = new GameLifecycle({
  pause() { running = false; status.textContent = 'Paused. Choose Start / resume to continue.'; },
  resume() { running = true; previous = performance.now(); canvas.focus(); status.textContent = 'Running. Use arrow keys or WASD.'; },
  releaseInputs() { input.clear(); }
});
bindBrowserLifecycle(lifecycle, { onError:report });
canvas.addEventListener('keydown', event => { if (input.action(event.code)) { event.preventDefault(); if (running) input.press(event.code); } });
window.addEventListener('keyup', event => input.release(event.code));
button.addEventListener('click', () => { void lifecycle.resume().catch(report); });
document.querySelector('#pause').addEventListener('click', () => { void lifecycle.pause().catch(report); });
document.querySelector('#save').addEventListener('click', async () => {
  try { await lifecycle.pause(); await saves.write('position', {x,y}); status.textContent = 'Position saved locally.'; } catch(error) { report(error); }
});
document.querySelector('#load').addEventListener('click', async () => {
  try {
    await lifecycle.pause(); const value = await saves.read('position');
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) { status.textContent = 'No saved position found.'; return; }
    x = Math.min(628, Math.max(12, value.x)); y = Math.min(348, Math.max(12, value.y)); status.textContent = 'Position loaded. Choose Start / resume.';
  } catch(error) { report(error); }
});
function frame(now) {
  const dt = Math.min((now - previous) / 1000, .05); previous = now;
  if (running) {
    x = Math.max(12, Math.min(628, x + (Number(input.active('right')) - Number(input.active('left'))) * dt * 180));
    y = Math.max(12, Math.min(348, y + (Number(input.active('down')) - Number(input.active('up'))) * dt * 180));
  }
  context.clearRect(0,0,640,360); context.fillStyle='#70dbff'; context.beginPath(); context.arc(x,y,12,0,Math.PI*2); context.fill();
  if (lifecycle.state === 'loading') { lifecycle.markReady(); button.disabled = false; status.textContent = 'Ready. Choose Start / resume.'; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
