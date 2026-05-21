import logging
from datetime import date as _date
from decimal import Decimal

from django.conf import settings
from django.db.models import Case, Count, DecimalField, F, Q, Sum, Value, When
from django.db.models.functions import Coalesce, Greatest
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.models import User
from accounts.permissions import IsAdmin, IsAdminOrManager
from nexus.excel import workbook_response
from notifications.utils import email_no_reply, notify_project_team, notify_user
from projects.models import Project
from timelines.models import Timeline
from .models import ResourceProfile, TimeEntry, TimesheetLateEntryApproval
from .serializers import ResourceProfileSerializer, TimeEntrySerializer, TimesheetLateEntryApprovalSerializer

logger = logging.getLogger('nexus')

ACTIVE_PROJECT_STATUSES = ['planning', 'in_progress', 'review', 'on_hold']
HOURS_OUTPUT = DecimalField(max_digits=10, decimal_places=2)


def _app_url(path):
    return f"{settings.FRONTEND_URL.rstrip('/')}/{path.lstrip('/')}"


def _sync_timeline_hours(timeline_id):
    if not timeline_id:
        return
    timeline = Timeline.objects.filter(pk=timeline_id).first()
    if not timeline:
        return
    submitted = timeline.timeentries.aggregate(total=Coalesce(Sum('hours'), Value(0), output_field=HOURS_OUTPUT))['total'] or Decimal('0')
    Timeline.objects.filter(pk=timeline_id).update(hours_consumed=float(submitted))


def _timesheet_approvers(entry):
    recipients = []
    if entry.resource.manager and entry.resource.manager.is_active and entry.resource.manager.role in (User.Role.MANAGER, User.Role.ADMIN):
        recipients.append(entry.resource.manager)
    project_manager = getattr(entry.project, 'manager', None)
    if project_manager and project_manager.is_active and project_manager.role in (User.Role.MANAGER, User.Role.ADMIN):
        recipients.append(project_manager)
    if not recipients:
        recipients.extend(User.objects.filter(role=User.Role.ADMIN, is_active=True))
    deduped = []
    seen = set()
    for user in recipients:
        if user.id in seen:
            continue
        seen.add(user.id)
        deduped.append(user)
    return deduped


def _timesheet_stakeholders(entry):
    recipients = [entry.resource.user, *_timesheet_approvers(entry)]
    deduped = []
    seen = set()
    for user in recipients:
        if not user or not user.is_active or user.id in seen:
            continue
        seen.add(user.id)
        deduped.append(user)
    return deduped


def _send_timesheet_submission_email(entry):
    recipients = _timesheet_approvers(entry)
    if not recipients:
        return
    scope = entry.timeline.name if entry.timeline else entry.project.name
    subject = f'Work log submitted: {entry.resource.user.name} on {entry.project.name}'
    email_no_reply(
        recipients,
        subject=subject,
        heading='A new work log has been submitted.',
        intro='AstraTSM recorded a new project work entry and updated the delivery hours for review.',
        details=[
            ('Resource', entry.resource.user.name),
            ('Project', entry.project.name),
            ('Client', entry.project.client.name if entry.project.client else 'Not assigned'),
            ('Phase', scope),
            ('Date', entry.date.isoformat()),
            ('Time', f"{entry.start_time.strftime('%H:%M')} - {entry.end_time.strftime('%H:%M')}" if entry.start_time and entry.end_time else 'Hours-only entry'),
            ('Hours logged', entry.hours),
            ('Approval status', 'Pending manager review'),
            ('Remaining phase hours', f"{max((entry.timeline.hours_allocated if entry.timeline else 0) - float(entry.timeline.hours_consumed if entry.timeline else 0), 0):.2f}h" if entry.timeline else 'See dashboard'),
            ('Review link', _app_url('/timesheet?tab=approvals')),
        ],
        footer_note='This is an automated no-reply notification from AstraTSM. The link opens inside the authenticated application session.',
    )



