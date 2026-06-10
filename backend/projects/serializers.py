import os

from django.conf import settings
from rest_framework import serializers

from accounts.serializers import UserSerializer
from clients.serializers import ClientSerializer
from .models import Project, ProjectApprovalRequest, ProjectDocument, ProjectUpdate


class ProjectUpdateSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source='author.name', read_only=True)

    class Meta:
        model = ProjectUpdate
        fields = ['id', 'project', 'author', 'author_name', 'content', 'created_at']
        read_only_fields = ['id', 'author', 'created_at']


class ProjectDocumentSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.CharField(source='uploaded_by.name', read_only=True)
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = ProjectDocument
        fields = ['id', 'project', 'uploaded_by', 'uploaded_by_name', 'name', 'file', 'file_url', 'file_size', 'uploaded_at']
        read_only_fields = ['id', 'uploaded_by', 'file_size', 'uploaded_at']
        extra_kwargs = {'file': {'write_only': True}}

    def get_file_url(self, obj):
        if obj.file and hasattr(obj.file, 'url'):
            from django.conf import settings as django_settings
            base = django_settings.BACKEND_URL.rstrip('/')
            return f"{base}{obj.file.url}"
        return None

    def validate_file(self, value):
        # Strip any directory components — never trust the client-supplied name.
        base = os.path.basename((value.name or '').replace('\\', '/'))
        if not base or base in ('.', '..') or '\x00' in base:
            raise serializers.ValidationError('Invalid file name.')
        value.name = base
        ext = os.path.splitext(base)[1].lower()
        allowed = settings.ALLOWED_IMAGE_EXTENSIONS + settings.ALLOWED_DOCUMENT_EXTENSIONS
        if ext not in allowed:
            raise serializers.ValidationError(f'File type "{ext}" is not allowed.')
        if value.size > settings.MAX_DOCUMENT_SIZE_MB * 1024 * 1024:
            raise serializers.ValidationError(f'File must be under {settings.MAX_DOCUMENT_SIZE_MB} MB.')
        return value


class ProjectListSerializer(serializers.ModelSerializer):
    client = serializers.IntegerField(source='client_id', read_only=True)
    client_name = serializers.CharField(source='client.name', read_only=True)
    manager_name = serializers.CharField(source='manager.name', read_only=True)
    resource_count = serializers.IntegerField(read_only=True)
    budget_utilization = serializers.ReadOnlyField()
    is_over_budget = serializers.ReadOnlyField()
    submitted_hours = serializers.DecimalField(source='submitted_hours_value', max_digits=10, decimal_places=2, read_only=True)
    approved_hours = serializers.DecimalField(source='approved_hours_value', max_digits=10, decimal_places=2, read_only=True)
    pending_hours = serializers.DecimalField(source='pending_hours_value', max_digits=10, decimal_places=2, read_only=True)
    remaining_hours = serializers.DecimalField(source='remaining_hours_value', max_digits=10, decimal_places=2, read_only=True)

    class Meta:
        model = Project
        fields = [
            'id', 'name', 'description', 'status', 'priority', 'progress',
            'start_date', 'end_date', 'budget', 'spent',
            'resource_l1', 'resource_l2', 'resource_l3', 'resource_l4',
            'hours', 'activity',
            'client', 'client_name', 'manager_name', 'resource_count',
            'budget_utilization', 'is_over_budget', 'submitted_hours', 'approved_hours', 'pending_hours', 'remaining_hours',
            'tags', 'created_at',
        ]


class ProjectDetailSerializer(serializers.ModelSerializer):
    client_detail = ClientSerializer(source='client', read_only=True)
    manager_detail = UserSerializer(source='manager', read_only=True)
    resource_details = UserSerializer(source='resources', many=True, read_only=True)
    updates = ProjectUpdateSerializer(many=True, read_only=True)
    documents = ProjectDocumentSerializer(many=True, read_only=True)
    budget_utilization = serializers.ReadOnlyField()
    is_over_budget = serializers.ReadOnlyField()
    timelines_count = serializers.SerializerMethodField()
    submitted_hours = serializers.DecimalField(source='submitted_hours_value', max_digits=10, decimal_places=2, read_only=True)
    approved_hours = serializers.DecimalField(source='approved_hours_value', max_digits=10, decimal_places=2, read_only=True)
    pending_hours = serializers.DecimalField(source='pending_hours_value', max_digits=10, decimal_places=2, read_only=True)
    remaining_hours = serializers.DecimalField(source='remaining_hours_value', max_digits=10, decimal_places=2, read_only=True)

    class Meta:
        model = Project
        fields = [
            'id', 'name', 'description', 'client', 'client_detail',
            'manager', 'manager_detail', 'resources', 'resource_details',
            'start_date', 'end_date', 'budget', 'spent',
            'resource_l1', 'resource_l2', 'resource_l3', 'resource_l4',
            'hours', 'activity',
            'status', 'priority', 'progress', 'tags',
            'budget_utilization', 'is_over_budget', 'timelines_count',
            'submitted_hours', 'approved_hours', 'pending_hours', 'remaining_hours',
            'created_by', 'created_at', 'updated_at',
            'updates', 'documents',
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']

    def get_timelines_count(self, obj):
        return obj.timelines.count()

    def validate(self, attrs):
        start = attrs.get('start_date', getattr(self.instance, 'start_date', None))
        end = attrs.get('end_date', getattr(self.instance, 'end_date', None))
        if start and end and start > end:
            raise serializers.ValidationError({'end_date': 'End date must be after start date.'})
        return attrs


class ProjectApprovalRequestSerializer(serializers.ModelSerializer):
    requested_by_name = serializers.CharField(source='requested_by.name', read_only=True)
    resolved_by_name = serializers.CharField(source='resolved_by.name', read_only=True)
    project_name = serializers.CharField(source='project.name', read_only=True)
    project_detail = serializers.SerializerMethodField()

    class Meta:
        model = ProjectApprovalRequest
        fields = [
            'id', 'project', 'project_name', 'project_detail', 'request_type', 'status',
            'reason', 'proposed_changes', 'admin_note',
            'requested_by', 'requested_by_name',
            'resolved_by', 'resolved_by_name',
            'created_at', 'resolved_at',
        ]
        read_only_fields = ['id', 'status', 'requested_by', 'resolved_by', 'created_at', 'resolved_at', 'admin_note']

    def get_project_detail(self, obj):
        p = obj.project
        if not p:
            return None
        return {
            'name': p.name,
            'description': p.description,
            'status': p.status,
            'priority': p.priority,
            'start_date': str(p.start_date) if p.start_date else '',
            'end_date': str(p.end_date) if p.end_date else '',
            'resource_l1': p.resource_l1,
            'resource_l2': p.resource_l2,
            'resource_l3': p.resource_l3,
            'resource_l4': p.resource_l4,
            'hours': str(p.hours) if p.hours else '',
            'activity': p.activity,
        }
