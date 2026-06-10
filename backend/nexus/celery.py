"""
backend/nexus/celery.py

Celery application for AstraTSM.
This file bootstraps Celery and wires up Celery Beat for scheduled tasks.

HOW IT AUTO-RUNS:
  - Celery Worker  processes tasks (sends emails, etc.)
  - Celery Beat    fires the scheduled tasks at the right time (replaces cron)
  Both run as long-lived processes alongside your Django/ASGI server.

STARTUP COMMANDS (run these in separate terminals / supervisor processes):
  # Worker
  celery -A nexus worker --loglevel=info

  # Beat scheduler (NEVER run two beat processes at once)
  celery -A nexus beat --loglevel=info --scheduler django_celery_beat.schedulers:DatabaseScheduler

  OR combined (dev only, not recommended for production):
  celery -A nexus worker --beat --loglevel=info
"""
import os

from celery import Celery
from celery.schedules import crontab

# Tell Django which settings module to use
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nexus.settings')

app = Celery('nexus')

# Pull CELERY_* settings from Django settings.py
app.config_from_object('django.conf:settings', namespace='CELERY')

# Auto-discover tasks in all installed apps (looks for tasks.py in each app)
app.autodiscover_tasks()

# ── Scheduled tasks (Celery Beat) ────────────────────────────────────
# These fire automatically — no cron or manual command needed.
# Times are in the timezone set by CELERY_TIMEZONE in settings.py.

# Reminder times are configurable via env so ops can tune them per-deployment
# without code changes. Format: HOUR and MINUTE (24h, in CELERY_TIMEZONE).
_R1_HOUR = int(os.environ.get('TIMESHEET_REMINDER_1_HOUR', 17))
_R1_MIN = int(os.environ.get('TIMESHEET_REMINDER_1_MINUTE', 30))
_R2_HOUR = int(os.environ.get('TIMESHEET_REMINDER_2_HOUR', 17))
_R2_MIN = int(os.environ.get('TIMESHEET_REMINDER_2_MINUTE', 45))

app.conf.beat_schedule = {
    # First timesheet reminder (weekdays only) — default 5:30 PM
    'timesheet-reminder-first': {
        'task': 'resources.tasks.run_timesheet_reminders',
        'schedule': crontab(hour=_R1_HOUR, minute=_R1_MIN, day_of_week='1-5'),  # Mon–Fri
        'kwargs': {'slot': 'first'},
    },
    # Second timesheet reminder (weekdays only) — default 5:45 PM
    'timesheet-reminder-second': {
        'task': 'resources.tasks.run_timesheet_reminders',
        'schedule': crontab(hour=_R2_HOUR, minute=_R2_MIN, day_of_week='1-5'),  # Mon–Fri
        'kwargs': {'slot': 'second'},
    },
    # Nightly housekeeping — purge consumed / expired login OTP challenges (3:15 AM)
    'purge-stale-otp-challenges': {
        'task': 'accounts.tasks.purge_stale_otp_challenges',
        'schedule': crontab(hour=3, minute=15),
    },
}