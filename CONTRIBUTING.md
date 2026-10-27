# Contributing

Use English for issues, documentation, comments, public API names, and examples.
Keep the library engine-neutral: game rules, asset formats, UI layouts, native
bridge signatures, storage namespaces, and rendering belong in host adapters.

## Development

```sh
npm ci
npm test
npx playwright install --with-deps chromium webkit
npm run test:browser
npm run build
python3 -m http.server 8080
# Open http://localhost:8080/examples/
```

Add behavior tests for changes to cancellation, lifecycle ordering, input sources,
transaction completion, or offline updates. Keep sources and TypeScript declarations
consistent. Do not commit build output, browser downloads, game assets, or credentials.
Contributions retain GPL-2.0-or-later licensing; preserve provenance notices.

## Releases

1. Update `package.json`, its lockfile, and `CHANGELOG.md` together.
2. Run the Node and browser suites and inspect `npm pack --dry-run`.
3. Merge the reviewed change to `main`.
4. Create and push a version tag matching the package version, for example:

```sh
git tag -a v0.1.0 -m "Browser Game Runtime 0.1.0"
git push origin v0.1.0
```

The GitHub workflow tests the tagged revision before publishing its `.tgz` and
SHA-256 checksum as GitHub Release assets. Tags are not created automatically.
The workflow does not publish to npm; that requires a separately configured and
authorized release process. Consumers can install the downloaded tarball with npm.

## Reporting bugs

Include browser and OS versions, package version, a minimal reproduction, expected
behavior, and actual behavior. For native ports, describe the adapter and engine
revision. Do not upload commercial game assets or personal save data.
