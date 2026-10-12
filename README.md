# Dashboard Master

One VM hosts separate dashboard apps behind a shared Nginx entrypoint.

## Structure

```text
dashboard-master/
  infra/
    nginx/
      nginx-dashboard.conf
    deploy/
      deploy-all.sh
  skt/
  gentlemonster/
  pmk_drive/
```

## Routes

```text
https://34.47.71.229/                 -> 404 Not Found
https://34.47.71.229/pmk             -> PMK menu (Drive, HVC, Web Vitals)
https://34.47.71.229/pmk_drive/       -> PMK Drive (GCS file workspace)
https://34.47.71.229/pmk_hvc/         -> PMK HVC report
https://34.47.71.229/pmk_webvital/    -> PMK Web Vitals
https://34.47.71.229/skt/             -> SKT dashboard
https://34.47.71.229/gentlemonster/   -> Gentle Monster dashboard
```

## Local Apps

Run each app from its own directory.

```bash
cd skt
BASE_PATH=/skt PORT=4173 npm run serve

cd gentlemonster
BASE_PATH=/gentlemonster PORT=4174 npm run serve
```

## Deployment

The shared Nginx config lives in `infra/nginx/nginx-dashboard.conf`.
On the VM it is installed to:

```text
/etc/nginx/sites-available/skt-mainpage-dashboard
```

Use `infra/deploy/deploy-all.sh` on the VM to update both apps and reload Nginx.

## PMK Drive

Folder-based file sharing with resumable direct-to-GCS uploads, plus the bilingual PMK service menu at `/pmk`. See [pmk_drive/README.md](pmk_drive/README.md) for setup, access, storage and deployment. The app runs as its own systemd service on port 4178; its installer adds the PMK Drive and menu Nginx blocks and preserves other live routes.
