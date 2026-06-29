#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$ROOT_DIR"
git pull --ff-only

cd "$ROOT_DIR/skt"
docker compose build
docker compose up -d app scheduler

cd "$ROOT_DIR/gentlemonster"
docker compose build
docker compose up -d app scheduler

sudo cp "$ROOT_DIR/infra/nginx/nginx-dashboard.conf" /etc/nginx/sites-available/skt-mainpage-dashboard
sudo nginx -t
sudo systemctl reload nginx

cd "$ROOT_DIR/skt"
docker compose ps

cd "$ROOT_DIR/gentlemonster"
docker compose ps

