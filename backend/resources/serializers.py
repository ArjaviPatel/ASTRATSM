from datetime import datetime, timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from accounts.models import User, validate_company_email
from accounts.serializers import UserSerializer
from timelines.models import Timeline
from .models import ResourceProfile, TimeEntry, TimesheetLateEntryApproval


class ResourceProfileSerializer(serializers.ModelSerializer):
    user_detail = UserSerializer(source='user', read_only=True)
    manager_detail = UserSerializer(source='manager', read_only=True)
    name = serializers.CharField(source='user.name')
    email = serializers.EmailField(source='user.email')
    password = serializers.CharField(write_only=True, required=False, allow_blank=False)
    total_hours_logged = serializers.DecimalField(source='total_hours_value', max_digits=10, decimal_places=2, read_only=True)
    approved_hours_logged = serializers.DecimalField(source='approved_hours_value', max_digits=10, decimal_places=2, read_only=True)
    pending_hours_logged = serializers.DecimalField(source='pending_hours_value', max_digits=10, decimal_places=2, read_only=True)
    active_project_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = ResourceProfile
        fields = [
            'id', 'user', 'user_detail',
            'name', 'email', 'password',
            'resource_id', 'level', 'manager', 'manager_detail',
            'skills', 'hourly_rate', 'availability',
            'total_hours_logged', 'approved_hours_logged', 'pending_hours_logged', 'active_project_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'user', 'created_at', 'updated_at']
        extra_kwargs = {
            'manager': {'required': False, 'allow_null': True},
        }

    def validate_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError('Name must be at least 2 characters.')
        return value

    def validate_email(self, value):
        try:
            value = validate_company_email(value)
        except DjangoValidationError as exc:
            detail = exc.message_dict.get('email', exc.messages) if hasattr(exc, 'message_dict') else exc.messages
            raise serializers.ValidationError(detail[0] if isinstance(detail, list) else detail)
        qs = User.objects.filter(email=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.user_id)
        if qs.exists():
            raise serializers.ValidationError('A user with this email already exists.')
        return value

    def validate_resource_id(self, value):
        if not value:
            return value
        value = value.strip()
        qs = ResourceProfile.objects.filter(resource_id=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('This Resource ID is already in use.')
        return value

    def create(self, validated_data):
        user_data = validated_data.pop('user')
        password = validated_data.pop('password', None)
        if not password:
            raise serializers.ValidationError({'password': 'Password is required.'})

        with transaction.atomic():
            user = User.objects.create_user(
                email=user_data['email'],
                password=password,
                name=user_data['name'],
                role=User.Role.RESOURCE,
            )
            profile, _ = ResourceProfile.objects.update_or_create(user=user, defaults=validated_data)
        return profile

    def update(self, instance, validated_data):
        user_data = validated_data.pop('user', {})
        password = validated_data.pop('password', None)

        with transaction.atomic():
            user = instance.user
            if 'name' in user_data:
                user.name = user_data['name']
            if 'email' in user_data:
                user.email = user_data['email']
            if password:
                user.set_password(password)
            user.save()

            for attr, value in validated_data.items():
                setattr(instance, attr, value)
            instance.save()

        return instance


class TimeEntrySerializer(serializers.ModelSerializer):
    resource_name = serializers.CharField(source='resource.user.name', read_only=True)
    project_name = serializers.CharField(source='project.name', read_only=True)
    project_client_name = serializers.CharField(source='project.client.name', read_only=True)
    timeline_name = serializers.CharField(source='timeline.name', read_only=True)
    resource_user = serializers.IntegerField(source='resource.user_id', read_only=True)

    class Meta:
        model = TimeEntry
        fields = [
            'id', 'resource', 'resource_user', 'resource_name', 'project', 'project_name', 'timeline', 'timeline_name',
            'project_client_name', 'date', 'start_time', 'end_time', 'hours', 'description', 'approved', 'approved_by',
            'approved_at', 'created_at',
        ]
        read_only_fields = ['id', 'approved', 'approved_by', 'approved_at', 'created_at']
        extra_kwargs = {
            'resource': {'required': False},
            'timeline': {'required': False, 'allow_null': True},
        }

    def validate_hours(self, value):
        if value < 0.25:
            raise serializers.ValidationError('Minimum entry is 0.25 hours (15 minutes).')
        if value > 24:
            raise serializers.ValidationError('Cannot log more than 24 hours in a single entry.')
        return value

    def validate(self, attrs):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user and user.is_authenticated and user.role == 'resource' and 'resource' not in attrs:
            if not hasattr(user, 'resource_profile'):
                raise serializers.ValidationError('Your account does not have a resource profile.')
            attrs['resource'] = user.resource_profile

        resource = attrs.get('resource') or getattr(self.instance, 'resource', None)
        project = attrs.get('project') or getattr(self.instance, 'project', None)
        timeline = attrs.get('timeline') if 'timeline' in attrs else getattr(self.instance, 'timeline', None)
        entry_date = attrs.get('date') or getattr(self.instance, 'date', None)
        start_time = attrs.get('start_time') if 'start_time' in attrs else getattr(self.instance, 'start_time', None)
        end_time = attrs.get('end_time') if 'end_time' in attrs else getattr(self.instance, 'end_time', None)

        if entry_date and entry_date > timezone.localdate():
            raise serializers.ValidationError({'date': 'Time entries cannot be logged in the future.'})

        if start_time and end_time:
            start_dt = datetime.combine(entry_date, start_time) if entry_date else None
            end_dt = datetime.combine(entry_date, end_time) if entry_date else None
            if start_dt and end_dt:
                if end_dt <= start_dt:
                    raise serializers.ValidationError({'end_time': 'End time must be after start time.'})
                duration = Decimal(str((end_dt - start_dt).total_seconds() / 3600)).quantize(Decimal('0.01'))
                if duration < Decimal('0.25'):
                    raise serializers.ValidationError({'end_time': 'Minimum entry is 15 minutes.'})
                if duration > Decimal('24'):
                    raise serializers.ValidationError({'end_time': 'Cannot log more than 24 hours in a single entry.'})
                attrs['hours'] = duration

        if timeline:
            if not project:
                project = timeline.project
                attrs['project'] = project
            if timeline.project_id != project.id:
                raise serializers.ValidationError({'timeline': 'Selected phase does not belong to the selected project.'})

        if user and user.is_authenticated and user.role == 'resource':
            if not hasattr(user, 'resource_profile'):
                raise serializers.ValidationError('Your account does not have a resource profile.')
            if resource and resource.pk != user.resource_profile.pk:
                raise serializers.ValidationError({'resource': 'You can only log time for yourself.'})
            if entry_date and entry_date.weekday() < 5:
                cutoff = timezone.now() - timedelta(hours=48)
                entry_end = datetime.combine(entry_date, end_time or datetime.max.time())
                entry_end = timezone.make_aware(entry_end, timezone.get_current_timezone())
                approved_backfill = TimesheetLateEntryApproval.objects.filter(
                    resource=user.resource_profile,
                    date=entry_date,
                    status=TimesheetLateEntryApproval.Status.APPROVED,
                ).exists()
                if entry_end < cutoff and not approved_backfill:
                    raise serializers.ValidationError({
                        'date': 'Entries older than 48 hours require manager approval for this date.'
                    })

        return attrs


class TimesheetLateEntryApprovalSerializer(serializers.ModelSerializer):
    resource_name = serializers.CharField(source='resource.user.name', read_only=True)
    requested_by_name = serializers.CharField(source='requested_by.name', read_only=True)
    resolved_by_name = serializers.CharField(source='resolved_by.name', read_only=True)

    class Meta:
        model = TimesheetLateEntryApproval
        fields = [
            'id', 'resource', 'resource_name', 'date', 'reason',
            'status', 'admin_note',
            'requested_by', 'requested_by_name',
            'resolved_by', 'resolved_by_name',
            'resolved_at', 'created_at',
        ]
        read_only_fields = [
            'id', 'status', 'admin_note',
            'requested_by', 'requested_by_name',
            'resolved_by', 'resolved_by_name',
            'resolved_at', 'created_at',
        ]
        extra_kwargs = {
            'resource': {'required': False},
        }

    def validate(self, attrs):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        resource = attrs.get('resource')
        date = attrs.get('date')

        if not user or not user.is_authenticated:
            raise serializers.ValidationError('Authentication required.')
        if user.role == User.Role.RESOURCE:
            if not hasattr(user, 'resource_profile'):
                raise serializers.ValidationError('Your account does not have a resource profile.')
            attrs['resource'] = user.resource_profile
            resource = attrs['resource']
        if not resource:
            raise serializers.ValidationError({'resource': 'Resource is required.'})
        if date:
            entry_end = timezone.make_aware(
                datetime.combine(date, datetime.max.time()),
                timezone.get_current_timezone(),
            )
            if entry_end >= timezone.now() - timedelta(hours=48):
                raise serializers.ValidationError({'date': 'Approval is only needed for entries older than 48 hours.'})
            if date.weekday() >= 5:
                raise serializers.ValidationError({'date': 'Late entry approval is only required for weekdays.'})
            existing = TimesheetLateEntryApproval.objects.filter(resource=resource, date=date).order_by('-created_at').first()
            if existing:
                if existing.status == TimesheetLateEntryApproval.Status.PENDING:
                    raise serializers.ValidationError({'date': 'A manager approval request is already pending for this date.'})
                if existing.status == TimesheetLateEntryApproval.Status.APPROVED:
                    raise serializers.ValidationError({'date': 'This date is already approved. You can submit the timesheet now.'})
        return attrs