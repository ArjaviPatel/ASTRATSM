"""notifications/models.py"""
from django.db import models
from accounts.models import User


class Notification(models.Model):
    class Type(models.TextChoices):
        PROJECT_ASSIGNED  = 'project_assigned',  'Project Assigned'
        STATUS_CHANGE     = 'status_change',      'Status Change'
        DEADLINE          = 'deadline',            'Deadline'
        TIMELINE_COMPLETE = 'timeline_complete',   'Timeline Complete'
        MESSAGE           = 'message',             'New Message'
        UPDATE            = 'update',              'Project Update'
        MENTION           = 'mention',             'Mention'

    user       = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications', db_index=True)
    notif_type = models.CharField(max_length=30, choices=Type.choices)
    title      = models.CharField(max_length=200)
    message    = models.TextField()
    is_read    = models.BooleanField(default=False, db_index=True)
    project    = models.ForeignKey(
        'projects.Project', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='notifications'
    )
    action_url = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes  = [models.Index(fields=['user', 'is_read'])]

    def __str__(self):
        return f'[{self.notif_type}] {self.user} — {self.title}'


# All notification types a resource CAN receive
ALL_NOTIF_TYPES = [
    Notification.Type.PROJECT_ASSIGNED,
    Notification.Type.STATUS_CHANGE,
    Notification.Type.DEADLINE,
    Notification.Type.TIMELINE_COMPLETE,
    Notification.Type.MESSAGE,
    Notification.Type.UPDATE,
    Notification.Type.MENTION,
]


class ResourceNotificationPreference(models.Model):
    """
    Admin/Manager controls which notification types a resource receives.
    If no record exists for a resource, they get ALL types by default.
    """
    resource   = models.OneToOneField(
        User, on_delete=models.CASCADE,
        related_name='notification_prefs',
        limit_choices_to={'role': 'resource'},
    )
    # JSON list of allowed notif_type strings e.g. ["project_assigned","update"]
    allowed_types = models.JSONField(default=list)
    updated_by    = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True,
        related_name='+',
        limit_choices_to={'role__in': ['admin', 'leadership', 'manager']},
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Resource Notification Preference'

    def __str__(self):
        return f'NotifPrefs[{self.resource.name}]'

    @classmethod
    def get_allowed(cls, user) -> list:
        """Return allowed notif types for a resource. Defaults to ALL if no record."""
        try:
            return cls.objects.get(resource=user).allowed_types or ALL_NOTIF_TYPES
        except cls.DoesNotExist:
            return ALL_NOTIF_TYPES