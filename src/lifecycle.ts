// SPDX-License-Identifier: GPL-2.0-or-later
export interface EngineLifecycleAdapter {
  /** Complete only when the engine has stopped at a safe simulation boundary. */
  pause(): void | Promise<void>;
  resume(): void | Promise<void>;
  releaseInputs(): void;
}
export type LifecycleState = 'loading' | 'paused' | 'resuming' | 'running' | 'pausing' | 'error';
/** Serializes engine transitions. Browser focus never implies permission to resume. */
export class GameLifecycle {
  private ready = false;
  private revision = 0;
  private queue: Promise<void> = Promise.resolve();
  private current: LifecycleState = 'loading';
  constructor(private adapter: EngineLifecycleAdapter) {}
  get state(): LifecycleState { return this.current; }
  /**
   * The engine must already be paused. Call after your adapter observes a complete
   * world frame and a safe tick boundary; this method records readiness only.
   */
  markReady(): void {
    if (!this.ready) { this.ready = true; this.current = 'paused'; }
  }
  resume(): Promise<void> {
    if (!this.ready) return Promise.reject(new Error('The engine is not ready.'));
    const revision = ++this.revision;
    this.current = 'resuming';
    return this.enqueue(async () => {
      if (revision !== this.revision) return;
      await this.adapter.resume();
      if (revision === this.revision) this.current = 'running';
    }, revision);
  }
  pause(): Promise<void> {
    const revision = ++this.revision;
    try { this.adapter.releaseInputs(); }
    catch (error) { this.current = 'error'; return Promise.reject(error); }
    if (!this.ready) return Promise.resolve();
    this.current = 'pausing';
    return this.enqueue(async () => {
      await this.adapter.pause();
      if (revision === this.revision) this.current = 'paused';
    }, revision);
  }
  private enqueue(operation: () => Promise<void>, revision: number): Promise<void> {
    const pending = this.queue.then(operation).catch(error => {
      if (revision === this.revision) this.current = 'error';
      throw error;
    });
    // A failed transition is observable by its caller but does not poison future pauses.
    this.queue = pending.catch(() => {});
    return pending;
  }
}
export interface BrowserLifecycleOptions {
  window?: Window;
  document?: Document;
  onError: (error: unknown) => void;
}
/** Auto-pauses on blur, pagehide and hidden documents. Returns listener cleanup. */
export function bindBrowserLifecycle(lifecycle: GameLifecycle, options: BrowserLifecycleOptions): () => void {
  const win = options.window ?? window;
  const doc = options.document ?? document;
  const pause = () => { void lifecycle.pause().catch(options.onError); };
  const visibility = () => { if (doc.hidden) pause(); };
  win.addEventListener('blur', pause);
  win.addEventListener('pagehide', pause);
  doc.addEventListener('visibilitychange', visibility);
  visibility();
  return () => {
    win.removeEventListener('blur', pause);
    win.removeEventListener('pagehide', pause);
    doc.removeEventListener('visibilitychange', visibility);
  };
}
