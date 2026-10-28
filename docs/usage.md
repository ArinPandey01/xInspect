# Using XInspect

## Requirements

- Node.js 20 or newer for source review.
- Node.js 22 or newer and Firefox with WebDriver BiDi support for browser observation. Firefox 158.0 on Linux was used during development.
- Run commands from the project root after `npm install`.

## Browser interface

Run `npm run web`, then open `http://127.0.0.1:4173`.

1. Choose an `.xpi` or `.zip` package up to 25 MiB.
2. Select **Source review**, **Browser observation**, or **Both**.
3. Optionally select the Mozilla blocklist check. This sends the Firefox extension ID from the manifest to Mozilla. For browser observation, choose a 1–60 second window and acknowledge that extension code will run in Firefox.
4. Start the analysis. The progress panel shows package checks, Firefox launch and page actions, capture, comparison, and report creation.
5. Open the HTML report or download its JSON data from the result links.

The server binds to `127.0.0.1`, accepts one job at a time, and saves reports under `reports/web/`. Uploaded package copies are deleted after the job; report URLs remain usable after a server restart. Set `XINSPECT_WEB_PORT` to change the interface port, `XINSPECT_OBSERVE_PORT` to change the local test page port, or `XINSPECT_REPORTS_DIR` to change the report directory. The default test page port is 8765.

To use a local hash reference list in the browser interface, set `XINSPECT_HASH_LIST=/absolute/path/to/list.json` before starting the server. XInspect reads it for each job; it does not upload the list to Mozilla.

## Command line

Build once after changing TypeScript source:

```sh
npm run build
```

Run source review:

```sh
node dist/src/cli.js analyze path/to/extension.xpi --out reports/my-extension
```

This writes `report.html` and `report.json`. The command prints a `file:///` URL to open the HTML report.

Run browser observation:

```sh
node dist/src/cli.js observe path/to/extension.xpi --out reports/my-observation --seconds 5
```

The observation output directory must be empty. This command also creates a source report in that directory. Its main outputs are `observation.html` and `observation.json`; DOM text and Firefox logs are retained for inspection.

| Option | Meaning |
|---|---|
| `--seconds N` | Observation time per Firefox run, 1–60 seconds; default 5 |
| `--port N` | Local test page and collector port; default 8765 |
| `--firefox PATH` | Firefox executable; defaults to `FIREFOX_BINARY` or `firefox` |
| `--headed` | Show Firefox windows; default is headless |
| `--mozilla-blocklist` | Query Mozilla's Add-ons blocklist for the manifest's Firefox ID and version; works with `analyze` and `observe` |
| `--hash-list PATH` | Check the package's SHA-256 against a local JSON list; works with `analyze` and `observe` |

The local list is a JSON array. For example:

```json
[
  {
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "label": "Example reference entry",
    "source": "Documented incident or analyst record",
    "url": "https://example.org/reference"
  }
]
```

Use the hash of the exact XPI or ZIP bytes. Each record requires `sha256`, `label`, and `source`; `url` is optional. The example hash is illustrative and is not a known malicious package. A match reflects the supplied list's claim; XInspect does not validate that claim. Mozilla's list includes blocks for reasons other than malware. No match in either source does not establish safety. An unavailable lookup is shown separately from a clean lookup.

The synthetic-risk example has a collector URL fixed to port 8765, so keep the default port when using that fixture.

## Example packages

```sh
npm run package:examples
node dist/src/cli.js analyze examples/packages/synthetic-risk.xpi --out reports/example-static
node dist/src/cli.js observe examples/packages/safe-observer.xpi --out reports/example-browser --seconds 5
```

Safe Observer adds a badge to the local test page. Synthetic Risk reads synthetic page text and posts its marker to the local collector. They are team-authored fixtures, not verified malware samples. Generated XPIs and reports are ignored by Git.
