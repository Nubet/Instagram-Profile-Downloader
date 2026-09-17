# Browser Download Adapters

This document explains why Chrome and Firefox use different download code in
InstaBulk Profile Downloader. It also explains how the build selects the
correct code for each browser.

The short version is:

- The application creates one neutral `DownloadBatch`.
- The background code uses one `DownloadAdapter` interface.
- The Chrome build selects the Chrome adapter.
- The Firefox build selects the Firefox adapter.
- Both builds share scraping, file selection, batching, ZIP contents, and
  progress reporting.

The browser-specific part is only the last step: delivering locally generated
file content to the user's Downloads system.

## Why This Exists

The original implementation was designed around the Chromium Downloads API.
It worked correctly in Chrome for both delivery modes:

- Individual files were sent to `browser.downloads.download`.
- Captions used local `blob:` URLs.
- ZIP archives used a base64 `data:` URL.
- The `filename` option could contain folders, such as
  `profile/post-id/caption.txt`.

Firefox accepts remote media URLs in the Downloads API, so images and videos
continued to work. It did not accept the locally generated URLs in the same
way. The important errors were:

```text
Type error for parameter options
Error processing url: Error: Access denied for URL blob:moz-extension://...
```

and:

```text
Error processing url: Error: Access denied for URL data:text/plain;charset=utf-8,...
```

This explains the different symptoms:

- Remote images worked because Firefox could download their HTTPS URLs.
- Local captions failed when passed to the Downloads API as `blob:` or
  `data:` URLs.
- ZIP archives failed when passed as large base64 `data:` URLs.

The problem is not caption fetching. Captions are already present in the
`DownloadBatch`. The problem happens when the browser is asked to save local
content.

## Shared Download Model

Scraping does not know which browser is running. It produces a neutral model:

```ts
interface DownloadBatch {
  sessionId: string
  profile: InstagramProfile
  posts: ScrapedPost[]
  items: DownloadItem[]
}
```

Each item is one image, video, or caption:

```ts
interface DownloadItem {
  id: string
  postId: string
  kind: 'image' | 'video' | 'caption'
  path: string
  source: DownloadSource
}
```

The source is either a remote URL or local text:

```ts
type DownloadSource =
  { type: 'remote-url', value: string }
  | { type: 'text', value: string, mimeType: 'text/plain;charset=utf-8' }
```

The same `DownloadBatch` is used for both delivery modes:

1. `downloadBatch` processes individual items.
2. `downloadBatchAsZip` fetches items, adds them to JSZip, and processes the
   resulting archive.

The batch code does not contain browser checks. This is intentional. It keeps
the application logic independent from browser limitations.

## Adapter Interface

The platform boundary is defined in
`src/features/downloads/background/downloadAdapter.ts`:

```ts
interface DownloadAdapter {
  downloadText: (
    value: string,
    filename: string,
    mimeType: string,
    trace?: DownloadTraceEntry[],
  ) => Promise<void>

  downloadArchive: (
    zip: JSZip,
    filename: string,
    trace?: DownloadTraceEntry[],
  ) => Promise<void>
}
```

The callers only need to know that content can be delivered:

```ts
await downloadAdapter.downloadText(
  item.source.value,
  item.path,
  item.source.mimeType,
  trace,
)
```

and:

```ts
await downloadAdapter.downloadArchive(zip, filename, trace)
```

The callers do not know whether the implementation uses a Blob URL, a data
URL, a temporary extension page, or another browser-specific mechanism.

## Adapter Selection

The build receives the target from the `EXTENSION` environment variable:

```ts
const isFirefox = process.env.EXTENSION === 'firefox'
```

Vite converts this value into the compile-time constant `__IS_FIREFOX__`.
The adapter selector is then compiled as:

```ts
const isFirefoxBuild = typeof __IS_FIREFOX__ !== 'undefined' && __IS_FIREFOX__

export const downloadAdapter = isFirefoxBuild
  ? firefoxDownloadAdapter
  : chromeDownloadAdapter
```

This is a build-time decision, not a runtime browser detection. The result is
important because each output directory is a complete extension:

```text
extension-chromium/
extension-firefox/
```

The Chrome build does not contain the Firefox download page. The Firefox build
does contain it and its background bundle selects the Firefox adapter.

## Chrome Workflow

The Chrome adapter is in:

```text
src/features/downloads/background/chromeDownloadAdapter.ts
```

### Individual Files

Remote media keeps the standard path:

1. `downloadItem` creates a URL for the remote media.
2. `browser.downloads.download` receives the URL and the original relative
   filename.
3. Chrome creates the requested folder structure.

Local captions use the original Blob URL approach:

1. The adapter creates a Blob with `text/plain;charset=utf-8`.
2. It creates a `blob:` URL with `URL.createObjectURL`.
3. It calls `browser.downloads.download` with the original filename.
4. It revokes the URL in a `finally` block.

The filename can contain a relative path:

```text
norbert_fila/0003_post-id/caption.txt
```

Chrome uses that path to create folders below the configured Downloads
directory.

### ZIP Archives

The Chrome adapter preserves the original ZIP mechanism:

1. The shared ZIP code adds files and metadata to a JSZip instance.
2. The adapter generates base64 output with JSZip.
3. It creates a `data:application/zip;base64,...` URL.
4. It calls `browser.downloads.download` with the archive filename.

This is the path that worked before the Firefox fix and is kept unchanged for
Chrome because it produces valid archives in Chromium.

## Firefox Workflow

The Firefox adapter is in:

```text
src/features/downloads/background/firefoxDownloadAdapter.ts
```

