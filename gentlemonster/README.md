# Gentle Monster Mainpage Dashboard

Snapshot dashboard for the Gentle Monster US main page.

The capture visits:

- `https://www.gentlemonster.com/us/en` as mobile
- `https://www.gentlemonster.com/us/en` as desktop

It collects elements that have at least one of these tracking attributes:

- `data-category`
- `data-action`
- `data-area`
- `data-label`

GA4 metric lookup is enabled through the Google Analytics Data API.

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

## Local Node

```bash
npm install
npm run capture
npm run serve
```

Open:

```text
http://127.0.0.1:4173/snapshots/index.html
```

## Data

Do not commit these files or folders:

- `snapshots/`
- `.env`

The scheduler runs capture every day at `10:00 America/New_York` and retries failures.
The snapshot folder date is also generated in the same US timezone.
