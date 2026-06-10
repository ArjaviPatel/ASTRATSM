"""timelines/views.py — secured, scalable, resource-aware"""
import logging
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters
from django.utils import timezone
from django.db import transaction
from django.core.exceptions import PermissionDenied

from django.db.models import Avg, DecimalField, F, IntegerField, Q, Sum, Value, Case, When
from django.db.models.functions import Coalesce, Greatest
from .models import Timeline, TimelineMilestone, TimelineApprovalRequest
from .serializers import TimelineSerializer, TimelineMilestoneSerializer, TimelineApprovalRequestSerializer
from accounts.permissions import IsAdminOrManagerOrReadOnly, IsAdmin
from notifications.utils import email_no_reply, notify_project_team
from accounts.models import User
from rest_framework.permissions import IsAuthenticated

from datetime import datetime, time as dt_time, timedelta

logger = logging.getLogger('nexus')

ADMIN_ROLES = (User.Role.ADMIN, User.Role.LEADERSHIP)

def _count_work_hours(from_dt, to_dt):
    """Mon-Fri, 8 working hours per day."""
    if not from_dt or not to_dt or to_dt <= from_dt:
        return 0.0
    total = 0.0
    cur = from_dt
    while cur < to_dt:
        dow = cur.weekday()
        if dow >= 5:
            days_ahead = 7 - dow
            cur = datetime.combine((cur + timedelta(days=days_ahead)).date(), dt_time(0, 0), tzinfo=cur.tzinfo)
            continue
        day_end = cur.replace(hour=23, minute=59, second=59, microsecond=999999)
        eff_to = min(to_dt, day_end)
        hours = (eff_to - cur).total_seconds() / 3600
        total += min(hours, 8.0)
        cur = datetime.combine((cur + timedelta(days=1)).date(), dt_time(0, 0), tzinfo=cur.tzinfo)
    return round(total, 2)


def _sync_project_progress(project):
    if not project:
        return
    avg = Timeline.objects.filter(project=project).aggregate(a=Avg('progress'))['a']
    if avg is not None:
        project.progress = round(avg)
        project.save(update_fields=['progress'])


def _timeline_team(timeline, exclude=None):
    seen, result = set(), []
    candidates = list(timeline.assignees.filter(is_active=True))
    if timeline.project.manager:
        candidates.append(timeline.project.manager)
    for u in candidates:
        if u.id not in seen and u != exclude:
            seen.add(u.id)
            result.append(u)
    return result


def _user_can_access_timeline(user, timeline):
    if user.role in ADMIN_ROLES:
        return True
    if user.role == User.Role.MANAGER:
        return timeline.project.manager_id == user.pk
    if user.role == User.Role.RESOURCE:
        return timeline.project.resources.filter(pk=user.pk).exists()
    return False


def _user_can_manage_timeline(user, timeline):
    if user.role in ADMIN_ROLES:
        return True
    if user.role == User.Role.MANAGER:
        return timeline.project.manager_id == user.pk
    if user.role == User.Role.RESOURCE:
        return timeline.assignees.filter(pk=user.pk).exists()
    return False


def _apply_progress_status(timeline, progress, requested_status=None):
    old_status = timeline.status
    timeline.progress = progress

    if progress >= 100:
        timeline.progress = 100
        timeline.status = Timeline.Status.COMPLETED
    elif requested_status in {choice[0] for choice in Timeline.Status.choices}:
        timeline.status = requested_status
    elif progress > 0 and timeline.status == Timeline.Status.PENDING:
        timeline.status = Timeline.Status.IN_PROGRESS
    elif progress == 0 and timeline.status == Timeline.Status.COMPLETED:
        timeline.status = Timeline.Status.PENDING

    return old_status


def _email_timeline_approval_request(req):
    admins = list(User.objects.filter(role__in=ADMIN_ROLES, is_active=True))
    if not admins:
        return
    timeline_name = req.timeline.name if req.timeline else 'Timeline request'
    email_no_reply(
        admins,
        subject=f'Timeline approval request: {timeline_name}',
        heading='A timeline approval request needs review.',
        intro='A user requested timeline approval in AstraTSM. Please review it from the approvals page.',
        details=[
            ('Timeline', timeline_name),
            ('Project', req.timeline.project.name if req.timeline and req.timeline.project else 'Unknown'),
            ('Request type', req.get_request_type_display()),
            ('Requested by', req.requested_by.name if req.requested_by else 'Unknown'),
            ('Reason', req.reason or 'No reason given'),
        ],
        footer_note='This is an automated no-reply notification from AstraTSM.',
    )


