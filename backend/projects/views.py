import json
import logging
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, DecimalField, F, Q, Sum, Value
from django.db.models.functions import Coalesce, Greatest
from django.core.serializers.json import DjangoJSONEncoder
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.models import User
from accounts.permissions import IsAdmin, IsAdminOrManager
ADMIN_ROLES = (User.Role.ADMIN, User.Role.LEADERSHIP)
from nexus.excel import workbook_response
from notifications.utils import email_no_reply, email_users, notify_project_team
from .models import Project, ProjectApprovalRequest
from .serializers import (
    ProjectApprovalRequestSerializer,
    ProjectDetailSerializer,
    ProjectDocumentSerializer,
    ProjectListSerializer,
    ProjectUpdateSerializer,
)

logger = logging.getLogger('nexus')


TRACKED_PROJECT_FIELDS = {
    'name': 'Name',
    'description': 'Description',
    'client_id': 'Client',
    'manager_id': 'Manager',
    'start_date': 'Start Date',
    'end_date': 'End Date',
    'budget': 'Budget',
    'spent': 'Spent',
    'resource_l1': 'L1 Resources',
    'resource_l2': 'L2 Resources',
    'resource_l3': 'L3 Resources',
    'resource_l4': 'L4 Resources',
    'hours': 'Estimated Hours',
    'activity': 'Activity',
    'status': 'Status',
    'priority': 'Priority',
    'progress': 'Progress',
    'tags': 'Tags',
}


def _project_team(project, exclude=None):
    seen, result = set(), []
    candidates = list(project.resources.filter(is_active=True))
    if project.manager:
        candidates.append(project.manager)
    for user in candidates:
        if user.id not in seen and user != exclude:
            seen.add(user.id)
            result.append(user)
    return result


def _notify_admins(title, message, action_url=''):
    admins = list(User.objects.filter(role__in=ADMIN_ROLES, is_active=True))
    if admins:
        notify_project_team(users=admins, notif_type='update', title=title, message=message, action_url=action_url)


def _display_value(project, field):
    value = getattr(project, field)
    if field == 'client_id':
        return project.client.name if project.client else 'Unassigned'
    if field == 'manager_id':
        return project.manager.name if project.manager else 'Unassigned'
    if field in {'budget', 'spent', 'hours'} and isinstance(value, Decimal):
        return str(value)
    if field in {'start_date', 'end_date'}:
        return value.isoformat() if value else 'Not set'
    if field == 'tags':
        return ', '.join(value or []) or 'None'
    if value in (None, ''):
        return 'Not set'
    return str(value)


def _project_change_summary(previous, current):
    changes = []
    for field, label in TRACKED_PROJECT_FIELDS.items():
        old_value = _display_value(previous, field)
        new_value = _display_value(current, field)
        if old_value != new_value:
            changes.append(f'- {label}: {old_value} -> {new_value}')
    return changes


def _email_project_assignment(project, user, actor):
    subject = f'Project assignment: {project.name}'
    body = (
        f'Hello {user.name},\n\n'
        f'You have been assigned to the project "{project.name}" by {actor.name}.\n\n'
        f'Client: {project.client.name if project.client else "Not assigned"}\n'
        f'Manager: {project.manager.name if project.manager else "Not assigned"}\n'
        f'Status: {project.get_status_display()}\n'
        f'Priority: {project.get_priority_display()}\n'
        f'Start Date: {project.start_date.isoformat() if project.start_date else "Not set"}\n'
        f'End Date: {project.end_date.isoformat() if project.end_date else "Not set"}\n\n'
        'Please review the project details in AstraTSM.\n'
    )
    email_users([user], subject, body)


