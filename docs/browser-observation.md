# Browser observation

The `observe` workflow performs source review, then compares two Firefox runs using the same controlled local page. One run has no extension; the second temporarily installs the selected XPI in a fresh profile. The browser interface and CLI show progress as each step happens.

## What happens in each run

1. XInspect starts a local page with synthetic text and a local request collector, plus a rejecting HTTP(S) proxy.
2. It launches Firefox with a fresh temporary profile and connects through WebDriver BiDi.
3. Firefox loads the local page. XInspect fills a synthetic field, dispatches an input event, clicks the page's test button, and waits for the selected window.
4. It captures page content, console messages, browser network events, local collector requests, and proxy connection attempts. Firefox and its temporary profile are then closed and removed.
5. The second run repeats the same steps with the extension installed. XInspect compares the two runs and saves HTML and JSON reports.

The progress timeline distinguishes the baseline and extension runs. It reports when Firefox launches, the package installs, the page loads, actions run, evidence is captured, and reports are saved. Browser observation does not capture page screenshots.

## Reading the results

The report highlights page content differences, whether the local collector received the known synthetic marker, and proxy destinations absent from the baseline. It includes captured request and console details, both DOM snapshots as text, the source review, and the limits of observation. A destination alone does not reveal an HTTPS request body or prove which component initiated it.

The local test page has no advertisements or third-party trackers. The scripted actions do not press extension shortcuts or open popups. This scenario may therefore show no page change for extensions whose main behavior requires those triggers. A quiet result does not establish safety.

## Network and execution limits

WebDriver BiDi interception rejects observed external HTTP requests. The local HTTP(S) proxy rejects additional connection attempts. These controls are part of the experiment, not an operating-system sandbox. An extension can alter proxy settings, non-HTTP traffic is not comprehensively controlled, and Firefox may omit extension-originated requests from BiDi events. Use a disposable isolated virtual machine with restricted networking for unknown packages.

Observations are limited to one local page and the selected time window. Browser events may come from Firefox or the page, so a difference from baseline is not guaranteed extension attribution. DOM changes show changes, not page reads. Source signals and browser events cannot generally be linked to the same code path.

Per-run capture limits are 2,000 browser requests, 2,000 local requests, 2,000 proxy attempts, 64 KiB per local request body, 500 console entries, 1 MiB DOM source, and 64 KiB page text. The report notes relevant truncation.