def _email_timeline_approval_resolution(req, resolved_by, approved):
    if not req.requested_by:
        return
    timeline_name = req.timeline.name if req.timeline else 'Timeline request'
    status_text = 'approved' if approved else 'rejected'
    email_no_reply(
        [req.requested_by],
        subject=f'Timeline approval {status_text}: {timeline_name}',
        heading=f'Your timeline request was {status_text}.',
        intro='AstraTSM has resolved your timeline approval request.',
        details=[
            ('Timeline', timeline_name),
            ('Request type', req.get_request_type_display()),
            ('Resolved by', resolved_by.name),
            ('Admin note', req.admin_note or 'No note provided'),
        ],
        footer_note='This is an automated no-reply notification from AstraTSM.',
    )


class TimelineViewSet(viewsets.ModelViewSet):
    serializer_class = TimelineSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['project', 'status']
    search_fields = ['name', 'description']
    ordering_fields = ['order', 'start_date', 'end_date', 'progress']

    def get_queryset(self):
        user = self.request.user
        base = Timeline.objects.select_related('project__manager').prefetch_related('assignees', 'milestones').annotate(
            submitted_hours_value=Coalesce(Sum('timeentries__hours'), Value(0), output_field=DecimalField(max_digits=10, decimal_places=2)),
            approved_hours_value=Coalesce(Sum('timeentries__hours', filter=Q(timeentries__approved=True)), Value(0), output_field=DecimalField(max_digits=10, decimal_places=2)),
        ).annotate(
            pending_hours_value=Greatest(F('submitted_hours_value') - F('approved_hours_value'), Value(0), output_field=DecimalField(max_digits=10, decimal_places=2)),
            remaining_hours_value=Greatest(F('hours_allocated') - F('submitted_hours_value'), Value(0), output_field=DecimalField(max_digits=10, decimal_places=2)),
            hours_progress_value=Case(
                When(hours_allocated__gt=0, then=Greatest(Value(0), F('submitted_hours_value') * Value(100.0) / F('hours_allocated'))),
                default=Value(0),
                output_field=IntegerField(),
            ),
        )
        if user.role in ADMIN_ROLES:
            return base.all()
        if user.role == User.Role.MANAGER:
            return base.filter(project__manager=user)
        if user.role == User.Role.RESOURCE:
            return base.filter(Q(project__resources=user) | Q(assignees=user)).distinct()
        return base.none()

    def get_permissions(self):
        if self.action in ('create', 'update', 'destroy'):
            return [IsAdminOrManagerOrReadOnly()]
        if self.action == 'partial_update':
            return [IsAuthenticated()]
        return [IsAuthenticated()]

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        if not _user_can_access_timeline(request.user, obj):
            self.permission_denied(request, message="You don't have access to this timeline.")

    def perform_create(self, serializer):
        user = self.request.user
        project = serializer.validated_data.get('project')
        if user.role == User.Role.CLIENT:
            raise PermissionDenied("Clients cannot create timelines.")
        if user.role == User.Role.MANAGER and project.manager_id != user.pk:
            raise PermissionDenied("You can only create timelines for projects you manage.")
        if user.role == User.Role.RESOURCE:
            if not project.resources.filter(pk=user.pk).exists():
                raise PermissionDenied("You can only create timelines for projects you are assigned to.")

        initial_status = serializer.validated_data.get('status', 'pending')
        tl = serializer.save(
            hours_consumed=0.0,
            paused_at=timezone.now() if initial_status == 'in_progress' else None,
        )
        logger.info('Timeline "%s" created for project "%s" by %s', tl.name, tl.project.name, user.email)
        assignees = list(tl.assignees.filter(is_active=True))
        if assignees:
            notify_project_team(
                users=assignees,
                notif_type='project_assigned',
                title=f'Assigned to phase: {tl.name}',
                message=f'You have been assigned to the "{tl.name}" phase in "{tl.project.name}".',
                project=tl.project,
                action_url='/timelines',
            )

    def perform_update(self, serializer):
        old = self.get_object()
        user = self.request.user
        partial = getattr(serializer, 'partial', False)
        if user.role == User.Role.RESOURCE:
            if not partial:
                raise PermissionDenied("Resources can only submit partial phase updates.")
            if not _user_can_access_timeline(user, old):
                raise PermissionDenied("You don't have access to this timeline.")
            submitted_fields = set(serializer.validated_data.keys())
            allowed_fields = {'status', 'progress', 'description'}
            blocked_fields = submitted_fields - allowed_fields
            if blocked_fields:
                raise PermissionDenied("Resources can only update phase status, progress, and description.")

        old_status = old.status
        old_assignee_ids = set(old.assignees.values_list('id', flat=True))
        new_status = self.request.data.get('status', old_status)
        now = timezone.now()

        with transaction.atomic():
            if old_status == 'in_progress' and new_status == 'on_hold':
                count_from = old.paused_at if old.paused_at else timezone.make_aware(
                    datetime.combine(old.start_date, dt_time(9, 0))
                )
                fresh = _count_work_hours(count_from, now)
                banked = float(old.hours_consumed or 0)
                tl = serializer.save(hours_consumed=round(banked + fresh, 2), paused_at=now)
            elif old_status == 'on_hold' and new_status == 'in_progress':
                tl = serializer.save(paused_at=now)
            elif old_status == 'pending' and new_status == 'in_progress':
                tl = serializer.save(paused_at=now)
            else:
                tl = serializer.save()

        _sync_project_progress(tl.project)

        if old_status != tl.status:
            notif_type = 'timeline_complete' if tl.status == Timeline.Status.COMPLETED else 'status_change'
            title = f'Phase completed: {tl.name}' if tl.status == Timeline.Status.COMPLETED else f'Phase status changed: {tl.name}'
            message = (
                f'The "{tl.name}" phase in "{tl.project.name}" is now complete.'
                if tl.status == Timeline.Status.COMPLETED
                else f'"{tl.name}" in "{tl.project.name}" is now {tl.get_status_display()}.'
            )
            notify_project_team(users=_timeline_team(tl), notif_type=notif_type, title=title, message=message, project=tl.project, action_url='/timelines')

        new_assignee_ids = set(tl.assignees.values_list('id', flat=True)) - old_assignee_ids
        if new_assignee_ids:
            new_members = list(User.objects.filter(pk__in=new_assignee_ids, is_active=True))
            notify_project_team(users=new_members, notif_type='project_assigned', title=f'Assigned to phase: {tl.name}', message=f'You have been assigned to "{tl.name}" in "{tl.project.name}".', project=tl.project, action_url='/timelines')

    def perform_destroy(self, instance):
        user = self.request.user
        if user.role == User.Role.RESOURCE:
            raise PermissionDenied("Resources must request delete approval.")
        with transaction.atomic():
            project = instance.project
            instance.delete()
            _sync_project_progress(project)

    @action(detail=True, methods=['patch'], permission_classes=[IsAuthenticated])
    def update_progress(self, request, pk=None):
        tl = self.get_object()
        if not _user_can_access_timeline(request.user, tl):
            return Response({'detail': 'Access denied.'}, status=status.HTTP_403_FORBIDDEN)
        raw = request.data.get('progress')
        try:
            value = int(raw)
            assert 0 <= value <= 100
        except (TypeError, ValueError, AssertionError):
            return Response({'detail': 'progress must be an integer 0-100.'}, status=status.HTTP_400_BAD_REQUEST)
        old_status = tl.status
        tl.progress = value
        if value == 100:
            tl.status = Timeline.Status.COMPLETED
        elif value > 0 and tl.status == Timeline.Status.PENDING:
            tl.status = Timeline.Status.IN_PROGRESS
        tl.save(update_fields=['progress', 'status', 'updated_at'])
        _sync_project_progress(tl.project)
        if old_status != tl.status and tl.status == Timeline.Status.COMPLETED:
            notify_project_team(users=_timeline_team(tl), notif_type='timeline_complete', title=f'Phase completed: {tl.name}', message=f'The "{tl.name}" phase in "{tl.project.name}" has reached 100%.', project=tl.project, action_url='/timelines')
        return Response({'progress': tl.progress, 'status': tl.status})

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def add_milestone(self, request, pk=None):
        tl = self.get_object()
        if not _user_can_access_timeline(request.user, tl):
            return Response({'detail': 'Access denied.'}, status=status.HTTP_403_FORBIDDEN)
        data = {
            'title': str(request.data.get('title', '')).strip()[:200],
            'due_date': request.data.get('due_date'),
            'timeline': tl.id,
        }
        s = TimelineMilestoneSerializer(data=data)
        s.is_valid(raise_exception=True)
        milestone = s.save(timeline=tl)
        notify_project_team(users=_timeline_team(tl), notif_type='deadline', title=f'New milestone: {milestone.title}', message=f'Milestone "{milestone.title}" (due {milestone.due_date}) added to "{tl.name}" in "{tl.project.name}".', project=tl.project, action_url='/timelines')
        return Response(s.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['patch'], permission_classes=[IsAuthenticated])
    def update_work(self, request, pk=None):
        tl = self.get_object()
        if not _user_can_access_timeline(request.user, tl):
            return Response({'detail': 'Access denied.'}, status=status.HTTP_403_FORBIDDEN)

        errors = {}
        description = request.data.get('description', None)
        requested_status = request.data.get('status', None)
        raw_progress = request.data.get('progress', None)

        if description is not None:
            description = str(description).strip()[:5000]
            if not description:
                errors['description'] = 'Description cannot be empty.'

        progress = tl.progress
        if raw_progress is not None:
            try:
                progress = int(raw_progress)
                if not 0 <= progress <= 100:
                    raise ValueError
            except (TypeError, ValueError):
                errors['progress'] = 'progress must be an integer 0-100.'

        valid_statuses = {choice[0] for choice in Timeline.Status.choices}
        if requested_status is not None and requested_status not in valid_statuses:
            errors['status'] = 'Invalid status.'

        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        if description is None and raw_progress is None and requested_status is None:
            return Response({'detail': 'No work update fields provided.'}, status=status.HTTP_400_BAD_REQUEST)

        old_status = _apply_progress_status(tl, progress, requested_status)
        if description is not None:
            tl.description = description
        tl.save(update_fields=['description', 'progress', 'status', 'updated_at'])
        _sync_project_progress(tl.project)

        if old_status != tl.status:
            notif_type = 'timeline_complete' if tl.status == Timeline.Status.COMPLETED else 'status_change'
            title = f'Phase completed: {tl.name}' if tl.status == Timeline.Status.COMPLETED else f'Phase updated: {tl.name}'
            message = (
                f'The "{tl.name}" phase in "{tl.project.name}" is now complete.'
                if tl.status == Timeline.Status.COMPLETED
                else f'{request.user.name} updated phase "{tl.name}" to {tl.get_status_display()} at {tl.progress}% progress.'
            )
            notify_project_team(users=_timeline_team(tl, exclude=request.user), notif_type=notif_type, title=title, message=message, project=tl.project, action_url='/timelines')

        return Response(TimelineSerializer(tl, context={'request': request}).data)


