"""clients/serializers.py"""
import os
from rest_framework import serializers
from django.conf import settings
from accounts.models import User
from .models import Client, ClientContact

# Fields a non-privileged 'resource' user is allowed to see — just enough to
# identify a client in a dropdown. All contact PII is withheld.
RESOURCE_SAFE_CLIENT_FIELDS = {'id', 'name', 'industry', 'website', 'status', 'logo_url', 'project_count'}


class ClientContactSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ClientContact
        fields = ['id', 'name', 'email', 'phone', 'position', 'is_primary']


class ClientSerializer(serializers.ModelSerializer):
    onboarded_by_name = serializers.CharField(source='onboarded_by.name', read_only=True)
    project_count     = serializers.IntegerField(source='projects.count', read_only=True)
    contacts          = ClientContactSerializer(many=True, read_only=True)
    logo_url          = serializers.SerializerMethodField()

    class Meta:
        model  = Client
        fields = [
            'id', 'name', 'email', 'email2', 'phone', 'phone2', 'industry', 'address',
            'contact_person', 'contact_person2', 'website', 'notes', 'status', 'logo', 'logo_url',
            'onboarded_by', 'onboarded_by_name', 'onboarded_at', 'updated_at',
            'portal_user', 'project_count', 'contacts',
        ]
        read_only_fields = ['id', 'onboarded_by', 'onboarded_at', 'updated_at']
        extra_kwargs = {'logo': {'write_only': True, 'required': False}}

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        # Resources get a PII-free view (dropdown identification only).
        if user is not None and getattr(user, 'role', None) == User.Role.RESOURCE:
            return {k: v for k, v in data.items() if k in RESOURCE_SAFE_CLIENT_FIELDS}
        return data

    def get_logo_url(self, obj):
        request = self.context.get('request')
        if obj.logo and hasattr(obj.logo, 'url') and request:
            return request.build_absolute_uri(obj.logo.url)
        return None

    def validate_logo(self, value):
        if value:
            ext = os.path.splitext(value.name)[1].lower()
            if ext not in settings.ALLOWED_IMAGE_EXTENSIONS:
                raise serializers.ValidationError('Unsupported image format.')
            if value.size > settings.MAX_AVATAR_SIZE_MB * 1024 * 1024:
                raise serializers.ValidationError(
                    f'Logo must be under {settings.MAX_AVATAR_SIZE_MB} MB.'
                )
        return value