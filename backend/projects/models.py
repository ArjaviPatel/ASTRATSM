"""projects/models.py"""
import os
import logging
from django.db import models
from django.core.validators import MinValueValidator, MaxValueValidator
from django.conf import settings
from accounts.models import User
from clients.models import Client

logger = logging.getLogger('nexus')


def project_doc_path(instance, filename):
    return f'projects/{instance.project.id}/docs/{filename}'


class Project(models.Model):
    class Status(models.TextChoices):
        PLANNING    = 'planning',    'Planning'
        IN_PROGRESS = 'in_progress', 'In Progress'
        REVIEW      = 'review',      'Review'
        COMPLETED   = 'completed',   'Completed'
        ON_HOLD     = 'on_hold',     'On Hold'

    class Priority(models.TextChoices):
        LOW      = 'low',      'Low'
        MEDIUM   = 'medium',   'Medium'
        HIGH     = 'high',     'High'
        CRITICAL = 'critical', 'Critical'

    name        = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    client      = models.ForeignKey(Client, on_delete=models.SET_NULL, null=True, blank=True, related_name='projects')
    manager     = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True,
        related_name='managed_projects',
        limit_choices_to={'role__in': ['admin', 'leadership', 'manager']},
    )
    resources   = models.ManyToManyField(
        User, related_name='assigned_projects', blank=True,
        limit_choices_to={'role': 'resource'},
    )
    start_date  = models.DateField(null=True, blank=True)
    end_date    = models.DateField(null=True, blank=True)
    budget      = models.DecimalField(max_digits=14, decimal_places=2, default=0, validators=[MinValueValidator(0)])
    spent       = models.DecimalField(max_digits=14, decimal_places=2, default=0, validators=[MinValueValidator(0)])
    resource_l1 = models.PositiveIntegerField(default=0)
    resource_l2 = models.PositiveIntegerField(default=0)
    resource_l3 = models.PositiveIntegerField(default=0)
    resource_l4 = models.PositiveIntegerField(default=0)
    hours       = models.DecimalField(max_digits=10, decimal_places=2, default=0, validators=[MinValueValidator(0)])
    activity    = models.CharField(max_length=300, blank=True)
    status      = models.CharField(max_length=20, choices=Status.choices, default=Status.PLANNING, db_index=True)
    priority    = models.CharField(max_length=12, choices=Priority.choices, default=Priority.MEDIUM, db_index=True)
    progress    = models.PositiveSmallIntegerField(
        default=0,
        validators=[MinValueValidator(0), MaxValueValidator(100)]
    )
    tags        = models.JSONField(default=list, blank=True)
    created_by  = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_projects')
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes  = [
            models.Index(fields=['status', 'priority']),
            models.Index(fields=['client', 'status']),
        ]

    def __str__(self):
        return self.name

    def clean(self):
        from django.core.exceptions import ValidationError
        if self.start_date and self.end_date and self.start_date > self.end_date:
            raise ValidationError({'end_date': 'End date must be after start date.'})
        if self.spent > self.budget and self.budget > 0:
            logger.warning('Project "%s" is over budget: spent=%s budget=%s', self.name, self.spent, self.budget)

    @property
    def budget_utilization(self) -> float:
        return round((float(self.spent) / float(self.budget)) * 100, 1) if self.budget > 0 else 0.0

    @property
    def is_over_budget(self) -> bool:
        return self.spent > self.budget


class ProjectUpdate(models.Model):
    project    = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='updates')
    author     = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='project_updates')
    content    = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Update on {self.project.name} by {self.author}'


class ProjectDocument(models.Model):
    project     = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='documents')
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    name        = models.CharField(max_length=200)
    file        = models.FileField(upload_to=project_doc_path)
    file_size   = models.PositiveBigIntegerField(default=0)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if self.file:
            self.file_size = self.file.size
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name

class ProjectApprovalRequest(models.Model):
    class RequestType(models.TextChoices):
        EDIT   = 'edit',   'Edit'
        DELETE = 'delete', 'Delete'
        CREATE = 'create', 'Create'

    class Status(models.TextChoices):
        PENDING  = 'pending',  'Pending'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'

    project          = models.ForeignKey(Project, on_delete=models.SET_NULL, null=True, blank=True, related_name='approval_requests')
    requested_by     = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='sent_approvals')
    resolved_by      = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='resolved_approvals')
    request_type     = models.CharField(max_length=10, choices=RequestType.choices)
    status           = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    reason           = models.TextField(blank=True)
    proposed_changes = models.JSONField(default=dict, blank=True)
    admin_note       = models.TextField(blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)
    resolved_at      = models.DateTimeField(null=True, blank=True)
    last_seen_approvals = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.request_type.upper()} request by {self.requested_by} on {self.project}'