# XInspect

XInspect reviews Firefox WebExtension packages (`.xpi` or `.zip`). It inspects the manifest and packaged source code, can optionally check Mozilla's blocklist and a local SHA-256 reference list, then can observe the extension in a controlled Firefox run. Results are HTML and JSON reports. Source findings identify code and permissions worth reviewing; they are **not malware verdicts**.

## Quick start

Install dependencies with Node.js 20 or newer:

```sh
npm install
```

Start the local browser interface:

```sh
npm run web
```

Open `http://127.0.0.1:4173`, choose an XPI or ZIP file, and select **Source review**, **Browser observation**, or **Both**. The page shows each analysis step and links to the finished reports. Browser observation requires Node.js 22 or newer and Firefox with WebDriver BiDi support.

For the command line:

```sh
npm run build
node dist/src/cli.js analyze path/to/extension.xpi --out reports/my-extension
node dist/src/cli.js observe path/to/extension.xpi --out reports/my-observation --seconds 5
```

Each command prints a browser URL for its HTML report. The `observe` output directory must be empty. To try the workflows without an installed extension, run `npm run package:examples` and use an XPI under `examples/packages/`. Those examples are synthetic test fixtures, not malware samples.

Add `--mozilla-blocklist` to request a live Mozilla blocklist check, or `--hash-list path/to/list.json` for exact package hash matching against a local list. The browser interface has an opt-in Mozilla checkbox; set `XINSPECT_HASH_LIST` to a local JSON file before `npm run web` to enable hash matching there. See [usage](docs/usage.md) for the list format and interpretation.

## Documentation

- [Architecture and data flow](docs/architecture.md)
- [Using the web interface and CLI](docs/usage.md)
- [How source review works](docs/source-review.md)
- [How browser observation works](docs/browser-observation.md)
- [Development and project layout](docs/development.md)

## Safety

Browser observation executes extension code in a temporary Firefox profile. For an unknown package, run XInspect inside a disposable isolated virtual machine with restricted networking. A quiet observation does not establish that an extension is safe.

## LLM use

Large language models (LLMs) were used as development assistants while implementing and refining this project, including code and documentation. XInspect does not use an LLM to analyze extension packages at runtime.


