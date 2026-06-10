import hashlib
import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models
from django.utils import timezone

logger = logging.getLogger("nexus")

phone_validator = RegexValidator(
    regex=r'^\+?1?\d{9,15}$',
    message='Phone number must be entered in the format: +999999999. Up to 15 digits.'
)


def normalize_company_email(email: str) -> str:
    return BaseUserManager.normalize_email(email.strip().lower())


def validate_company_email(email: str) -> str:
    email = normalize_company_email(email)
    domain = getattr(settings, 'ALLOWED_USER_EMAIL_DOMAIN', 'astracybertech.com').strip().lower().lstrip('@')
    if not email.endswith(f'@{domain}'):
        raise ValidationError({'email': f'Only @{domain} email addresses are allowed.'})
    return email


class UserManager(BaseUserManager):
    def create_user(self, email: str, password: str, **extra_fields):
        if not email:
            raise ValueError('Email address is required.')
        if not password:
            raise ValueError('Password is required.')
        email = validate_company_email(email)
        extra_fields.setdefault('is_active', True)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.full_clean()
        user.save(using=self._db)
        logger.info('Created user %s (%s)', user.email, user.role)
        return user

    def create_superuser(self, email: str, password: str, **extra_fields):
        extra_fields.setdefault('role', User.Role.ADMIN)
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        if extra_fields.get('is_staff') is not True:
            raise ValueError('Superuser must have is_staff=True.')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Superuser must have is_superuser=True.')
        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    class Role(models.TextChoices):
        ADMIN = 'admin', 'Admin'
        LEADERSHIP = 'leadership', 'Leadership'
        MANAGER = 'manager', 'Project Manager'
        RESOURCE = 'resource', 'Resource'
        CLIENT = 'client', 'Client'

    email = models.EmailField(unique=True, db_index=True)
    name = models.CharField(max_length=150)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.RESOURCE, db_index=True)
    department = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=20, blank=True, validators=[phone_validator])
    bio = models.TextField(blank=True, max_length=500)
    avatar = models.ImageField(upload_to='avatars/%Y/%m/', null=True, blank=True)
    two_factor_enabled = models.BooleanField(default=True)

    is_active = models.BooleanField(default=True, db_index=True)
    is_staff = models.BooleanField(default=False)

    date_joined = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    last_seen = models.DateTimeField(null=True, blank=True)

    objects = UserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['name']

    class Meta:
        ordering = ['name']
        verbose_name = 'User'
        indexes = [models.Index(fields=['email', 'role'])]

    def __str__(self):
        return f'{self.name} <{self.email}>'

    def clean(self):
        self.email = validate_company_email(self.email)
        self.name = self.name.strip()
        if not self.name:
            raise ValidationError({'name': 'Name cannot be blank.'})

    def save(self, *args, **kwargs):
        if self.is_superuser:
            self.is_staff = True
        elif self.role in (self.Role.ADMIN, self.Role.LEADERSHIP):
            self.is_staff = True
        else:
            self.is_staff = False
        super().save(*args, **kwargs)

    @property
    def initials(self) -> str:
        parts = self.name.split()
        return ''.join(p[0].upper() for p in parts[:2])

    def touch(self):
        User.objects.filter(pk=self.pk).update(last_seen=timezone.now())


class RolePermission(models.Model):
    """
    Per-role permission matrix, editable at runtime by admins/managers.
    Schema: {page_key: bool}  e.g. {"dashboard": true, "clients": false}
    """
    role = models.CharField(max_length=20, choices=User.Role.choices, unique=True)
    permissions = models.JSONField(default=dict)
    updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='+', limit_choices_to={'role__in': ['admin', 'leadership', 'manager']}
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Role Permission'

    def __str__(self):
        return f'Permissions [{self.role}]'

    @classmethod
    def defaults(cls):
        return {
            User.Role.ADMIN: {'dashboard': True, 'clients': True, 'projects': True, 'timelines': True, 'resources': True, 'chat': True, 'reports': True, 'access_control': True},
            User.Role.LEADERSHIP: {'dashboard': True, 'clients': True, 'projects': True, 'timelines': True, 'resources': True, 'chat': True, 'reports': True, 'access_control': True },
            User.Role.MANAGER: {'dashboard': True, 'clients': True, 'projects': True, 'timelines': True, 'resources': True, 'chat': True, 'reports': True, 'access_control': False},
            User.Role.RESOURCE: {'dashboard': True, 'clients': False, 'projects_view': True, 'timelines_view': True, 'chat': True, 'reports': False, 'access_control': False},
            User.Role.CLIENT: {'dashboard': True, 'projects_view': True, 'timelines_view': True, 'chat': False, 'reports': False, 'access_control': False},
        }

    @classmethod
    def get_for_role(cls, role: str) -> dict:
        try:
            return cls.objects.get(role=role).permissions
        except cls.DoesNotExist:
            return cls.defaults().get(role, {})


class LoginOTPChallenge(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='login_challenges')
    challenge_id = models.CharField(max_length=64, unique=True, default=secrets.token_urlsafe)
    code_hash = models.CharField(max_length=64)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['challenge_id', 'expires_at'])]

    def __str__(self):
        return f'OTP challenge for {self.user.email} at {self.created_at.isoformat()}'

    @staticmethod
    def hash_code(code: str) -> str:
        return hashlib.sha256(code.encode('utf-8')).hexdigest()

    @classmethod
    def create_for_user(cls, user, code: str, ttl_seconds: int = 90):
        cls.objects.filter(user=user, consumed_at__isnull=True, expires_at__gt=timezone.now()).update(consumed_at=timezone.now())
        return cls.objects.create(
            user=user,
            code_hash=cls.hash_code(code),
            expires_at=timezone.now() + timedelta(seconds=ttl_seconds),
            challenge_id=secrets.token_urlsafe(24),
        )

    def is_expired(self) -> bool:
        return self.expires_at <= timezone.now()

    def verify(self, code: str) -> bool:
        return self.code_hash == self.hash_code(code)

    @classmethod
    def purge_stale(cls, older_than_hours: int = 24) -> int:
        """Delete consumed or long-expired challenges to keep the table lean.

        Returns the number of rows removed. Safe to run repeatedly.
        """
        cutoff = timezone.now() - timedelta(hours=older_than_hours)
        stale = cls.objects.filter(expires_at__lt=cutoff) | cls.objects.filter(consumed_at__lt=cutoff)
        deleted, _ = stale.distinct().delete()
        return deleted
