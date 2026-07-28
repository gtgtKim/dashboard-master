# SKT Mainpage Dashboard

GA attributes snapshot dashboard for the T world Shop main and exhibition pages.

## Local Docker

```bash
docker compose build
APP_PORT=4176 docker compose up -d app scheduler
```

Open:

```text
http://127.0.0.1:4176/snapshots/index.html
```

Default dashboard password:

```text
jellyfish
```

Run a manual capture with retry:

```bash
docker compose run --rm --no-deps capture
```

Check the daily scheduler:

```bash
docker compose logs --tail=50 scheduler
```

## Secrets And Data

Do not commit these files or folders:

- `skt-otw-ua-*.json`
- `snapshots/`
- `.env`

The GA4 service account JSON must exist on the host and is mounted into the container as read-only.
Runtime GA4 metrics use Data API v1alpha Report Tasks with `samplingLevel: UNSAMPLED`.
This mode requires a Google Analytics 360 property. Each date-range change creates a fresh report
task; concurrent requests for the same page and range share only the in-progress request.
Top-level totals come from the report's direct `TOTAL` aggregation. Group event counts, sessions,
and active users come from a separate report that uses the same event name, event category, and
page-specific hostname filters as the total, with `event_action` as its only grouping dimension.
No URL filter or element-row sum is used for group metrics. The dashboard can export the selected,
filtered, and sorted table as `.xlsx`.

Gemini insights default to the lower-cost `gemini-3-flash-preview`. Users can select
`gemini-3.1-pro-preview` with high thinking when they need a more precise analysis.
Generation uses temperature `0.4`. Insight input identifies each page as PC web, mobile web, or
webview, marks exhibition pages as Samsung Galaxy promotions, and includes click/session/user
metrics per observed snapshot day. These are observation-day reference values, not impressions or
actual exposure-day performance.
Repeated daily element observations are compacted before the request, and oversized periods
are analyzed in chunks. Model IDs can be changed with `GEMINI_FLASH_MODEL` and
`GEMINI_PRO_MODEL`; input limits can be changed with `GEMINI_INSIGHTS_MAX_INPUT_TOKENS`
and `GEMINI_INSIGHTS_CHUNK_INPUT_TOKENS`.
After the first insight is ready, the SKT dashboard can send follow-up questions with the
recent conversation as context. Identical page, period, question, and conversation requests
are cached under `snapshots/ai-follow-ups/`; changing the model or follow-up prompt version
automatically uses a new cache key.

## Production On GCP VM

The intended production pattern is:

```text
GitHub private repository
  -> GCP Compute Engine VM git pull
  -> docker compose build
  -> docker compose up -d app scheduler
```

Use a GitHub read-only deploy key on the VM for private repository access.

For production without a domain, keep the app bound to localhost and put Nginx HTTPS in front:

```bash
APP_BIND=127.0.0.1 APP_PORT=4173 DASHBOARD_REQUIRE_HTTPS=true docker compose up -d app scheduler
```

The scheduler runs capture every day at `10:00 Asia/Seoul` and retries failures. It currently
captures five targets: mobile/PC main, mobile/PC P00000494 exhibition, and mobile P00000495
exhibition. Exhibition reporting starts on `2026-07-28`. P00000495 GA4 data uses
`MTWD - P00000495` and
`hostName = my-shop.tworld.co.kr`.