class MilestoneViewSet(viewsets.ModelViewSet):
    queryset = TimelineMilestone.objects.select_related('timeline__project__manager').prefetch_related('timeline__assignees')
    serializer_class = TimelineMilestoneSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['timeline', 'completed']

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user.role in ADMIN_ROLES:
            return qs
        if user.role == User.Role.MANAGER:
            return qs.filter(timeline__project__manager=user)
        return qs.filter(Q(timeline__project__resources=user) | Q(timeline__assignees=user)).distinct()

    def perform_create(self, serializer):
        timeline = serializer.validated_data['timeline']
        if not _user_can_manage_timeline(self.request.user, timeline):
            raise PermissionDenied("You cannot add milestones to this timeline.")
        serializer.save()

    def perform_update(self, serializer):
        timeline = serializer.instance.timeline
        if not _user_can_manage_timeline(self.request.user, timeline):
            raise PermissionDenied("You cannot edit milestones on this timeline.")
        serializer.save()

    def perform_destroy(self, instance):
        if not _user_can_manage_timeline(self.request.user, instance.timeline):
            raise PermissionDenied("You cannot delete milestones on this timeline.")
        instance.delete()

    @action(detail=True, methods=['patch'])
    def complete(self, request, pk=None):
        m = self.get_object()
        if not _user_can_manage_timeline(request.user, m.timeline):
            return Response({'detail': 'Access denied.'}, status=status.HTTP_403_FORBIDDEN)
        if m.completed:
            return Response({'detail': 'Already completed.'}, status=status.HTTP_400_BAD_REQUEST)
        m.completed = True
        m.completed_at = timezone.now()
        m.save(update_fields=['completed', 'completed_at'])
        notify_project_team(users=_timeline_team(m.timeline), notif_type='timeline_complete', title=f'Milestone hit: {m.title}', message=f'"{m.title}" in "{m.timeline.name}" ({m.timeline.project.name}) has been completed.', project=m.timeline.project, action_url='/timelines')
        return Response(TimelineMilestoneSerializer(m).data)


