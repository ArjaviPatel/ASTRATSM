"""notifications/utils.py"""
import logging

from accounts.email_utils import NotificationEmailError, build_no_reply_email, send_notification_email
from accounts.models import User
from accounts.permissions import ADMIN_ROLES

logger = logging.getLogger('nexus')


def _should_notify(user, notif_type: str) -> bool:
    if user.role in (*ADMIN_ROLES, User.Role.MANAGER):
        return True
    if user.role == User.Role.RESOURCE:
        from .models import ALL_NOTIF_TYPES, ResourceNotificationPreference
        allowed = ResourceNotificationPreference.get_allowed(user)
        return notif_type in allowed
    return False


def _bulk_notify(users, notif_type, title, message, project=None, action_url='') -> int:
    from .models import Notification

    to_create = [
        Notification(
            user=u,
            notif_type=notif_type,
            title=title,
            message=message,
            project=project,
            action_url=action_url,
        )
        for u in users
        if u and u.is_active and _should_notify(u, notif_type)
    ]
    if to_create:
        Notification.objects.bulk_create(to_create, ignore_conflicts=True)
    logger.debug('Created %d notifications [%s]: %s', len(to_create), notif_type, title)
    return len(to_create)


def _dedupe_active_emails(users, exclude=None):
    seen = set()
    emails = []
    for user in users:
        if not user or not user.is_active or user == exclude:
            continue
        email = (user.email or '').strip().lower()
        if not email or email in seen:
            continue
        seen.add(email)
        emails.append(email)
    return emails


def notify_project_team(users, notif_type, title, message, project=None, action_url='', exclude=None):
    filtered = [u for u in users if u != exclude]
    return _bulk_notify(filtered, notif_type, title, message, project, action_url)


def notify_user(user, notif_type, title, message, project=None, action_url=''):
    return _bulk_notify([user], notif_type, title, message, project, action_url)


def notify_admins_and_managers(notif_type, title, message, project=None, action_url='', exclude=None):
    recipients = list(User.objects.filter(
        role__in=[*ADMIN_ROLES, User.Role.MANAGER],
        is_active=True,
    ))
    if exclude:
        recipients = [u for u in recipients if u != exclude]
    return _bulk_notify(recipients, notif_type, title, message, project, action_url)


def email_users(users, subject, plain_body, html_body=None, exclude=None):
    emails = _dedupe_active_emails(users, exclude=exclude)
    if not emails:
        return 0
    try:
        send_notification_email(emails, subject, plain_body, html_body)
        return len(emails)
    except NotificationEmailError:
        logger.warning('Notification email failed for subject=%s recipients=%s', subject, emails)
        return 0


def email_no_reply(users, subject, heading, intro, details=None, footer_note=None, exclude=None):
    plain_body, html_body = build_no_reply_email(
        subject=subject,
        heading=heading,
        intro=intro,
        details=details or [],
        footer_note=footer_note,
    )
    return email_users(users, subject, plain_body, html_body, exclude=exclude)
