"""
backend/accounts/tasks.py

Celery tasks for account housekeeping. Wired into Celery Beat in
nexus/celery.py so they run automatically alongside the worker.
"""
import logging

from celery import shared_task

logger = logging.getLogger('nexus')


@shared_task(name='accounts.tasks.purge_stale_otp_challenges')
def purge_stale_otp_challenges(older_than_hours: int = 24) -> int:
    """Remove consumed / long-expired login OTP challenges from the DB."""
    from accounts.models import LoginOTPChallenge

    removed = LoginOTPChallenge.purge_stale(older_than_hours=older_than_hours)
    logger.info('[otp-cleanup] purged %d stale OTP challenge(s)', removed)
    return removed
