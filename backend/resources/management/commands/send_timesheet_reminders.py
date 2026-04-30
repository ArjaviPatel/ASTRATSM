from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from accounts.models import User
from notifications.utils import email_no_reply, notify_user
from projects.models import Project
from resources.models import ResourceProfile, TimeEntry, TimesheetReminderLog


class Command(BaseCommand):
    help = 'Send weekday 5 PM timesheet reminder emails to assigned resources missing today work log.'

    def handle(self, *args, **options):
        today = timezone.localdate()
        if today.weekday() >= 5:
            self.stdout.write(self.style.WARNING('Weekend detected. Skipping reminders.'))
            return

        assigned_resource_ids = (
            Project.objects
            .filter(status__in=['planning', 'in_progress', 'review', 'on_hold'])
            .values_list('resources__id', flat=True)
        )
        assigned_resources = ResourceProfile.objects.select_related('user').filter(
            user__id__in=assigned_resource_ids,
            user__is_active=True,
            user__role=User.Role.RESOURCE,
        ).distinct()

        sent_count = 0
        for profile in assigned_resources:
            already_logged = TimeEntry.objects.filter(resource=profile, date=today).exists()
            if already_logged:
                continue
            reminder_exists = TimesheetReminderLog.objects.filter(resource=profile, date=today).exists()
            if reminder_exists:
                continue

            projects = profile.user.assigned_projects.filter(
                status__in=['planning', 'in_progress', 'review', 'on_hold']
            ).values_list('name', flat=True)
            project_list = ', '.join(projects) or 'Assigned projects'

            email_no_reply(
                [profile.user],
                subject='Daily timesheet reminder',
                heading='Please fill your timesheet today.',
                intro='You have not submitted today work log yet. Submit it before day-end to avoid late-entry approval requirement.',
                details=[
                    ('Date', today.isoformat()),
                    ('Projects', project_list),
                    ('Policy', 'Missing weekday entries require admin approval before later submission.'),
                ],
                footer_note='This is an automated no-reply notification from AstraTSM.',
            )
            notify_user(
                user=profile.user,
                notif_type='update',
                title='Timesheet reminder',
                message=f'Please submit today timesheet ({today.isoformat()}) before end of day.',
                action_url='/timelines',
            )
            TimesheetReminderLog.objects.create(resource=profile, date=today)
            sent_count += 1

        self.stdout.write(self.style.SUCCESS(f'Sent {sent_count} timesheet reminder(s).'))