Firefox does not reliably allow the background Downloads API to consume local
`blob:` or `data:` URLs created by the extension. The workaround is a small
extension page:

```text
src/downloads/index.html
src/downloads/main.ts
```

### Local File Flow

For a caption or ZIP archive:

1. The background adapter creates a unique request ID.
2. It stores the content and filename in an in-memory request map.
3. It opens `dist/downloads/index.html?id=<request-id>` in an inactive tab.
4. The page sends `download-ready` to the background context.
5. The background context returns the matching content.
6. The page creates a Blob locally.
7. The page creates an object URL.
8. The page creates an anchor with the `download` attribute.
9. The page appends and clicks the anchor.
10. The page waits briefly so Firefox can start the transfer.
11. The page revokes the object URL.
12. The page sends `download-complete`.
13. The background context resolves the request and closes the tab.

The request ID is used to match messages. `sender.tab` is not used as the
primary check because Firefox does not always provide `sender.tab` for
messages sent by an extension page.

### Firefox ZIP Flow

The shared ZIP code still controls the archive contents, manifest, error file,
and archive splitting. Only the final delivery is different:

1. JSZip generates a Blob instead of base64 output.
2. The Firefox adapter passes that Blob to the temporary extension page.
3. The page downloads it through an anchor.

This avoids the large `data:` URL that Firefox rejected and keeps the ZIP
binary intact.

### Firefox Individual Captions

Firefox can download the caption through the extension page, but the HTML
`download` attribute cannot create arbitrary subfolders. A path such as:

```text
norbert_fila/0003_post-id/caption.txt
```

is therefore flattened to a safe filename for the fallback page download:

```text
norbert_fila_0003_post-id_caption.txt
```

The file is saved in the user's normal Downloads directory. This is a Firefox
platform limitation, not a missing caption or a failed fetch.

ZIP mode remains the way to preserve the complete folder structure in Firefox.

## Why One Workflow Is Not Used Everywhere

It is tempting to use the Firefox page for both browsers or to force both
browsers through `downloads.download`. Both choices create problems:

- Using the Firefox page in Chrome changes working folder behavior and adds a
  temporary tab for every local file.
- Using Chrome's base64 ZIP URL in Firefox causes access-denied errors and can
  corrupt or block the archive.
- Using a Firefox `data:` URL for captions also produces an access-denied
  error.
- Browser detection at runtime would make one bundle contain competing code
  paths and make build failures harder to diagnose.

The adapter boundary gives each browser its native working path while keeping
the business logic shared.

## Build Configuration

### Development

```bash
pnpm dev          # Chromium target
pnpm dev-firefox  # Firefox target
```

The development commands set `EXTENSION` before starting the Vite processes.
The prepare script uses the same value when creating development HTML files.

### Production Builds

```bash
pnpm build:chromium
pnpm build:firefox
pnpm build:all
```

Each build performs these steps:

1. Clear only its own output directory.
2. Build the web pages.
3. Copy assets and generate the target manifest.
4. Build the background bundle.
5. Build the content script.

The web Vite configuration includes the downloads page only when
`EXTENSION=firefox`:

```ts
const input = {
  popup: r('src/popup/index.html'),
  ...(isFirefox ? { downloads: r('src/downloads/index.html') } : {}),
}
```

The prepare script uses the same condition for development stubs. This keeps
the output directories consistent with the selected adapter.

### Packaging

```bash
pnpm package:chromium  # extension.zip
pnpm pack:xpi          # extension.xpi
pnpm package:all       # both release formats
```

The release script builds both targets first, then packages the already
separated output directories:

```text
extension-chromium/ -> <version>-chromium.zip
extension-firefox/  -> <version>-firefox.xpi
```

Do not package the Firefox XPI from `extension-chromium`, or the Chromium ZIP
from `extension-firefox`. The manifest and adapter are target-specific.

## Verification Checklist

Run the automated checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build:chromium
pnpm build:firefox
```

Then verify the build outputs:

- `extension-chromium/dist/downloads/` does not exist.
- `extension-firefox/dist/downloads/index.html` exists.
- Chrome background code contains the base64 ZIP path.
- Firefox background code contains the extension-page download path.

Manual browser checks should cover:

- Chrome individual files create profile/post folders.
- Chrome captions are downloaded as TXT files.
- Chrome ZIP opens without corruption.
- Firefox remote images and videos download.
- Firefox captions download as flattened TXT files.
- Firefox ZIP opens and contains the expected folder structure.
- ZIP `_manifest.json` is present.
- ZIP `_errors.txt` appears when an item cannot be fetched.

## Download Trace Logs

Download operations return trace entries to the content runtime. The existing
session log displays them under the `downloads` scope.

Useful entries include:

```text
Starting individual download
Browser download accepted
Creating Firefox download tab
Firefox download page sent download-ready
Firefox download page sent download-complete
Opening Chrome ZIP download
Opening Firefox ZIP download
Firefox download page failed
```

The trace confirms the last completed application step. It does not replace
the browser's Downloads UI, so a `download-complete` entry means that the
extension page dispatched the browser download action, not that the user has
already opened the resulting file.

## Maintenance Rules

When changing download behavior:

1. Keep `DownloadBatch` browser-neutral.
2. Add browser-specific behavior to an adapter, not to batch orchestration.
3. Preserve the original Chrome adapter unless Chrome behavior intentionally
   changes.
4. Test both archive output formats independently.
5. Keep `EXTENSION` and `__IS_FIREFOX__` as the single source of truth for
   target selection.
6. Update this document when a browser changes its URL or Downloads API
   behavior.