def _send_timesheet_approval_email(entry, approver):
    subject = f'Time entry approved: {entry.project.name}'
    email_no_reply(
        [entry.resource.user],
        subject=subject,
        heading='Your submitted work log was approved.',
        intro='The hours you submitted are now marked as approved in AstraTSM.',
        details=[
            ('Resource', entry.resource.user.name),
            ('Project', entry.project.name),
            ('Client', entry.project.client.name if entry.project.client else 'Not assigned'),
            ('Phase', entry.timeline.name if entry.timeline else 'Project-level log'),
            ('Date', entry.date.isoformat()),
            ('Time', f"{entry.start_time.strftime('%H:%M')} - {entry.end_time.strftime('%H:%M')}" if entry.start_time and entry.end_time else 'Hours-only entry'),
            ('Hours approved', entry.hours),
            ('Approved by', approver.name),
            ('Open timesheet', _app_url('/timesheet')),
        ],
        footer_note='This is an automated no-reply notification from AstraTSM.',
    )


def _send_late_entry_request_email(request_obj, recipients):
    if not recipients:
        return
    email_no_reply(
        recipients,
        subject=f'Late timesheet approval needed: {request_obj.resource.user.name}',
        heading='A late timesheet request needs review.',
        intro='A resource requested permission to submit a timesheet entry older than 48 hours.',
        details=[
            ('Resource', request_obj.resource.user.name),
            ('Date', request_obj.date.isoformat()),
            ('Reason', request_obj.reason or 'No reason provided'),
            ('Review link', _app_url('/timesheet?tab=approvals')),
        ],
        footer_note='This is an automated no-reply notification from AstraTSM. The link opens inside the authenticated application session.',
    )


def _send_late_entry_resolution_email(request_obj):
    email_no_reply(
        [request_obj.resource.user],
        subject=f'Late timesheet request {request_obj.status}: {request_obj.date}',
        heading=f'Your late timesheet request was {request_obj.status}.',
        intro='A manager reviewed your request to submit an older timesheet entry.',
        details=[
            ('Date', request_obj.date.isoformat()),
            ('Status', request_obj.status.title()),
            ('Reviewed by', request_obj.resolved_by.name if request_obj.resolved_by else 'AstraTSM'),
            ('Note', request_obj.admin_note or 'No note provided'),
            ('Open timesheet', _app_url('/timesheet')),
        ],
        footer_note='This is an automated no-reply notification from AstraTSM. The link opens inside the authenticated application session.',
    )


