import logging
from decimal import Decimal

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
from timelines.models import Timeline
from .models import ResourceProfile, TimeEntry, TimesheetLateEntryApproval
from .serializers import ResourceProfileSerializer, TimeEntrySerializer, TimesheetLateEntryApprovalSerializer

logger = logging.getLogger('nexus')

ACTIVE_PROJECT_STATUSES = ['planning', 'in_progress', 'review', 'on_hold']
HOURS_OUTPUT = DecimalField(max_digits=10, decimal_places=2)


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
    if entry.resource.manager and entry.resource.manager.is_active and entry.resource.manager.role == User.Role.MANAGER:
        recipients.append(entry.resource.manager)
    project_manager = getattr(entry.project, 'manager', None)
    if project_manager and project_manager.is_active and project_manager.role == User.Role.MANAGER:
        recipients.append(project_manager)
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
            ('Phase', scope),
            ('Date', entry.date.isoformat()),
            ('Hours logged', entry.hours),
            ('Approval status', 'Pending manager review'),
            ('Remaining phase hours', f"{max((entry.timeline.hours_allocated if entry.timeline else 0) - float(entry.timeline.hours_consumed if entry.timeline else 0), 0):.2f}h" if entry.timeline else 'See dashboard'),
        ],
        footer_note='This is an automated no-reply notification from AstraTSM. Please review the work log in the application.',
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
            ('Phase', entry.timeline.name if entry.timeline else 'Project-level log'),
            ('Date', entry.date.isoformat()),
            ('Hours approved', entry.hours),
            ('Approved by', approver.name),
        ],
        footer_note='This is an automated no-reply notification from AstraTSM.',
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
            headers=['Date', 'Project', 'Phase', 'Hours', 'Approval Status', 'Approved By', 'Approved At', 'Description'],
            rows=rows,
        )


class TimeEntryViewSet(viewsets.ModelViewSet):
    queryset = TimeEntry.objects.select_related('resource__user', 'resource__manager', 'project__manager', 'timeline', 'approved_by')
    serializer_class = TimeEntrySerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['resource', 'project', 'timeline', 'date', 'approved']
    ordering_fields = ['date', 'hours']

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user.role == User.Role.ADMIN:
            return qs
        if user.role == User.Role.MANAGER:
            return qs.filter(Q(resource__manager=user) | Q(project__manager=user)).distinct()
        try:
            return qs.filter(resource=user.resource_profile)
        except ResourceProfile.DoesNotExist as exc:
            raise PermissionDenied('Your account does not have a resource profile.') from exc

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
            action_url='/timelines',
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

    @action(detail=True, methods=['patch'], permission_classes=[IsAuthenticated])
    def approve(self, request, pk=None):
        entry = self.get_object()
        if request.user.role != User.Role.MANAGER:
            return Response({'detail': 'Only managers can approve time entries.'}, status=status.HTTP_403_FORBIDDEN)
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
        admins = list(User.objects.filter(role=User.Role.ADMIN, is_active=True))
        if admins:
            notify_project_team(
                users=admins,
                notif_type='update',
                title=f'Late timesheet approval needed: {user.name}',
                message=f'{user.name} requested late timesheet approval for {request_obj.date}.',
                action_url='/approvals',
            )

    def get_permissions(self):
        if self.action in ('update', 'partial_update', 'destroy', 'approve', 'reject'):
            return [IsAdmin()]
        return [IsAuthenticated()]

    @action(detail=True, methods=['post'], permission_classes=[IsAdmin])
    def approve(self, request, pk=None):
        req = self.get_object()
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
            action_url='/timelines',
        )
        return Response({'detail': 'Approved.'})

    @action(detail=True, methods=['post'], permission_classes=[IsAdmin])
    def reject(self, request, pk=None):
        req = self.get_object()
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
            action_url='/timelines',
        )
        return Response({'detail': 'Rejected.'})