def _email_manager_assignment(project, manager_user, actor, reason='assigned'):
    subject = f'Project manager assignment: {project.name}'
    email_no_reply(
        [manager_user],
        subject=subject,
        heading='You have been assigned as the project manager.',
        intro='AstraTSM assigned you as the manager for this project. Please review ownership, dates, and assigned resources.',
        details=[
            ('Project', project.name),
            ('Assigned by', actor.name),
            ('Reason', reason.title()),
            ('Client', project.client.name if project.client else 'Not assigned'),
            ('Status', project.get_status_display()),
            ('Priority', project.get_priority_display()),
            ('Start Date', project.start_date.isoformat() if project.start_date else 'Not set'),
            ('End Date', project.end_date.isoformat() if project.end_date else 'Not set'),
            ('Assigned Resources', ', '.join(project.resources.values_list('name', flat=True)) or 'None yet'),
        ],
        footer_note='This is an automated no-reply notification from AstraTSM.',
    )


def _email_project_change(project, recipients, actor, changes, intro='The project details were updated.'):
    if not changes:
        return
    subject = f'Project updated: {project.name}'
    body = (
        f'Hello,\n\n'
        f'{intro}\n'
        f'Updated by: {actor.name}\n'
        f'Project: {project.name}\n\n'
        'Changes:\n'
        + '\n'.join(changes)
        + '\n\nPlease review the latest project details in AstraTSM.\n'
    )
    email_users(recipients, subject, body)


def _email_project_note(project, recipients, actor, content):
    subject = f'Project update note: {project.name}'
    body = (
        f'Hello,\n\n'
        f'{actor.name} posted a new update on the project "{project.name}".\n\n'
        f'Update:\n{content.strip() or "No additional notes provided."}\n\n'
        'Please review the latest project details in AstraTSM.\n'
    )
    email_users(recipients, subject, body)


def _email_project_approval_request(req):
    admins = list(User.objects.filter(role__in=ADMIN_ROLES, is_active=True))
    if not admins:
        return
    project_name = req.project.name if req.project else 'Project request'
    email_no_reply(
        admins,
        subject=f'Approval request: {project_name}',
        heading='A project approval request needs review.',
        intro='A user requested approval in AstraTSM. Please review it from the approvals page.',
        details=[
            ('Project', project_name),
            ('Request type', req.get_request_type_display()),
            ('Requested by', req.requested_by.name if req.requested_by else 'Unknown'),
            ('Reason', req.reason or 'No reason given'),
        ],
        footer_note='This is an automated no-reply notification from AstraTSM.',
    )


def _email_project_approval_resolution(req, resolved_by, approved):
    if not req.requested_by:
        return
    project_name = req.project.name if req.project else 'Project request'
    status_text = 'approved' if approved else 'rejected'
    intro = 'Your approval request was approved.' if approved else 'Your approval request was rejected.'
    email_no_reply(
        [req.requested_by],
        subject=f'Project approval {status_text}: {project_name}',
        heading=f'Your project request was {status_text}.',
        intro=intro,
        details=[
            ('Project', project_name),
            ('Request type', req.get_request_type_display()),
            ('Resolved by', resolved_by.name),
            ('Admin note', req.admin_note or 'No note provided'),
        ],
        footer_note='This is an automated no-reply notification from AstraTSM.',
    )


class ProjectViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['status', 'priority', 'client', 'manager']
    search_fields = ['name', 'description', 'client__name', 'manager__name']
    ordering_fields = ['name', 'created_at', 'end_date', 'priority', 'progress', 'budget']

    def get_queryset(self):
        user = self.request.user
        base = Project.objects.select_related('client', 'manager', 'created_by').annotate(
            resource_count=Count('resources', distinct=True),
            submitted_hours_value=Coalesce(Sum('timeentries__hours'), Value(0), output_field=DecimalField(max_digits=10, decimal_places=2)),
            approved_hours_value=Coalesce(Sum('timeentries__hours', filter=Q(timeentries__approved=True)), Value(0), output_field=DecimalField(max_digits=10, decimal_places=2)),
        ).annotate(
            pending_hours_value=Greatest(F('submitted_hours_value') - F('approved_hours_value'), Value(0), output_field=DecimalField(max_digits=10, decimal_places=2)),
            remaining_hours_value=Greatest(F('hours') - F('submitted_hours_value'), Value(0), output_field=DecimalField(max_digits=10, decimal_places=2)),
        )
        if self.action in ('retrieve', 'assign_resource', 'remove_resource', 'add_update', 'upload_document', 'update_progress'):
            base = base.prefetch_related('resources', 'updates', 'documents')
        if user.role in ADMIN_ROLES:
            qs = base.all()
        elif user.role in (User.Role.MANAGER, User.Role.RESOURCE):
            qs = base.filter(status__in=['planning', 'in_progress', 'review', 'on_hold'])
        else:
            qs = base.none()

        over_budget = self.request.query_params.get('over_budget')
        if over_budget in ('1', 'true', 'True', 'yes'):
            qs = qs.filter(budget__gt=0, spent__gt=F('budget'))
        return qs

    def get_serializer_class(self):
        return ProjectListSerializer if self.action == 'list' else ProjectDetailSerializer

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy', 'export'):
            return [IsAdmin()]
        return [IsAuthenticated()]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx

    def perform_create(self, serializer):
        project = serializer.save(created_by=self.request.user)
        logger.info('Project "%s" created by %s', project.name, self.request.user.email)
        recipients = list(User.objects.filter(role__in=[*ADMIN_ROLES, User.Role.MANAGER], is_active=True))
        assigned_resources = list(project.resources.filter(is_active=True))
        for resource in assigned_resources:
            if resource not in recipients:
                recipients.append(resource)
        notify_project_team(
            users=recipients,
            notif_type='project_assigned',
            title=f'New project: {project.name}',
            message=f'Project "{project.name}" has been created' + (f' for client {project.client.name}.' if project.client else '.'),
            project=project,
            action_url=f'/projects/{project.id}',
        )
        for resource in assigned_resources:
            _email_project_assignment(project, resource, self.request.user)
        if project.manager and project.manager.is_active and project.manager.role == User.Role.MANAGER:
            _email_manager_assignment(project, project.manager, self.request.user, reason='initial assignment')

    def perform_update(self, serializer):
        current = self.get_object()
        previous = Project.objects.select_related('client', 'manager').get(pk=current.pk)
        previous_resource_ids = set(current.resources.values_list('id', flat=True))
        previous_manager_id = current.manager_id
        old_status = previous.status
        old_progress = previous.progress
        project = serializer.save()
        changes = _project_change_summary(previous, project)
        current_resource_ids = set(project.resources.values_list('id', flat=True))
        newly_assigned_ids = current_resource_ids - previous_resource_ids
        manager_changed = project.manager_id and project.manager_id != previous_manager_id

        if changes:
            notify_project_team(
                users=_project_team(project),
                notif_type='update',
                title=f'Project updated: {project.name}',
                message=f'{self.request.user.name} updated project details for "{project.name}".',
                project=project,
                action_url=f'/projects/{project.id}',
            )
            _email_project_change(project, _project_team(project), self.request.user, changes)

        if newly_assigned_ids:
            new_resources = list(User.objects.filter(pk__in=newly_assigned_ids, role=User.Role.RESOURCE, is_active=True))
            if new_resources:
                notify_project_team(
                    users=new_resources,
                    notif_type='project_assigned',
                    title=f'Added to project: {project.name}',
                    message=f'You have been assigned to "{project.name}".',
                    project=project,
                    action_url=f'/projects/{project.id}',
                )
                for resource in new_resources:
                    _email_project_assignment(project, resource, self.request.user)

        if manager_changed and project.manager and project.manager.is_active and project.manager.role == User.Role.MANAGER:
            _email_manager_assignment(project, project.manager, self.request.user, reason='manager reassignment')

        if old_status != project.status:
            notify_project_team(
                users=_project_team(project),
                notif_type='status_change',
                title=f'Project status changed: {project.name}',
                message=f'"{project.name}" is now {project.get_status_display()}.',
                project=project,
                action_url=f'/projects/{project.id}',
            )
        if old_progress != 100 and project.progress == 100:
            notify_project_team(
                users=_project_team(project),
                notif_type='timeline_complete',
                title=f'Project completed: {project.name}',
                message=f'"{project.name}" reached 100% progress.',
                project=project,
                action_url=f'/projects/{project.id}',
            )

    def perform_destroy(self, instance):
        name = instance.name
        notify_project_team(users=_project_team(instance), notif_type='status_change', title='Project deleted', message=f'The project "{name}" has been removed.')
        instance.delete()
        logger.warning('Project "%s" deleted by %s', name, self.request.user.email)

    @action(detail=False, methods=['get'], permission_classes=[IsAdmin])
    def export(self, request):
        projects = self.filter_queryset(self.get_queryset()).order_by('name').prefetch_related('resources')
        return workbook_response(
            filename='projects.xlsx',
            sheet_name='Projects',
            headers=['Name', 'Client', 'Manager', 'Status', 'Priority', 'Progress %', 'Budget', 'Spent', 'Start Date', 'End Date', 'Resources'],
            rows=[
                [
                    project.name,
                    project.client.name if project.client else '',
                    project.manager.name if project.manager else '',
                    project.status,
                    project.priority,
                    project.progress,
                    project.budget,
                    project.spent,
                    project.start_date.isoformat() if project.start_date else '',
                    project.end_date.isoformat() if project.end_date else '',
                    ', '.join(project.resources.values_list('name', flat=True)),
                ]
                for project in projects
            ],
        )

    @action(detail=True, methods=['post'], permission_classes=[IsAdminOrManager])
    def add_update(self, request, pk=None):
        project = self.get_object()
        serializer = ProjectUpdateSerializer(data={**request.data, 'project': project.id})
        serializer.is_valid(raise_exception=True)
        serializer.save(author=request.user, project=project)
        content = request.data.get('content', '')
        notify_project_team(users=_project_team(project), notif_type='update', title=f'Update on "{project.name}"', message=content[:140], project=project, action_url=f'/projects/{project.id}')
        _email_project_note(project, _project_team(project), request.user, content)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def upload_document(self, request, pk=None):
        project = self.get_object()
        serializer = ProjectDocumentSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        serializer.save(uploaded_by=request.user, project=project)
        notify_project_team(
            users=_project_team(project),
            notif_type='update',
            title=f'Document uploaded: {project.name}',
            message=f'{request.user.name} uploaded a document to "{project.name}".',
            project=project,
            action_url=f'/projects/{project.id}',
        )
        _email_project_change(
            project,
            _project_team(project),
            request.user,
            [f'- Document uploaded: {serializer.instance.name}'],
            intro='A project document was uploaded.',
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['patch'], permission_classes=[IsAdminOrManager])
    def update_progress(self, request, pk=None):
        project = self.get_object()
        try:
            value = int(request.data.get('progress'))
            if not (0 <= value <= 100):
                raise ValueError
        except (ValueError, TypeError):
            return Response({'detail': 'progress must be 0-100.'}, status=status.HTTP_400_BAD_REQUEST)
        old = project.progress
        project.progress = value
        project.save(update_fields=['progress', 'updated_at'])
        if old != value:
            _email_project_change(
                project,
                _project_team(project),
                request.user,
                [f'- Progress: {old}% -> {value}%'],
                intro='Project progress was updated.',
            )
        if old != 100 and value == 100:
            notify_project_team(users=_project_team(project), notif_type='timeline_complete', title=f'Project completed: {project.name}', message=f'"{project.name}" reached 100%.', project=project, action_url=f'/projects/{project.id}')
        return Response({'id': project.id, 'progress': project.progress})

    @action(detail=True, methods=['post'], permission_classes=[IsAdminOrManager])
    def assign_resource(self, request, pk=None):
        project = self.get_object()
        try:
            user = User.objects.get(pk=request.data.get('user_id'), role=User.Role.RESOURCE, is_active=True)
        except User.DoesNotExist:
            return Response({'detail': 'Active resource user not found.'}, status=status.HTTP_404_NOT_FOUND)
        project.resources.add(user)
        notify_project_team(users=[user], notif_type='project_assigned', title=f'Added to project: {project.name}', message=f'You have been assigned to "{project.name}".', project=project, action_url=f'/projects/{project.id}')
        _email_project_assignment(project, user, request.user)
        return Response({'detail': f'{user.name} added to project.'})

    @action(detail=True, methods=['post'], permission_classes=[IsAdminOrManager])
    def remove_resource(self, request, pk=None):
        project = self.get_object()
        try:
            user = User.objects.get(pk=request.data.get('user_id'))
        except User.DoesNotExist:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
        project.resources.remove(user)
        notify_project_team(users=[user], notif_type='status_change', title=f'Removed from project: {project.name}', message=f'You have been removed from "{project.name}".', project=project)
        return Response({'detail': f'{user.name} removed from project.'})


class ProjectApprovalViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectApprovalRequestSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = ProjectApprovalRequest.objects.select_related('project', 'requested_by', 'resolved_by')
        status_filter = self.request.query_params.get('status')
        request_type = self.request.query_params.get('request_type')
        if user.role in ADMIN_ROLES:
            scoped = qs.all()
        elif user.role == User.Role.MANAGER:
            scoped = (qs.filter(project__manager=user) | qs.filter(requested_by=user)).distinct()
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
        project = serializer.validated_data.get('project')
        if user.role not in (User.Role.MANAGER, User.Role.ADMIN):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Only managers can submit approval requests.')
        if user.role == User.Role.MANAGER and project and project.manager_id != user.pk:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('You can only request approvals for projects you manage.')
        if project:
            existing = ProjectApprovalRequest.objects.filter(
                project=project,
                requested_by=user,
                request_type=serializer.validated_data.get('request_type'),
                status=ProjectApprovalRequest.Status.PENDING,
            ).first()
            if existing:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('You already have a pending request of this type for this project.')
        req = serializer.save(requested_by=user, proposed_changes={})
        project_name = req.project.name if req.project else 'Unknown'
        logger.info('Approval request %s (%s) by %s', req.id, req.request_type, user.email)
        _notify_admins(
            title=f'Approval needed: {req.request_type.upper()} - {project_name}',
            message=f'{user.name} wants to {req.request_type} "{project_name}". Reason: {req.reason or "No reason given."}',
            action_url='/approvals',
        )

    @action(detail=True, methods=['post'], permission_classes=[IsAdmin])
    def approve(self, request, pk=None):
        req = self.get_object()
        if req.status != ProjectApprovalRequest.Status.PENDING:
            return Response({'detail': 'Already resolved.'}, status=status.HTTP_400_BAD_REQUEST)

        req.status = ProjectApprovalRequest.Status.APPROVED
        req.resolved_by = request.user
        req.resolved_at = timezone.now()
        req.admin_note = request.data.get('admin_note', '')
        req.save()

        project = req.project
        requesting_manager = req.requested_by
        project_name = project.name if project else 'project'
        admin_note_msg = req.admin_note

        if req.request_type == ProjectApprovalRequest.RequestType.DELETE and project:
            notify_project_team(users=_project_team(project), notif_type='status_change', title='Project deleted', message=f'The project "{project_name}" has been removed.')
            project.delete()
            if requesting_manager:
                notify_project_team(
                    users=[requesting_manager],
                    notif_type='update',
                    title=f'Delete approved - {project_name}',
                    message=f'Your delete request for "{project_name}" was approved and the project has been removed.' + (f' Note: {admin_note_msg}' if admin_note_msg else ''),
                    action_url='/approvals',
                )
            _email_project_approval_resolution(req, request.user, approved=True)
            return Response({'detail': 'Approved. Project deleted.'})

        if requesting_manager:
            notify_project_team(
                users=[requesting_manager],
                notif_type='update',
                title=f'Edit approved - {project_name}',
                message=f'Your edit request for "{project_name}" was approved. Go to the Approvals tab in the sidebar to apply your changes.' + (f' Note: {admin_note_msg}' if admin_note_msg else ''),
                action_url='/approvals',
            )

        _email_project_approval_resolution(req, request.user, approved=True)
        return Response({'detail': 'Approved. Manager can now apply the edit.'})

    @action(detail=True, methods=['post'], permission_classes=[IsAdmin])
    def reject(self, request, pk=None):
        req = self.get_object()
        if req.status != ProjectApprovalRequest.Status.PENDING:
            return Response({'detail': 'Already resolved.'}, status=status.HTTP_400_BAD_REQUEST)
        req.status = ProjectApprovalRequest.Status.REJECTED
        req.resolved_by = request.user
        req.resolved_at = timezone.now()
        req.admin_note = request.data.get('admin_note', '')
        req.save()
        if req.requested_by:
            project_name = req.project.name if req.project else 'project'
            notify_project_team(
                users=[req.requested_by],
                notif_type='update',
                title=f'Request rejected - {project_name}',
                message=f'Your {req.request_type} request for "{project_name}" was rejected.' + (f' Reason: {req.admin_note}' if req.admin_note else ''),
                action_url='/approvals',
            )
        _email_project_approval_resolution(req, request.user, approved=False)
        return Response({'detail': 'Rejected.'})

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def apply_edit(self, request, pk=None):
        req = self.get_object()
        user = request.user

        if req.requested_by != user:
            return Response({'detail': 'You did not make this request.'}, status=status.HTTP_403_FORBIDDEN)
        if req.request_type != ProjectApprovalRequest.RequestType.EDIT:
            return Response({'detail': 'This is not an edit request.'}, status=status.HTTP_400_BAD_REQUEST)
        if req.status != ProjectApprovalRequest.Status.APPROVED:
            return Response({'detail': 'Request not approved yet.'}, status=status.HTTP_400_BAD_REQUEST)
        if req.proposed_changes.get('_applied'):
            return Response({'detail': 'Already applied.'}, status=status.HTTP_400_BAD_REQUEST)

        project = req.project
        if not project:
            return Response({'detail': 'Project not found.'}, status=status.HTTP_404_NOT_FOUND)

        allowed_fields = {
            'name', 'description', 'status', 'priority', 'start_date', 'end_date',
            'resource_l1', 'resource_l2', 'resource_l3', 'resource_l4', 'hours', 'activity',
        }
        payload = {key: value for key, value in request.data.items() if key in allowed_fields}

        if not payload:
            return Response({'detail': 'No valid fields to update.'}, status=status.HTTP_400_BAD_REQUEST)
        previous = Project.objects.select_related('client', 'manager').get(pk=project.pk)
        serializer = ProjectDetailSerializer(project, data=payload, partial=True, context={'request': request})
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            serializer.save()
            safe_changes = json.loads(json.dumps(payload, cls=DjangoJSONEncoder))
            req.proposed_changes = {**safe_changes, '_applied': True}
            req.save(update_fields=['proposed_changes'])

        notify_project_team(
            users=_project_team(project),
            notif_type='status_change',
            title=f'Project updated: {project.name}',
            message=f'"{project.name}" was updated by {user.name}.',
            project=project,
            action_url=f'/projects/{project.id}',
        )
        _email_project_change(project, _project_team(project), user, _project_change_summary(previous, project))

        return Response({'detail': 'Edit applied successfully.'})

    @action(detail=False, methods=['get'])
    def pending_count(self, request):
        user = request.user
        if user.role in ADMIN_ROLES:
            count = ProjectApprovalRequest.objects.filter(status=ProjectApprovalRequest.Status.PENDING).count()
        elif user.role == User.Role.MANAGER:
            count = ProjectApprovalRequest.objects.filter(
                requested_by=user,
                request_type=ProjectApprovalRequest.RequestType.EDIT,
                status=ProjectApprovalRequest.Status.APPROVED,
            ).exclude(proposed_changes__has_key='_applied').count()
        else:
            count = 0
        return Response({'count': count})

    @action(detail=False, methods=['post'])
    def mark_all_read(self, request):
        return Response({'detail': 'Marked as read.', 'count': 0})
