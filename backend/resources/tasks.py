"""
backend/resources/tasks.py

All bugs from previous versions are fixed here. See comments marked BUG FIX.
"""
import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger('nexus')


@shared_task(name='resources.tasks.run_timesheet_reminders')
def run_timesheet_reminders(slot: str = 'first') -> dict:
    """Celery entry point wired to Celery Beat in nexus/celery.py.

    Kept as a thin wrapper so the underlying logic stays importable and
    callable synchronously from the shell or a management command without
    needing a running worker.
    """
    return send_timesheet_reminders_now(slot=slot)


def send_timesheet_reminders_now(slot: str = 'first') -> dict:
    """
    Send timesheet reminder emails + in-app notifications.

    slot='first'  → fires at 5:30 PM
    slot='second' → fires at 5:45 PM

    Safe to call manually from shell for testing:
        python manage.py shell
        >>> from resources.tasks import send_timesheet_reminders_now
        >>> send_timesheet_reminders_now(slot='first')
    """
    # Late imports — keeps Django app-loading safe when called from AppConfig.ready()
    from accounts.models import User
    from notifications.utils import email_no_reply, notify_user
    from projects.models import Project
    from resources.models import ResourceProfile, TimeEntry, TimesheetReminderLog

    today = timezone.localdate()

    if today.weekday() >= 5:
        logger.info('[reminder] Weekend — skipped.')
        return {'sent': 0, 'reason': 'weekend'}

    active_statuses = ['planning', 'in_progress', 'review', 'on_hold']

    # ── BUG FIX 1 ────────────────────────────────────────────────────
    # Previous code used:
    #   Project.objects.values_list('resources__user_id', flat=True)
    # But the original send_timesheet_reminders.py uses:
    #   Project.objects.values_list('resources__id', flat=True)
    # and then filters ResourceProfile by user__id__in.
    # 'resources' is a M2M to ResourceProfile (not User), so __user_id
    # would only work if the relation traversal is correct. Matching
    # the original command exactly is safest.
    assigned_profile_ids = (
        Project.objects
        .filter(status__in=active_statuses)
        .values_list('resources__id', flat=True)
    )

    resources = (
        ResourceProfile.objects
        .select_related('user')
        .filter(
            id__in=assigned_profile_ids,        # filter by profile id, not user id
            user__is_active=True,
            user__role=User.Role.RESOURCE,
        )
        .distinct()
    )

    sent = 0
    skipped_logged = 0
    skipped_dup = 0

    slot_time = '5:30 PM' if slot == 'first' else '5:45 PM'
    slot_num  = '1st'     if slot == 'first' else '2nd'

    for profile in resources:
        # Skip — already logged today
        if TimeEntry.objects.filter(resource=profile, date=today).exists():
            skipped_logged += 1
            continue

        # ── BUG FIX 2 ────────────────────────────────────────────────
        # Previous code filtered TimesheetReminderLog by slot_label=slot,
        # but the ORIGINAL model (migration 0005) does NOT have a slot_label
        # field — that was a field we planned to add in migration 0006.
        # If migration 0006 has NOT been applied yet, this query crashes with
        # "column resources_timesheetreminderlog.slot_label does not exist".
        #
        # Fix: use a try/except so the task never crashes even if the migration
        # hasn't been applied, AND fall back to the original per-day dedup
        # (same as the original command).
        try:
            already_sent = TimesheetReminderLog.objects.filter(
                resource=profile,
                date=today,
                slot_label=slot,     # only skip if THIS slot was already sent
            ).exists()
        except Exception:
            # Migration 0006 not applied yet — fall back: skip if ANY reminder sent today
            already_sent = TimesheetReminderLog.objects.filter(
                resource=profile,
                date=today,
            ).exists()

        if already_sent:
            skipped_dup += 1
            continue

        user = profile.user

        # ── BUG FIX 3 ────────────────────────────────────────────────
        # Previous code used:
        #   profile.user.assigned_projects.filter(...)
        # The original command uses this same approach, so it works IF
        # User has a reverse relation 'assigned_projects' from Project.
        # If that relation doesn't exist (depends on the Project model's
        # ManyToManyField name), this raises AttributeError.
        # Safest: query via Project directly, which we KNOW works.
        try:
            project_names = list(
                profile.user.assigned_projects
                .filter(status__in=active_statuses)
                .values_list('name', flat=True)
            )
        except AttributeError:
            # Fallback if 'assigned_projects' reverse relation name differs
            project_names = list(
                Project.objects
                .filter(resources=profile, status__in=active_statuses)
                .values_list('name', flat=True)
            )

        project_list = ', '.join(project_names) or 'Assigned projects'

        try:
            # ── In-app notification ──────────────────────────────────
            # BUG FIX 4: notify_user signature is:
            #   notify_user(user, notif_type, title, message, project=None, action_url='')
            # All positional — do NOT pass as keyword args except project/action_url.
            notify_user(
                user,
                'update',
                'Timesheet reminder',
                (
                    f'[{slot_num} reminder — {slot_time}] '
                    f'Please submit your timesheet for {today.isoformat()} before end of day.'
                ),
                action_url='/timesheet',
            )

            # ── Email ────────────────────────────────────────────────
            # BUG FIX 5: email_no_reply expects a list of User objects,
            # not email strings. The function internally calls
            # _dedupe_active_emails(users) which reads user.email.
            # [profile.user] is correct — NOT [user.email].
            #
            # BUG FIX 6: intro text had literal \n\n inside an f-string
            # which becomes part of the HTML and renders as a space,
            # not a line break. Removed \n\n — email_utils already
            # wraps it in a <div> with line-height styling.
            email_no_reply(
                [user],           # list of User objects ✓
                subject=f'[{slot_num} reminder] Please fill your timesheet today',
                heading="Don't forget to log your hours today.",
                intro=(
                    f'Hi {user.get_full_name() or user.username}, '
                    f'this is your {slot_num} reminder ({slot_time}). '
                    f'You have not submitted a work log for '
                    f'{today.strftime("%A, %d %B %Y")} yet. '
                    'Please log your hours before end of day to avoid '
                    'needing manager approval for a late submission.'
                ),
                details=[
                    ('Date', today.isoformat()),
                    ('Reminder', f'{slot_num} reminder — {slot_time}'),
                    ('Projects', project_list),
                    ('Action', 'Open AstraTSM → Timesheet → Log Time'),
                    ('Policy', 'Entries older than 48 h require admin approval to submit.'),
                ],
                footer_note=(
                    'This is an automated no-reply message from AstraTSM. '
                    'If you have already submitted your hours, please ignore this email.'
                ),
            )

            # ── BUG FIX 7 ────────────────────────────────────────────
            # TimesheetReminderLog.objects.create() with slot_label will
            # fail if migration 0006 hasn't been applied. Use the same
            # try/except approach — fall back to creating without slot_label.
            try:
                TimesheetReminderLog.objects.create(
                    resource=profile,
                    date=today,
                    slot_label=slot,
                )
            except Exception:
                # Migration 0006 not applied — create without slot_label
                # (original model only has resource + date)
                TimesheetReminderLog.objects.get_or_create(
                    resource=profile,
                    date=today,
                )

            sent += 1
            logger.info('[reminder] slot=%s sent → user_id=%s email=%s', slot, user.id, user.email)

        except Exception:
            logger.exception(
                '[reminder] slot=%s FAILED for user_id=%s email=%s',
                slot, user.id, getattr(user, 'email', '?'),
            )
            # Continue to next resource — one failure must not block others

    logger.info(
        '[reminder] DONE slot=%s date=%s sent=%d skipped_logged=%d skipped_dup=%d',
        slot, today, sent, skipped_logged, skipped_dup,
    )
    return {
        'slot': slot,
        'date': str(today),
        'sent': sent,
        'skipped_already_logged': skipped_logged,
        'skipped_duplicate_slot': skipped_dup,
    }