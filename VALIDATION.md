# Standalone validation

Validated locally on 2026-10-27 after extraction into this independent repository.

- `npm ci`: installed the locked development dependencies without a parent project.
- `npm test`: 10 Node tests passed.
- `npm run test:browser`: 2 tests passed, Chromium and WebKit. Tests exercise real
  IndexedDB commits and aborts, namespace isolation, and offline reload after the
  HTTP origin server is stopped.
- `npm pack`: includes compiled ESM, declarations, sources, tests, examples,
  license, provenance, and English documentation.

The Linux cloud executor required locally extracted Debian libraries for WebKit.
A local browser wrapper preserved `LD_LIBRARY_PATH`; the host preflight was
disabled because those libraries were not installed globally. The actual browser
executed the tests. WPE's simulated offline flag has an internal navigation error,
so both browsers were tested with the origin server stopped; Chromium additionally
used the simulated offline flag. No physical mobile, performance, energy, or audio
latency certification is implied.

These are local validation results. Remote results are recorded in the repository's
GitHub Actions runs. Version tags trigger a tested GitHub Release; npm publication
is not configured. The source has no dependency on the original game's checkout or assets.