class TimelineApprovalViewSet(viewsets.ModelViewSet):
    serializer_class = TimelineApprovalRequestSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = TimelineApprovalRequest.objects.select_related('timeline__project', 'requested_by', 'resolved_by')
        status_filter = self.request.query_params.get('status')
        request_type = self.request.query_params.get('request_type')
        if user.role in ADMIN_ROLES:
            scoped = qs.all()
        elif user.role == User.Role.MANAGER:
            scoped = qs.filter(Q(requested_by=user) | Q(timeline__project__manager=user)).distinct()
        else:
            scoped = qs.filter(requested_by=user)
        if status_filter:
            scoped = scoped.filter(status=status_filter)
        if request_type:
            scoped = scoped.filter(request_type=request_type)
        return scoped

    def get_permissions(self):
        if self.action in ('update', 'partial_update', 'destroy'):
            return [IsAdmin()]
        return [IsAuthenticated()]

    def perform_create(self, serializer):
        user = self.request.user
        timeline = serializer.validated_data.get('timeline')
        if timeline and not _user_can_access_timeline(user, timeline):
            raise PermissionDenied("You don't have access to this timeline.")
        existing = TimelineApprovalRequest.objects.filter(
            timeline=timeline,
            requested_by=user,
            request_type=serializer.validated_data.get('request_type'),
            status=TimelineApprovalRequest.Status.PENDING,
        ).first()
        if existing:
            raise PermissionDenied("You already have a pending request for this timeline.")
        req = serializer.save(requested_by=user, proposed_changes={})
        timeline_name = req.timeline.name if req.timeline else 'Unknown'
        logger.info('Timeline approval request %s (%s) by %s', req.id, req.request_type, user.email)
        admins = User.objects.filter(role__in=ADMIN_ROLES, is_active=True)
        notify_project_team(
            users=list(admins),
            notif_type='status_change',
            title=f'Approval needed: {req.request_type.upper()} - {timeline_name}',
            message=(f'{user.name} wants to {req.request_type} timeline "{timeline_name}". Reason: {req.reason or "No reason given."}'),
            action_url='/approvals',
        )

    @action(detail=True, methods=['post'], permission_classes=[IsAdmin])
    def approve(self, request, pk=None):
        req = self.get_object()
        if req.status != TimelineApprovalRequest.Status.PENDING:
            return Response({'detail': 'Already resolved.'}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            req.status = TimelineApprovalRequest.Status.APPROVED
            req.resolved_by = request.user
            req.resolved_at = timezone.now()
            req.admin_note = str(request.data.get('admin_note', ''))[:500]
            req.save()
        requesting_user = req.requested_by
        timeline = req.timeline
        timeline_name = timeline.name if timeline else 'timeline'
        if req.request_type == TimelineApprovalRequest.RequestType.DELETE and timeline:
            with transaction.atomic():
                project = timeline.project
                notify_project_team(users=_timeline_team(timeline), notif_type='status_change', title=f'Timeline deleted: {timeline_name}', message=f'The timeline "{timeline_name}" has been removed.')
                timeline.delete()
                _sync_project_progress(project)
            if requesting_user:
                notify_project_team(users=[requesting_user], notif_type='update', title=f'Delete approved - {timeline_name}', message=f'Your delete request for timeline "{timeline_name}" was approved.' + (f' Note: {req.admin_note}' if req.admin_note else ''), action_url='/approvals')
            _email_timeline_approval_resolution(req, request.user, approved=True)
            return Response({'detail': 'Approved. Timeline deleted.'})
        if requesting_user:
            notify_project_team(users=[requesting_user], notif_type='update', title=f'Edit approved - {timeline_name}', message=f'Your edit request for timeline "{timeline_name}" was approved. Go to Approvals to apply changes.' + (f' Note: {req.admin_note}' if req.admin_note else ''), action_url='/approvals')
        _email_timeline_approval_resolution(req, request.user, approved=True)
        return Response({'detail': 'Approved. User can now apply the edit.'})

    @action(detail=True, methods=['post'], permission_classes=[IsAdmin])
    def reject(self, request, pk=None):
        req = self.get_object()
        if req.status != TimelineApprovalRequest.Status.PENDING:
            return Response({'detail': 'Already resolved.'}, status=status.HTTP_400_BAD_REQUEST)
        req.status = TimelineApprovalRequest.Status.REJECTED
        req.resolved_by = request.user
        req.resolved_at = timezone.now()
        req.admin_note = str(request.data.get('admin_note', ''))[:500]
        req.save()
        if req.requested_by and req.timeline:
            notify_project_team(users=[req.requested_by], notif_type='update', title=f'Request rejected - {req.timeline.name}', message=f'Your {req.request_type} request for "{req.timeline.name}" was rejected.' + (f' Reason: {req.admin_note}' if req.admin_note else ''), action_url='/approvals')
        _email_timeline_approval_resolution(req, request.user, approved=False)
        return Response({'detail': 'Rejected.'})

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def apply_edit(self, request, pk=None):
        req = self.get_object()
        user = request.user
        if req.requested_by != user:
            return Response({'detail': 'You did not make this request.'}, status=status.HTTP_403_FORBIDDEN)
        if req.request_type != TimelineApprovalRequest.RequestType.EDIT:
            return Response({'detail': 'This is not an edit request.'}, status=status.HTTP_400_BAD_REQUEST)
        if req.status != TimelineApprovalRequest.Status.APPROVED:
            return Response({'detail': 'Request not approved yet.'}, status=status.HTTP_400_BAD_REQUEST)
        if req.proposed_changes.get('_applied'):
            return Response({'detail': 'Already applied.'}, status=status.HTTP_400_BAD_REQUEST)
        timeline = req.timeline
        if not timeline:
            return Response({'detail': 'Timeline no longer exists.'}, status=status.HTTP_404_NOT_FOUND)
        ALLOWED = ['name', 'description', 'status', 'start_date', 'end_date', 'hours_allocated']
        SAFE_STATUSES = [s[0] for s in Timeline.Status.choices]
        changes = {}
        errors = {}
        for field in ALLOWED:
            if field not in request.data:
                continue
            value = request.data[field]
            if field == 'name':
                value = str(value).strip()[:200]
                if not value:
                    errors['name'] = 'Name cannot be empty.'
                    continue
            elif field == 'description':
                value = str(value).strip()[:5000]
            elif field == 'status':
                if value not in SAFE_STATUSES:
                    errors['status'] = 'Invalid status.'
                    continue
            elif field == 'hours_allocated':
                try:
                    value = int(value)
                    if value < 0:
                        raise ValueError
                except (TypeError, ValueError):
                    errors['hours_allocated'] = 'Hours allocated must be a non-negative integer.'
                    continue
            setattr(timeline, field, value)
            changes[field] = value
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        if not changes:
            return Response({'detail': 'No valid fields provided.'}, status=status.HTTP_400_BAD_REQUEST)
        if timeline.start_date and timeline.end_date and timeline.start_date > timeline.end_date:
            return Response({'end_date': 'End date must be after start date.'}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            timeline.save()
            req.proposed_changes = {**changes, '_applied': True}
            req.save(update_fields=['proposed_changes'])
            _sync_project_progress(timeline.project)
        notify_project_team(users=_timeline_team(timeline), notif_type='status_change', title=f'Timeline updated: {timeline.name}', message=f'"{timeline.name}" was updated by {user.name}.', project=timeline.project, action_url='/timelines')
        return Response({'detail': 'Edit applied successfully.'})

    @action(detail=False, methods=['get'])
    def pending_count(self, request):
        user = request.user
        if user.role in ADMIN_ROLES:
            count = TimelineApprovalRequest.objects.filter(status=TimelineApprovalRequest.Status.PENDING).count()
        elif user.role == User.Role.MANAGER:
            count = TimelineApprovalRequest.objects.filter(status=TimelineApprovalRequest.Status.PENDING, timeline__project__manager=user).count()
        else:
            count = TimelineApprovalRequest.objects.filter(requested_by=user, request_type=TimelineApprovalRequest.RequestType.EDIT, status=TimelineApprovalRequest.Status.APPROVED).exclude(proposed_changes__has_key='_applied').count()
        return Response({'count': count})
