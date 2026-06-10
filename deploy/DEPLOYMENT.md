# AstraTSM — Production Deployment (Ubuntu VPS, gunicorn + nginx)

This guide deploys AstraTSM on a single Ubuntu/Debian VPS using **PostgreSQL**,
**Redis**, **Gunicorn** (Django REST API), **Celery** (background tasks +
scheduled timesheet reminders), and **nginx** (TLS + static frontend).

Assumed layout (adjust paths in the unit/nginx files if you change it):

```
/opt/astratsm/                 # git checkout
├── backend/                   # Django project (manage.py here)
│   ├── venv/                  # Python virtualenv
│   ├── .env                   # from backend/.env.example
│   ├── staticfiles/           # collectstatic output
│   └── media/                 # uploads
├── frontend/
│   └── dist/                  # `npm run build` output (served by nginx)
└── deploy/                    # the files in this folder
```

---

## 1. System packages

```bash
sudo apt update
sudo apt install -y python3-venv python3-dev build-essential \
    postgresql redis-server nginx git curl
# Node 20 for the frontend build
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

## 2. Service user + code

```bash
sudo useradd --system --create-home --shell /bin/bash astratsm
sudo mkdir -p /opt/astratsm && sudo chown astratsm:www-data /opt/astratsm
sudo -u astratsm git clone <YOUR_REPO_URL> /opt/astratsm
```

## 3. PostgreSQL

```bash
sudo -u postgres psql <<'SQL'
CREATE DATABASE astratsm;
CREATE USER astratsm WITH PASSWORD 'change-me';
ALTER ROLE astratsm SET client_encoding TO 'utf8';
ALTER ROLE astratsm SET default_transaction_isolation TO 'read committed';
GRANT ALL PRIVILEGES ON DATABASE astratsm TO astratsm;
SQL
```

## 4. Python env + configuration

```bash
sudo -u astratsm bash
cd /opt/astratsm/backend
python3 -m venv venv
venv/bin/pip install --upgrade pip
venv/bin/pip install -r requirements.txt

cp .env.example .env
# Edit .env — at minimum set SECRET_KEY, ALLOWED_HOSTS, CORS_ALLOWED_ORIGINS,
# DB_*, REDIS_URL/CELERY_*, TIME_ZONE, and email credentials.
nano .env
```

Generate a strong secret key:

```bash
venv/bin/python -c "import secrets; print(secrets.token_urlsafe(64))"
```

Migrate, create the first admin, and collect static:

```bash
venv/bin/python manage.py migrate
venv/bin/python manage.py create_admin
venv/bin/python manage.py collectstatic --noinput
venv/bin/python manage.py check --deploy   # review any warnings
exit   # back to your sudo user
```

## 5. Build the frontend

The frontend talks to the API at the **same origin** (`/api/v1`), so no build
env is needed — nginx serves the static bundle and proxies the API.

```bash
cd /opt/astratsm/frontend
sudo -u astratsm npm ci
sudo -u astratsm npm run build   # outputs to frontend/dist
```

## 6. systemd services

```bash
sudo cp /opt/astratsm/deploy/astratsm-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now astratsm-gunicorn astratsm-celery-worker astratsm-celery-beat
# Optional (only if you enable WebSocket chat):
# sudo systemctl enable --now astratsm-daphne
```

Check they came up cleanly:

```bash
systemctl status astratsm-gunicorn astratsm-celery-worker astratsm-celery-beat
journalctl -u astratsm-celery-beat -n 50 --no-pager
```

> **Reminders:** `astratsm-celery-worker` + `astratsm-celery-beat` together fire
> the daily timesheet reminders. Beat triggers them; the worker sends them.
> Both must be running. Times come from `TIMESHEET_REMINDER_*` in `.env` and use
> your `TIME_ZONE`. Test immediately without waiting for the schedule:
>
> ```bash
> sudo -u astratsm /opt/astratsm/backend/venv/bin/python \
>     /opt/astratsm/backend/manage.py send_timesheet_reminders
> ```

## 7. nginx + TLS

```bash
sudo cp /opt/astratsm/deploy/nginx.conf /etc/nginx/sites-available/astratsm
# edit server_name + paths in the file to match your domain
sudo ln -s /etc/nginx/sites-available/astratsm /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# TLS certificate
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

## 8. Updating after the first deploy

```bash
sudo -u astratsm /opt/astratsm/deploy/deploy.sh
```

---

## Troubleshooting

| Symptom | Check |
|---|---|
| 502 from nginx | `journalctl -u astratsm-gunicorn`; is the socket at `/run/astratsm/gunicorn.sock`? |
| Reminders never arrive | Are **both** worker and beat active? `journalctl -u astratsm-celery-beat`. Is Redis up? Is email configured? |
| Reminders at the wrong time | `TIME_ZONE` in `.env` must be your local zone; restart beat after changes. |
| Static/admin CSS missing | Re-run `collectstatic`; confirm nginx `/static/` alias path. |
| CORS errors in browser | Add the frontend origin to `CORS_ALLOWED_ORIGINS` and `ALLOWED_HOSTS`. |
| Notifications/approvals 500 | Ensure latest code is deployed (the `ADMIN_ROLES` import fix) and migrations are applied. |

## What runs where

| Process | Unit | Role |
|---|---|---|
| Gunicorn | `astratsm-gunicorn` | Django REST API + admin (WSGI) |
| Celery worker | `astratsm-celery-worker` | Sends emails, in-app notifications, reminders |
| Celery beat | `astratsm-celery-beat` | Schedules reminders + nightly OTP cleanup |
| Daphne (optional) | `astratsm-daphne` | WebSockets, only if enabled |
| nginx | system | TLS, serves frontend, proxies API/media/static |
| PostgreSQL / Redis | system | Database / broker + cache |
