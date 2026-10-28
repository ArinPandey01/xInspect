# Source review

The `analyze` workflow reads a Firefox XPI or ordinary ZIP package without executing it. It validates the archive, calculates SHA-256 from the exact package bytes, inventories files, parses `manifest.json`, and scans packaged `.js`, `.mjs`, `.cjs`, `.html`, and `.htm` files. The scan includes source files even when the manifest does not reference them.

## Archive checks

The reader rejects encrypted entries, ZIP64, unsupported compression, unsafe or duplicate paths, more than 1,000 entries, archives over 25 MiB, or expanded content over 100 MiB. Individual source files are limited to 5 MiB and other assets to 25 MiB. It checks CRC values while loading the ZIP. It does not extract package entries to the filesystem.

## Manifest and source signals

The manifest summary includes the extension name and version, Manifest V2 or V3, required and optional browser permissions, required and optional host access, content scripts, background scripts or worker, and page entry points. Missing referenced files are reported as limitations.

The source scan looks for selected browser APIs, page content reads and writes, network calls, literal HTTP(S) URLs, and dynamic code execution. Findings are grouped by kind and assigned low, medium, or high **review priority**. A high group can combine signals found in different files of the same package. It points to code worth tracing; it does not prove those code paths run together or that data was sent.

Each finding includes a short reason and source locations where available. `report.json` preserves the structured evidence; `report.html` presents the summary, findings, inventory, and limitations. SHA-256 identifies the input package.

## Optional reference checks

The report has a separate reference-check section. With `--mozilla-blocklist`, XInspect queries Mozilla's Add-ons blocklist using the Firefox extension ID declared in `browser_specific_settings.gecko.id` (or the older `applications.gecko.id`) and compares the package version with listed hard and soft blocks. Packages without a declared ID cannot be checked this way. The lookup is optional because it sends the ID to Mozilla and requires network access.

With `--hash-list`, XInspect compares the SHA-256 of the exact package bytes to a user-supplied local JSON list. Only exact matches are reported. The list's labels and source references are supplied by the user and are not independently verified by XInspect. A missing match is not a safety verdict. If a lookup fails, its status is reported as unavailable rather than not listed.

## Interpretation limits

Static review cannot establish which code executes in a particular browser session. It can miss generated code, obfuscation, computed destinations, unsupported syntax, and behaviors triggered only by a specific site or action. Legitimate extensions may need broad page access and network requests. Review the actual data flow and extension purpose before drawing a conclusion.
