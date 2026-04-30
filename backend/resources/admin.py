from django.contrib import admin
from .models import ResourceProfile, TimeEntry, TimesheetLateEntryApproval, TimesheetReminderLog


@admin.register(ResourceProfile)
class ResourceProfileAdmin(admin.ModelAdmin):
    list_display = ['resource_id', 'user', 'manager', 'level', 'hourly_rate', 'availability', 'total_hours_logged']
    list_filter = ['level', 'manager']
    search_fields = ['resource_id', 'user__name', 'user__email', 'manager__name']
    readonly_fields = ['created_at', 'updated_at', 'total_hours_logged']


@admin.register(TimeEntry)
class TimeEntryAdmin(admin.ModelAdmin):
    list_display = ['resource', 'project', 'date', 'hours', 'approved', 'approved_by']
    list_filter = ['approved', 'date']
    readonly_fields = ['approved_at', 'created_at']


@admin.register(TimesheetLateEntryApproval)
class TimesheetLateEntryApprovalAdmin(admin.ModelAdmin):
    list_display = ['resource', 'date', 'status', 'requested_by', 'resolved_by', 'created_at']
    list_filter = ['status', 'date']
    search_fields = ['resource__user__name', 'resource__user__email', 'reason']
    readonly_fields = ['created_at', 'resolved_at']


@admin.register(TimesheetReminderLog)
class TimesheetReminderLogAdmin(admin.ModelAdmin):
    list_display = ['resource', 'date', 'sent_at']
    list_filter = ['date']
    search_fields = ['resource__user__name', 'resource__user__email']
    readonly_fields = ['sent_at']