class ResourceProfileViewSet(viewsets.ModelViewSet):
    serializer_class = ResourceProfileSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['resource_id', 'user__name', 'user__email', 'manager__name']
    ordering_fields = ['user__name', 'hourly_rate', 'availability', 'created_at']

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy', 'export', 'timesheet_report'):
            return [IsAdmin()]
        return [IsAuthenticated()]

    def get_queryset(self):
        user = self.request.user
        qs = (
            ResourceProfile.objects
            .select_related('user', 'manager')
            .filter(user__role=User.Role.RESOURCE)
            .annotate(
                total_hours_value=Coalesce(Sum('timeentries__hours'), Value(0), output_field=HOURS_OUTPUT),
                approved_hours_value=Coalesce(Sum('timeentries__hours', filter=Q(timeentries__approved=True)), Value(0), output_field=HOURS_OUTPUT),
                pending_hours_value=Coalesce(Sum('timeentries__hours', filter=Q(timeentries__approved=False)), Value(0), output_field=HOURS_OUTPUT),
                active_project_count=Count(
                    'user__assigned_projects',
                    filter=Q(user__assigned_projects__status__in=ACTIVE_PROJECT_STATUSES),
                    distinct=True,
                ),
            )
        )
        qs = qs.order_by('user__name', 'id')
        if user.role == User.Role.ADMIN:
            return qs
        if user.role == User.Role.MANAGER:
            return qs.filter(Q(manager=user) | Q(user__assigned_projects__manager=user)).distinct()
        if user.role == User.Role.RESOURCE:
            return qs.filter(user=user)
        return qs.none()

    def perform_destroy(self, instance):
        user = instance.user
        logger.warning('Resource "%s" deleted by %s', user.email, self.request.user.email)
        user.delete()

    @action(detail=False, methods=['get'])
    def export(self, request):
        resources = self.filter_queryset(self.get_queryset()).order_by('user__name')
        rows = [
            [
                resource.resource_id or '',
                resource.user.name,
                resource.user.email,
                resource.level or '',
                resource.manager.name if resource.manager else '',
                resource.hourly_rate,
                resource.availability,
                resource.active_project_count or 0,
                resource.total_hours_value or 0,
                resource.approved_hours_value or 0,
                resource.pending_hours_value or 0,
                ', '.join(resource.skills or []),
            ]
            for resource in resources
        ]
        return workbook_response(
            filename='resources.xlsx',
            sheet_name='Resources',
            headers=['Resource ID', 'Name', 'Email', 'Level', 'Manager', 'Hourly Rate', 'Availability %', 'Active Projects', 'Logged Hours', 'Approved Hours', 'Pending Hours', 'Skills'],
            rows=rows,
        )

    @action(detail=True, methods=['get'])
    def time_entries(self, request, pk=None):
        profile = self.get_object()
        entries = profile.timeentries.select_related('project', 'timeline').order_by('-date')
        return Response(TimeEntrySerializer(entries, many=True).data)

    @action(detail=True, methods=['patch'], permission_classes=[IsAdminOrManager])
    def set_availability(self, request, pk=None):
        profile = self.get_object()
        try:
            value = int(request.data.get('availability', -1))
            assert 0 <= value <= 100
        except (TypeError, ValueError, AssertionError):
            return Response({'detail': 'availability must be an integer 0-100.'}, status=status.HTTP_400_BAD_REQUEST)
        old_value = profile.availability
        profile.availability = value
        profile.save(update_fields=['availability', 'updated_at'])
        if old_value != value:
            notify_user(
                user=profile.user,
                notif_type='update',
                title='Your availability has been updated',
                message=f'Your availability has been set to {value}% by {request.user.name}.',
                action_url='/profile',
            )
        return Response({'availability': profile.availability})

    @action(detail=True, methods=['get'], permission_classes=[IsAdmin])
    def timesheet_report(self, request, pk=None):
        profile = self.get_object()
        entries = (
            profile.timeentries
            .select_related('project', 'timeline', 'approved_by')
            .order_by('-date', '-created_at')
        )
        rows = [
            [
                entry.date.isoformat(),
                entry.project.name if entry.project else '',
                entry.timeline.name if entry.timeline else 'Project-level log',
                entry.start_time.strftime('%H:%M') if entry.start_time else '',
                entry.end_time.strftime('%H:%M') if entry.end_time else '',
                float(entry.hours),
                'Approved' if entry.approved else 'Pending',
                entry.approved_by.name if entry.approved_by else '',
                entry.approved_at.isoformat() if entry.approved_at else '',
                (entry.description or '').strip(),
            ]
            for entry in entries
        ]
        filename = f"timesheet_{profile.user.name.replace(' ', '_').lower()}_{timezone.localdate().isoformat()}.xlsx"
        return workbook_response(
            filename=filename,
            sheet_name='Timesheet',
            headers=['Date', 'Project', 'Phase', 'From', 'To', 'Hours', 'Approval Status', 'Approved By', 'Approved At', 'Description'],
            rows=rows,
        )

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def my_dashboard(self, request):
        """Lightweight resource self-dashboard: projects, clients, recent entries."""
        user = request.user
        try:
            profile = user.resource_profile
        except ResourceProfile.DoesNotExist:
            return Response({'projects': [], 'clients': [], 'entries': [], 'stats': {}})

        projects_qs = (
            Project.objects
            .select_related('client', 'manager')
            .filter(status__in=ACTIVE_PROJECT_STATUSES)
            .values('id', 'name', 'status', 'progress', 'start_date', 'end_date',
                    'client__id', 'client__name', 'manager__name', 'hours')
            .annotate(
                submitted_hours=Coalesce(Sum('timeentries__hours'), Value(0), output_field=HOURS_OUTPUT),
                remaining_hours=Greatest(F('hours') - Coalesce(Sum('timeentries__hours'), Value(0), output_field=HOURS_OUTPUT), Value(0), output_field=HOURS_OUTPUT),
            )
            .order_by('name')[:200]
        )
        projects = list(projects_qs)
        clients = (
            Project.objects
            .filter(status__in=ACTIVE_PROJECT_STATUSES, client__isnull=False)
            .select_related('client')
            .values('client__id', 'client__name', 'client__industry')
            .distinct()[:200]
        )
        entries = (
            profile.timeentries
            .select_related('project', 'project__client')
            .order_by('-date', '-created_at')
            .values('id', 'date', 'start_time', 'end_time', 'hours', 'description', 'approved', 'project__name', 'project__id', 'project__client__name')[:60]
        )
        total_hours = profile.timeentries.aggregate(t=Coalesce(Sum('hours'), Value(0), output_field=HOURS_OUTPUT))['t'] or 0
        approved_hours = profile.timeentries.filter(approved=True).aggregate(t=Coalesce(Sum('hours'), Value(0), output_field=HOURS_OUTPUT))['t'] or 0

        return Response({
            'projects': projects,
            'clients': list(clients),
            'entries': list(entries),
            'stats': {
                'total_hours': float(total_hours),
                'approved_hours': float(approved_hours),
                'pending_hours': float(total_hours) - float(approved_hours),
                'active_project_count': len(projects),
            },
        })

    @action(detail=False, methods=['get'], permission_classes=[IsAdminOrManager])
    def daily_report(self, request):
        """
        Manager/Admin daily dashboard report for a specific date.
        Returns: submitted resources, not-submitted resources, project hours summary.
        """
        from datetime import date as date_cls
        date_str = request.query_params.get('date', str(timezone.localdate()))
        try:
            report_date = date_cls.fromisoformat(date_str)
        except ValueError:
            return Response({'detail': 'Invalid date format. Use YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        # Determine which resources this user can see
        if user.role == User.Role.ADMIN:
            all_resources = ResourceProfile.objects.select_related('user', 'manager').filter(user__role=User.Role.RESOURCE)
        else:
            all_resources = ResourceProfile.objects.select_related('user', 'manager').filter(
                Q(manager=user) | Q(user__assigned_projects__manager=user)
            ).distinct()

        # Time entries submitted on this date
        entries_on_date = TimeEntry.objects.filter(date=report_date).select_related('resource__user', 'project', 'timeline')
        if user.role != User.Role.ADMIN:
            entries_on_date = entries_on_date.filter(
                Q(resource__manager=user) | Q(project__manager=user)
            ).distinct()

        submitted_resource_ids = set(entries_on_date.values_list('resource_id', flat=True).distinct())
        submitted_resources = [
            {
                'id': r.id,
                'name': r.user.name,
                'email': r.user.email,
                'resource_id': r.resource_id,
                'manager': r.manager.name if r.manager else None,
                'hours_submitted': float(sum(e.hours for e in entries_on_date if e.resource_id == r.id)),
            }
            for r in all_resources if r.id in submitted_resource_ids
        ]
        not_submitted_resources = [
            {
                'id': r.id,
                'name': r.user.name,
                'email': r.user.email,
                'resource_id': r.resource_id,
                'manager': r.manager.name if r.manager else None,
            }
            for r in all_resources if r.id not in submitted_resource_ids
        ]

        # Project hours summary: allocated, consumed (all-time approved), remaining
        if user.role == User.Role.ADMIN:
            projects_qs = Project.objects.all()
        else:
            projects_qs = Project.objects.filter(Q(manager=user) | Q(assigned_resources__manager=user)).distinct()

        DECIMAL_FIELD = DecimalField(max_digits=12, decimal_places=2)

        project_hours = []
        for p in projects_qs.annotate(
            consumed=Coalesce(Sum('timeentries__hours', filter=Q(timeentries__approved=True)), Value(0), output_field=DECIMAL_FIELD),
            pending=Coalesce(Sum('timeentries__hours', filter=Q(timeentries__approved=False)), Value(0), output_field=DECIMAL_FIELD),
        ).order_by('name')[:200]:
            allocated = float(p.hours or 0)
            consumed = float(p.consumed or 0)
            pending = float(p.pending or 0)
            project_hours.append({
                'id': p.id,
                'name': p.name,
                'status': p.status,
                'hours_allocated': allocated,
                'hours_consumed': consumed,
                'hours_pending': pending,
                'hours_remaining': max(allocated - consumed - pending, 0),
            })

        return Response({
            'date': str(report_date),
            'submitted': submitted_resources,
            'not_submitted': not_submitted_resources,
            'project_hours': project_hours,
        })


class TimeEntryViewSet(viewsets.ModelViewSet):
    queryset = TimeEntry.objects.select_related('resource__user', 'resource__manager', 'project__manager', 'project__client', 'timeline', 'approved_by')
    serializer_class = TimeEntrySerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['resource', 'project', 'timeline', 'date', 'approved']
    ordering_fields = ['date', 'hours']

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user.role == User.Role.ADMIN:
            pass  # full access
        elif user.role == User.Role.MANAGER:
            qs = qs.filter(Q(resource__manager=user) | Q(project__manager=user)).distinct()
        else:
            try:
                qs = qs.filter(resource=user.resource_profile)
            except ResourceProfile.DoesNotExist as exc:
                raise PermissionDenied('Your account does not have a resource profile.') from exc
        # Date range support: ?date_after=YYYY-MM-DD&date_before=YYYY-MM-DD
        date_after = self.request.query_params.get('date_after')
        date_before = self.request.query_params.get('date_before')
        if date_after:
            qs = qs.filter(date__gte=date_after)
        if date_before:
            qs = qs.filter(date__lte=date_before)
        return qs

    def perform_create(self, serializer):
        user = self.request.user
        if user.role == User.Role.RESOURCE:
            try:
                entry = serializer.save(resource=user.resource_profile)
            except ResourceProfile.DoesNotExist as exc:
                raise PermissionDenied('Your account does not have a resource profile.') from exc
        else:
            entry = serializer.save()
        _sync_timeline_hours(entry.timeline_id)
        approvers = _timesheet_approvers(entry)
        for approver in approvers:
            notify_user(
                user=approver,
                notif_type='update',
                title=f'Time entry submitted by {entry.resource.user.name}',
                message=f'{entry.resource.user.name} logged {entry.hours}h on "{entry.project.name}"' + (f' for phase "{entry.timeline.name}"' if entry.timeline else '') + f' on {entry.date}.',
                project=entry.project,
                action_url='/resources',
            )
        notify_user(
            user=entry.resource.user,
            notif_type='update',
            title='Work log submitted',
            message=f'Your {entry.hours}h entry for "{entry.project.name}" has been recorded and sent for review.',
            project=entry.project,
            action_url='/timesheet',
        )
        entry.timeline = TimeEntry.objects.select_related('timeline').get(pk=entry.pk).timeline
        _send_timesheet_submission_email(entry)

    def perform_update(self, serializer):
        previous = self.get_object()
        old_timeline_id = previous.timeline_id
        entry = serializer.save()
        _sync_timeline_hours(old_timeline_id)
        _sync_timeline_hours(entry.timeline_id)

    def perform_destroy(self, instance):
        timeline_id = instance.timeline_id
        instance.delete()
        _sync_timeline_hours(timeline_id)

    @action(detail=False, methods=['get'], permission_classes=[IsAdminOrManager])
    def export(self, request):
        """Export time entries to Excel. Supports same filters as list."""
        qs = self.filter_queryset(self.get_queryset()).order_by('-date', 'resource__user__name')
        headers = ['Date', 'Resource', 'Resource ID', 'Project', 'Client', 'Timeline', 'Hours', 'Start', 'End', 'Description', 'Approved', 'Approved By', 'Approved At']
        rows = []
        for e in qs:
            rows.append([
                str(e.date),
                e.resource.user.name if e.resource else '',
                e.resource.resource_id or '' if e.resource else '',
                e.project.name if e.project else '',
                e.project.client.name if e.project and e.project.client else '',
                e.timeline.name if e.timeline else '',
                float(e.hours),
                str(e.start_time) if e.start_time else '',
                str(e.end_time) if e.end_time else '',
                e.description or '',
                'Yes' if e.approved else 'No',
                e.approved_by.name if e.approved_by else '',
                e.approved_at.isoformat() if e.approved_at else '',
            ])
        return workbook_response('timesheets_export.xlsx', 'Timesheets', headers, rows)

    @action(detail=True, methods=['patch'], permission_classes=[IsAuthenticated])
    def approve(self, request, pk=None):
        entry = self.get_object()
        if request.user.role not in (User.Role.MANAGER, User.Role.ADMIN):
            return Response({'detail': 'Only managers or admins can approve time entries.'}, status=status.HTTP_403_FORBIDDEN)
        if request.user.role == User.Role.MANAGER:
            can_approve = entry.resource.manager_id == request.user.id or entry.project.manager_id == request.user.id
            if not can_approve:
                return Response({'detail': 'You can only approve entries for resources or projects assigned to you.'}, status=status.HTTP_403_FORBIDDEN)
        if entry.approved:
            return Response({'detail': 'Already approved.'}, status=status.HTTP_400_BAD_REQUEST)
        entry.approved = True
        entry.approved_by = request.user
        entry.approved_at = timezone.now()
        entry.save(update_fields=['approved', 'approved_by', 'approved_at'])
        _sync_timeline_hours(entry.timeline_id)
        notify_user(
            user=entry.resource.user,
            notif_type='update',
            title='Time entry approved',
            message=f'Your {entry.hours}h on "{entry.project.name}" ({entry.date}) was approved by {request.user.name}.',
            project=entry.project,
            action_url='/resources',
        )
        _send_timesheet_approval_email(entry, request.user)
        return Response({'approved': True, 'approved_by': request.user.name})

    @action(detail=True, methods=['patch'], permission_classes=[IsAuthenticated])
    def reject(self, request, pk=None):
        entry = self.get_object()
        if request.user.role not in (User.Role.MANAGER, User.Role.ADMIN):
            return Response({'detail': 'Only managers or admins can reject time entries.'}, status=status.HTTP_403_FORBIDDEN)
        if request.user.role == User.Role.MANAGER:
            can_reject = entry.resource.manager_id == request.user.id or entry.project.manager_id == request.user.id
            if not can_reject:
                return Response({'detail': 'You can only reject entries for resources or projects assigned to you.'}, status=status.HTTP_403_FORBIDDEN)
        if entry.approved:
            return Response({'detail': 'Cannot reject an already approved entry.'}, status=status.HTTP_400_BAD_REQUEST)
        admin_note = request.data.get('admin_note', '')
        # Save info before delete for notification
        resource_user = entry.resource.user
        project = entry.project
        hours = entry.hours
        date = entry.date
        _sync_timeline_hours(entry.timeline_id)
        entry.delete()
        notify_user(
            user=resource_user,
            notif_type='alert',
            title='Time entry rejected',
            message=f'Your {hours}h on "{project.name}" ({date}) was rejected by {request.user.name}.' + (f' Note: {admin_note}' if admin_note else ''),
            project=project,
            action_url='/timesheet',
        )
        return Response({'detail': 'Time entry rejected and removed.'})


class TimesheetLateEntryApprovalViewSet(viewsets.ModelViewSet):
    serializer_class = TimesheetLateEntryApprovalSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['resource', 'status', 'date']
    ordering_fields = ['date', 'created_at', 'resolved_at']

    def get_queryset(self):
        user = self.request.user
        qs = TimesheetLateEntryApproval.objects.select_related('resource__user', 'requested_by', 'resolved_by')
        if user.role == User.Role.ADMIN:
            return qs
        if user.role == User.Role.MANAGER:
            return qs.filter(Q(resource__manager=user) | Q(resource__user__assigned_projects__manager=user)).distinct()
        try:
            return qs.filter(resource=user.resource_profile)
        except ResourceProfile.DoesNotExist as exc:
            raise PermissionDenied('Your account does not have a resource profile.') from exc

    def perform_create(self, serializer):
        user = self.request.user
        if user.role != User.Role.RESOURCE:
            raise PermissionDenied('Only resources can request late timesheet approvals.')
        if not hasattr(user, 'resource_profile'):
            raise PermissionDenied('Your account does not have a resource profile.')
        request_obj = serializer.save(resource=user.resource_profile, requested_by=user)
        managers = []
        if request_obj.resource.manager and request_obj.resource.manager.is_active:
            managers.append(request_obj.resource.manager)
        managers.extend(User.objects.filter(role=User.Role.ADMIN, is_active=True))
        managers = list(dict.fromkeys(managers))
        if managers:
            notify_project_team(
                users=managers,
                notif_type='update',
                title=f'Late timesheet approval needed: {user.name}',
                message=f'{user.name} requested approval to submit timesheet for {request_obj.date}.',
                action_url='/timesheet?tab=approvals',
            )
            _send_late_entry_request_email(request_obj, managers)

    def get_permissions(self):
        if self.action in ('update', 'partial_update', 'destroy', 'approve', 'reject'):
            return [IsAdminOrManager()]
        return [IsAuthenticated()]

    def _can_resolve(self, request_obj):
        user = self.request.user
        if user.role == User.Role.ADMIN:
            return True
        return user.role == User.Role.MANAGER and (
            request_obj.resource.manager_id == user.id
            or request_obj.resource.user.assigned_projects.filter(manager=user).exists()
        )

    @action(detail=True, methods=['post'], permission_classes=[IsAdminOrManager])
    def approve(self, request, pk=None):
        req = self.get_object()
        if not self._can_resolve(req):
            return Response({'detail': 'You can only approve late entries for your resources.'}, status=status.HTTP_403_FORBIDDEN)
        if req.status != TimesheetLateEntryApproval.Status.PENDING:
            return Response({'detail': 'Already resolved.'}, status=status.HTTP_400_BAD_REQUEST)
        req.status = TimesheetLateEntryApproval.Status.APPROVED
        req.resolved_by = request.user
        req.resolved_at = timezone.now()
        req.admin_note = (request.data.get('admin_note') or '')[:500]
        req.save(update_fields=['status', 'resolved_by', 'resolved_at', 'admin_note'])
        notify_user(
            user=req.resource.user,
            notif_type='update',
            title='Late timesheet request approved',
            message=f'You can now submit timesheet for {req.date}.',
            action_url='/timesheet',
        )
        _send_late_entry_resolution_email(req)
        return Response({'detail': 'Approved.'})

    @action(detail=True, methods=['post'], permission_classes=[IsAdminOrManager])
    def reject(self, request, pk=None):
        req = self.get_object()
        if not self._can_resolve(req):
            return Response({'detail': 'You can only reject late entries for your resources.'}, status=status.HTTP_403_FORBIDDEN)
        if req.status != TimesheetLateEntryApproval.Status.PENDING:
            return Response({'detail': 'Already resolved.'}, status=status.HTTP_400_BAD_REQUEST)
        req.status = TimesheetLateEntryApproval.Status.REJECTED
        req.resolved_by = request.user
        req.resolved_at = timezone.now()
        req.admin_note = (request.data.get('admin_note') or '')[:500]
        req.save(update_fields=['status', 'resolved_by', 'resolved_at', 'admin_note'])
        notify_user(
            user=req.resource.user,
            notif_type='update',
            title='Late timesheet request rejected',
            message=f'Your request for {req.date} was rejected.',
            action_url='/timesheet',
        )
        _send_late_entry_resolution_email(req)
        return Response({'detail': 'Rejected.'})