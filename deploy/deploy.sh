#!/usr/bin/env bash
# AstraTSM deploy / update script for a gunicorn + nginx VPS.
# Run as the `astratsm` user from the repo root: ./deploy/deploy.sh
set -euo pipefail

ROOT="/opt/astratsm"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV="$BACKEND/venv"

echo "==> Pulling latest code"
git -C "$ROOT" pull --ff-only

echo "==> Backend: installing dependencies"
"$VENV/bin/pip" install -r "$BACKEND/requirements.txt"

echo "==> Backend: running migrations"
"$VENV/bin/python" "$BACKEND/manage.py" migrate --noinput

echo "==> Backend: collecting static files"
"$VENV/bin/python" "$BACKEND/manage.py" collectstatic --noinput

echo "==> Backend: deploy checklist"
"$VENV/bin/python" "$BACKEND/manage.py" check --deploy || true

echo "==> Frontend: building production bundle"
cd "$FRONTEND"
npm ci
npm run build

echo "==> Restarting services"
sudo systemctl restart astratsm-gunicorn astratsm-celery-worker astratsm-celery-beat
sudo systemctl reload nginx

echo "==> Done. Service status:"
systemctl --no-pager --lines=0 status \
    astratsm-gunicorn astratsm-celery-worker astratsm-celery-beat || true
