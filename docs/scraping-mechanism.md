# Instagram Scraping Architecture

This document describes the core mechanics behind the InstaBulk Post Downloader, focusing on how posts are extracted from the DOM and how high-resolution media (including carousels and videos) are resolved via the underlying Instagram GraphQL API.

## High-Level Flow

1. **DOM Traversal & Emulated Scrolling**
   The extension injects a content script into the Instagram Profile page. It smoothly scrolls down the page, triggering Instagram's native lazy-loading (hydration) of older posts.

2. **Anchor Extraction**
   After every scroll tick, the content script scans the DOM for `<a href="/p/SHORTCODE/">` elements. The grid images (thumbnails) are temporarily stored as fallbacks.

3. **High-Resolution Data Fetching (Enrichment)**
   For every unique post shortcode extracted, the extension makes an authenticated GraphQL request to retrieve the full media payload (original resolution images, video URLs, and full captions).

4. **Batch Generation**
    The gathered and enriched data is passed to the background worker (`DownloadManager`), which schedules the native browser downloads.

5. **Download Delivery**
   The generated batch can be saved either as individual browser downloads or as ZIP archive parts. The ZIP mode keeps the same batch model but changes the background delivery strategy.

---

## High-Resolution Media Extraction (The New Instagram v1 API)

Historically, scraping Instagram relied on legacy `query_hash` identifiers which returned data under the `shortcode_media` structure. As of mid-2026, Instagram has deprecated many of these hashes, rotating to a new compiled-operation architecture based on `doc_id`.

Our scraper actively utilizes this new schema to circumvent limitations and correctly extract multi-item media (Carousels) and Videos in high quality.

### The Request Structure

The scraper executes a standard `POST` request to `https://www.instagram.com/graphql/query` leveraging the user's active browser session cookies (`credentials: 'include'`).

It queries the specific legacy-compatible operation designed for web Post Details:
- **`doc_id`**: `27128499623469141` (PolarisPostRootQuery)
- **Variables**:
  ```json
  {
    "shortcode": "ABC123xyz",
    "__relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider": false
  }
  ```

### The Response Structure

The new GraphQL API returns data nested deeply under a `xdt_api__v1__media__shortcode__web_info` wrapper. The extraction logic navigates this structure to locate the `items` array.

```json
{
  "data": {
    "xdt_api__v1__media__shortcode__web_info": {
      "items": [
        {
          "pk": "12345",
          "caption": { "text": "Example text" },
          "carousel_media": []
        }
      ]
    }
  }
}
```

### Media Normalization & Carousel Support

Since the traditional `edge_sidecar_to_children` array and `display_url` properties have been largely replaced in the modern payload, our parser normalizes the new `carousel_media` array.

The parser (`extractMediaFromItem` in `fetchInstagramPostDetails.ts`) executes the following logic for each media item:

1. **Carousel Detection**: It checks if `item.carousel_media` exists. If not, it safely falls back to parsing the legacy `item.edge_sidecar_to_children` or simply wraps the root `item` in an array (for single media posts).
2. **Type Detection**: It determines the media type by evaluating `child.is_video === true` or `child.media_type === 2`.
3. **Resolution Selection**:
   - **For Images**: It searches `child.image_versions2.candidates` and sorts the array by `(width * height)` in descending order, strictly picking the first (highest resolution) URL.
   - **For Videos**: It searches `child.video_versions`, sorts them by resolution in the same manner, and extracts the highest quality `.mp4` URL.
4. **Fallback Mechanism**:
   - **Single Media Fallback**: If a post consists of exactly one image, the parser deliberately returns an empty array. This triggers the scraper to fallback to the DOM grid image, which frequently offers higher uncompressed quality for single-frame grid posts than the GraphQL metadata candidates.
   - **API Failure Fallback**: If the GraphQL request completely fails or returns incomplete media arrays, the script seamlessly falls back to extracting the `meta[property="og:video"]` tag from the post's direct HTML page, ensuring robust scraping continuity.

By utilizing this modernized `doc_id` architecture, the extension avoids brute-force HTML scraping and reliably delegates full carousel hydration to the Instagram backend, drastically increasing the extension's longevity and stability.

---

## Download Delivery Modes

The scraper produces a neutral `DownloadBatch`: profile metadata, selected posts, and flat `DownloadItem` entries. Delivery is handled later by the background worker, so scraping does not need to know whether the user saves files individually or as ZIP archives.

### Individual Files

The default mode keeps the original behavior. Each item is passed to the browser Downloads API as a separate download. Remote media URLs are handed directly to the browser, while captions are converted to blob/data URLs.

This is simple and memory-efficient, but large profiles can create hundreds of entries in Chrome's download history.

### ZIP Archive Parts

The ZIP mode uses the same `DownloadBatch`, but the background worker fetches each item, adds it to a ZIP archive, and downloads the archive as a single file. To avoid one huge in-memory archive, ZIP mode automatically starts a new part when either limit is reached:

- `maxArchiveBytes`: 400 MB of source content by default.
- `maxArchiveItems`: 500 files by default.

Archive names use the profile root, current date, and part number:

```text
username_2026-09-15_part-001.zip
username_2026-09-15_part-002.zip
```

Each ZIP part includes `_manifest.json` with the packed items. If any item fails to fetch, the archive also includes `_errors.txt`; successful files are still saved instead of failing the whole batch.

ZIP mode requires the extension to fetch Instagram CDN media directly, so the manifest includes host permissions for Instagram and common media CDN hosts.
