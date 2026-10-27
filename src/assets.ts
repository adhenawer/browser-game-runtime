// SPDX-License-Identifier: GPL-2.0-or-later
export type AssetErrorCode = 'http' | 'size' | 'hash' | 'manifest';
export class AssetError extends Error {
  constructor(public readonly code: AssetErrorCode, message: string) { super(message); this.name = 'AssetError'; }
}
export interface ReadOptions {
  signal?: AbortSignal;
  onProgress?: (receivedBytes: number) => void;
  onVerifying?: () => void;
}
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
/** Writes into the provided buffer. Discard its contents if verification fails. */
export async function readVerifiedPart(response: Response, target: Uint8Array<ArrayBuffer>, sha256: string, options: ReadOptions = {}): Promise<void> {
  const { signal, onProgress, onVerifying } = options;
  signal?.throwIfAborted();
  if (!validHash(sha256)) throw new AssetError('manifest', 'Expected a SHA-256 hexadecimal digest.');
  if (!response.ok) throw new AssetError('http', `Asset request failed with HTTP ${response.status}.`);
  let offset = 0;
  const reader = response.body?.getReader();
  const cancel = () => { void reader?.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (reader) {
      for (;;) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        signal?.throwIfAborted();
        if (done) break;
        if (offset + value.length > target.length) throw new AssetError('size', 'Asset exceeds its declared byte length.');
        target.set(value, offset); offset += value.length; onProgress?.(offset);
      }
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer());
      signal?.throwIfAborted();
      if (bytes.length !== target.length) throw new AssetError('size', 'Asset byte length does not match its manifest.');
      target.set(bytes); offset = bytes.length; onProgress?.(offset);
    }
    if (offset !== target.length) throw new AssetError('size', 'Asset ended before its declared byte length.');
    onVerifying?.();
    signal?.throwIfAborted();
    const digest = await crypto.subtle.digest('SHA-256', target);
    signal?.throwIfAborted();
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== sha256.toLowerCase()) throw new AssetError('hash', 'Asset SHA-256 verification failed.');
  } catch (error) {
    await reader?.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel); reader?.releaseLock();
  }
}
export interface AssetPart { url: string; offset: number; bytes: number; sha256: string }
export interface AssetManifest { bytes: number; parts: readonly AssetPart[] }
export interface AssetProgress { phase: 'reading' | 'verifying' | 'verified'; part: number; parts: number; received: number; total: number }
export interface BundleOptions {
  signal?: AbortSignal;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  onProgress?: (progress: AssetProgress) => void;
  /** Allocation limit, checked before fetch or allocation. Defaults to 512 MiB. */
  maxBytes?: number;
}
/** Downloads contiguous parts sequentially into one verified output allocation. */
export async function loadAssetBundle(manifest: AssetManifest, options: BundleOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  options.signal?.throwIfAborted();
  const limit = options.maxBytes ?? 512 * 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1 || !manifest || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > limit || !Array.isArray(manifest.parts) || !manifest.parts.length)
    throw new AssetError('manifest', 'Invalid asset manifest or allocation limit.');
  // Snapshot caller data before asynchronous work so offsets and hashes cannot change mid-load.
  const total = manifest.bytes;
  const parts: AssetPart[] = manifest.parts.map(part => ({ ...part }));
  let offset = 0;
  for (const part of parts) {
    if (typeof part.url !== 'string' || !part.url.length || !Number.isSafeInteger(part.bytes) || part.bytes < 1 || part.offset !== offset || !validHash(part.sha256))
      throw new AssetError('manifest', 'Parts must be contiguous and contain valid URLs, sizes, and SHA-256 digests.');
    offset += part.bytes;
    if (!Number.isSafeInteger(offset) || offset > total) throw new AssetError('manifest', 'Asset parts exceed the declared total.');
  }
  if (offset !== total) throw new AssetError('manifest', 'Asset parts do not cover the declared total.');
  const output = new Uint8Array(total);
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  for (const [index, part] of parts.entries()) {
    options.signal?.throwIfAborted();
    const report = (phase: AssetProgress['phase'], received: number) => options.onProgress?.({ phase, part: index, parts: parts.length, received: part.offset + received, total });
    const response = await fetcher(part.url, { signal: options.signal, cache: 'no-store' });
    await readVerifiedPart(response, output.subarray(part.offset, part.offset + part.bytes), part.sha256, {
      signal: options.signal, onProgress: bytes => report('reading', bytes), onVerifying: () => report('verifying', part.bytes)
    });
    report('verified', part.bytes);
  }
  options.signal?.throwIfAborted();
  return output;
}
