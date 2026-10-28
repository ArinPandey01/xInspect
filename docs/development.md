# Development

XInspect is a TypeScript project using Node.js. `npm run build` compiles `src/` and `test/` into `dist/`. The web interface uses Node's HTTP server and browser JavaScript; it has no separate frontend build.

## Project layout

| Path | Purpose |
|---|---|
| `src/archive.ts`, `src/manifest.ts`, `src/scan.ts`, `src/analyze.ts` | Archive validation and source review |
| `src/dynamic/` | Firefox control, local test services, comparison, and observation report |
| `src/cli.ts` | Command-line entry point |
| `src/web.ts` | Local browser interface and report server |
| `examples/` | Source code for synthetic test extensions and a test page |
| `scripts/package-examples.mjs` | Builds example XPI packages from source directories |
| `test/` | Unit and Firefox integration tests |

## Useful commands

```sh
npm install
npm run build
npm test
npm run test:browser
npm run package:examples
```

`npm test` runs the unit suite. `npm run test:browser` requires Firefox and runs only generated fixtures. The browser suite covers page changes, a local dummy-data request, blocked external requests, Firefox launch failure, and interrupted runs.

`node_modules/`, `dist/`, `reports/`, `samples/`, and generated example XPIs are ignored by Git. Keep real extension packages and captured reports local. The academic review submission is also excluded from the repository.

When adding a source rule, update its signal classification in `src/types.ts`, detection in `src/scan.ts` or `src/manifest.ts`, and finding text in `src/analyze.ts`. When changing the browser scenario, review both baseline and extension paths in `src/dynamic/browser.ts` so the comparison remains meaningful.
