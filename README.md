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
```

## Routes

```text
https://34.47.71.229/                 -> empty 204 response
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

