"""
nexus/settings.py
Production-grade Django settings for Nexus CRM.
ALL sensitive values come exclusively from environment variables — no fallback
secrets.  Run `python manage.py check --deploy` before going live.
"""
import os
from pathlib import Path
from datetime import timedelta
from decouple import config, Csv, UndefinedValueError
import sentry_sdk
from sentry_sdk.integrations.django import DjangoIntegration
# //module name for importing .Env
import environ as environ
from environ import Env

env = Env()

BASE_DIR = Path(__file__).resolve().parent.parent

# ─── CORE ────────────────────────────────────────────────────────────────────
# SECRET_KEY must be set in env — no insecure fallback
SECRET_KEY = config('SECRET_KEY')

DEBUG = config('DEBUG', default=False, cast=bool)

ALLOWED_HOSTS = config('ALLOWED_HOSTS', cast=Csv())

# Base URL for building absolute media URLs (set your actual IP in .env)
# e.g. BACKEND_URL=http://192.168.1.10:8000
BACKEND_URL = config('BACKEND_URL', default='http://localhost:8000')
FRONTEND_URL = config('FRONTEND_URL', default='http://localhost:5173')

# ─── APPS ────────────────────────────────────────────────────────────────────
DJANGO_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
]

THIRD_PARTY_APPS = [
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',
    'django_filters',
    'drf_spectacular',
    'channels',
    'django_extensions',
    'django_celery_beat',  # DB-backed Celery Beat scheduler (see CELERY_BEAT_SCHEDULER)
]

LOCAL_APPS = [
    'accounts.apps.AccountsConfig',
    'clients.apps.ClientsConfig',
    'projects.apps.ProjectsConfig',
    'timelines.apps.TimelinesConfig',
    'resources.apps.ResourcesConfig',
    'chat.apps.ChatConfig',
    'notifications.apps.NotificationsConfig',
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'accounts.middleware.LastSeenMiddleware',
]

ROOT_URLCONF    = 'nexus.urls'
WSGI_APPLICATION = 'nexus.wsgi.application'
ASGI_APPLICATION = 'nexus.asgi.application'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

# ─── DATABASE ─────────────────────────────────────────────────────────────────
DATABASES = {
    'default': {
        'ENGINE':   'django.db.backends.postgresql',
        'NAME':     config('DB_NAME'),
        'USER':     config('DB_USER'),
        'PASSWORD': config('DB_PASSWORD'),
        'HOST':     config('DB_HOST'),
        'PORT':     config('DB_PORT', default='5432'),
        'CONN_MAX_AGE': 60,
        'OPTIONS': {
            'connect_timeout': 10,
            'options': r'-c default_transaction_isolation=read\ committed',
        },
    }
}

# ─── AUTH ──────────────────────────────────────────────────────────────────────
AUTH_USER_MODEL = 'accounts.User'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
     'OPTIONS': {'min_length': 8}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# ─── REST FRAMEWORK ────────────────────────────────────────────────────────────
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    'DEFAULT_PAGINATION_CLASS': 'nexus.pagination.StandardResultsPagination',
    'PAGE_SIZE': 25,
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '20/min',
        'user': '300/min',
        'login': '10/min',
        'chat_poll': '60/min',    # polling — 1/sec per user
        'chat_send': '30/min',    # sending — max 30 messages/min
    },
    'EXCEPTION_HANDLER': 'nexus.exceptions.custom_exception_handler',
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
    # Only BrowsableAPI in DEBUG
    **(
        {'DEFAULT_RENDERER_CLASSES': [
            'rest_framework.renderers.JSONRenderer',
            'rest_framework.renderers.BrowsableAPIRenderer',
        ]} if DEBUG else {}
    ),
}

# ─── JWT ───────────────────────────────────────────────────────────────────────
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME':      timedelta(hours=8),
    'REFRESH_TOKEN_LIFETIME':     timedelta(days=30),
    'ROTATE_REFRESH_TOKENS':      True,
    'BLACKLIST_AFTER_ROTATION':   True,
    'UPDATE_LAST_LOGIN':          True,
    'ALGORITHM':                  'HS256',
    'AUTH_HEADER_TYPES':          ('Bearer',),
    'AUTH_HEADER_NAME':           'HTTP_AUTHORIZATION',
    'USER_ID_FIELD':              'id',
    'USER_ID_CLAIM':              'user_id',
    'TOKEN_OBTAIN_SERIALIZER':    'accounts.serializers.CustomTokenObtainPairSerializer',
}

# ─── CORS ──────────────────────────────────────────────────────────────────────
CORS_ALLOWED_ORIGINS     = config('CORS_ALLOWED_ORIGINS', cast=Csv())
CORS_ALLOW_CREDENTIALS   = True
CORS_ALLOW_HEADERS = [
    'accept', 'accept-encoding', 'authorization',
    'content-type', 'dnt', 'origin', 'user-agent',
    'x-csrftoken', 'x-requested-with',
]

# ─── CHANNELS ──────────────────────────────────────────────────────────────────
# Redis is optional — falls back to in-memory (no WebSocket cross-process sync,
# but everything else works fine without Redis).
try:
    _REDIS_URL = config('REDIS_URL')
    _REDIS_AVAILABLE = True
except UndefinedValueError:
    _REDIS_URL = None
    _REDIS_AVAILABLE = False

if _REDIS_AVAILABLE:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG':  {'hosts': [_REDIS_URL]},
        }
    }
    CACHES = {
        'default': {
            'BACKEND':  'django.core.cache.backends.redis.RedisCache',
            'LOCATION': _REDIS_URL,
            'TIMEOUT':  300,
        }
    }
    SESSION_ENGINE      = 'django.contrib.sessions.backends.cache'
    SESSION_CACHE_ALIAS = 'default'
else:
    # In-process channel layer — chat still works on single-worker deployments
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels.layers.InMemoryChannelLayer',
        }
    }
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
            'TIMEOUT': 300,
        }
    }
    SESSION_ENGINE = 'django.contrib.sessions.backends.db'

# ─── SESSION ───────────────────────────────────────────────────────────────────
SESSION_COOKIE_SECURE   = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'

# ─── SECURITY ──────────────────────────────────────────────────────────────────
SECURE_BROWSER_XSS_FILTER       = True
SECURE_CONTENT_TYPE_NOSNIFF     = True
SECURE_HSTS_SECONDS             = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS  = True
SECURE_HSTS_PRELOAD             = True
SECURE_SSL_REDIRECT             = config('SECURE_SSL_REDIRECT', default=True, cast=bool)
SECURE_PROXY_SSL_HEADER         = ('HTTP_X_FORWARDED_PROTO', 'https')
X_FRAME_OPTIONS                 = 'DENY'
CSRF_COOKIE_SECURE              = True
CSRF_COOKIE_HTTPONLY            = True

# ─── STATIC & MEDIA ────────────────────────────────────────────────────────────
STATIC_URL  = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

# Media — use S3 in production
USE_S3 = config('USE_S3', default=False, cast=bool)
if USE_S3:
    DEFAULT_FILE_STORAGE    = 'storages.backends.s3boto3.S3Boto3Storage'
    AWS_ACCESS_KEY_ID       = config('AWS_ACCESS_KEY_ID')
    AWS_SECRET_ACCESS_KEY   = config('AWS_SECRET_ACCESS_KEY')
    AWS_STORAGE_BUCKET_NAME = config('AWS_STORAGE_BUCKET_NAME')
    AWS_S3_REGION_NAME      = config('AWS_S3_REGION_NAME', default='us-east-1')
    AWS_S3_FILE_OVERWRITE   = False
    AWS_DEFAULT_ACL         = None
    MEDIA_URL               = f'https://{AWS_STORAGE_BUCKET_NAME}.s3.amazonaws.com/'
else:
    MEDIA_URL  = '/media/'
    MEDIA_ROOT = BASE_DIR / 'media'

# ─── EMAIL ─────────────────────────────────────────────────────────────────────
EMAIL_BACKEND       = config('EMAIL_BACKEND', default='django.core.mail.backends.smtp.EmailBackend')
EMAIL_HOST          = config('EMAIL_HOST',     default='smtp.gmail.com')
EMAIL_PORT          = config('EMAIL_PORT',     default=587, cast=int)
EMAIL_USE_TLS       = config('EMAIL_USE_TLS',  default=True, cast=bool)
EMAIL_HOST_USER     = config('EMAIL_HOST_USER',     default='')
EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='')
DEFAULT_FROM_EMAIL  = config('DEFAULT_FROM_EMAIL',  default='noreply@nexuscrm.io')
ALLOWED_USER_EMAIL_DOMAIN = config('ALLOWED_USER_EMAIL_DOMAIN', default='astracybertech.com').strip().lower().lstrip('@')

MS_GRAPH_TENANT_ID = config('MS_GRAPH_TENANT_ID', default='')
MS_GRAPH_CLIENT_ID = config('MS_GRAPH_CLIENT_ID', default='')
MS_GRAPH_CLIENT_SECRET = config('MS_GRAPH_CLIENT_SECRET', default='')
MS_GRAPH_SENDER_EMAIL = config('MS_GRAPH_SENDER_EMAIL', default='')
LOGIN_OTP_TTL_SECONDS = config('LOGIN_OTP_TTL_SECONDS', default=90, cast=int)
LOGIN_OTP_LENGTH = config('LOGIN_OTP_LENGTH', default=6, cast=int)

# ─── LOGGING ───────────────────────────────────────────────────────────────────
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {process:d} {thread:d} {message}',
            'style': '{',
        },
        'simple': {'format': '{levelname} {asctime} {message}', 'style': '{'},
    },
    'filters': {
        'require_debug_false': {'()': 'django.utils.log.RequireDebugFalse'},
        'require_debug_true':  {'()': 'django.utils.log.RequireDebugTrue'},
    },
    'handlers': {
        'console': {
            'level': 'INFO',
            'class': 'logging.StreamHandler',
            'formatter': 'simple',
        },
        'file': {
            'level': 'WARNING',
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': BASE_DIR / 'logs' / 'nexus.log',
            'maxBytes': 10 * 1024 * 1024,  # 10 MB
            'backupCount': 10,
            'formatter': 'verbose',
        },
        'security_file': {
            'level': 'WARNING',
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': BASE_DIR / 'logs' / 'security.log',
            'maxBytes': 5 * 1024 * 1024,
            'backupCount': 5,
            'formatter': 'verbose',
        },
    },
    'root': {'handlers': ['console'], 'level': 'INFO'},
    'loggers': {
        'django':           {'handlers': ['console', 'file'], 'level': 'INFO', 'propagate': False},
        'django.security':  {'handlers': ['security_file'],   'level': 'WARNING', 'propagate': False},
        'nexus':            {'handlers': ['console', 'file'], 'level': 'DEBUG', 'propagate': False},
    },
}

# ─── SENTRY ────────────────────────────────────────────────────────────────────
SENTRY_DSN = config('SENTRY_DSN', default='')
if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[DjangoIntegration()],
        traces_sample_rate=0.1,
        send_default_pii=False,
        environment=config('ENVIRONMENT', default='production'),
    )

# ─── API DOCS ──────────────────────────────────────────────────────────────────
SPECTACULAR_SETTINGS = {
    'TITLE':                'Nexus CRM API',
    'DESCRIPTION':          'Production-grade Project Management CRM REST API',
    'VERSION':              '1.0.0',
    'SERVE_INCLUDE_SCHEMA': False,
    'SERVE_PERMISSIONS':    ['rest_framework.permissions.IsAdminUser'],
    'SCHEMA_PATH_PREFIX':   '/api/v1/',
    'COMPONENT_SPLIT_REQUEST': True,
}

# ─── I18N ──────────────────────────────────────────────────────────────────────
LANGUAGE_CODE = 'en-us'
# Set TIME_ZONE in .env to your local zone (e.g. 'Asia/Kolkata') so Celery Beat
# reminder times like 17:30 mean 5:30 PM LOCAL, not 5:30 PM UTC.
TIME_ZONE     = config('TIME_ZONE', default='UTC')
USE_I18N      = True
USE_TZ        = True

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ─── APP CONFIG ────────────────────────────────────────────────────────────────
# Max file upload size: 10 MB
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024

ALLOWED_IMAGE_EXTENSIONS  = ['.jpg', '.jpeg', '.png', '.webp']
ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.zip']
MAX_AVATAR_SIZE_MB         = 2
MAX_DOCUMENT_SIZE_MB       = 10
# ── Celery ────────────────────────────────────────────────────────────
# Broker: Redis (same Redis you likely already use for Channels)
# Change the URL/db number if needed.
CELERY_BROKER_URL = env('CELERY_BROKER_URL', default='redis://localhost:6379/1')
 
# Store task results in Redis (optional but useful for debugging)
CELERY_RESULT_BACKEND = env('CELERY_RESULT_BACKEND', default='redis://localhost:6379/2')
 
# IMPORTANT: set this to YOUR timezone so 17:30 means 5:30 PM local time,
# not 5:30 PM UTC.
CELERY_TIMEZONE = TIME_ZONE   # reuse Django's TIME_ZONE setting (e.g. 'Asia/Kolkata')
 
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_ACCEPT_CONTENT = ['json']
 
# Prevent tasks from running forever if something hangs
CELERY_TASK_SOFT_TIME_LIMIT = 300   # 5 minutes: raises SoftTimeLimitExceeded
CELERY_TASK_TIME_LIMIT = 360        # 6 minutes: hard kill
 
# Beat stores its schedule in the DB (no separate file needed)
CELERY_BEAT_SCHEDULER = 'django_celery_beat.schedulers:DatabaseScheduler'
 
# ── .env additions ────────────────────────────────────────────────────
# Add these to your backend/.env file:
#
#   CELERY_BROKER_URL=redis://localhost:6379/1
#   CELERY_RESULT_BACKEND=redis://localhost:6379/2
#
# If Redis requires a password:
#   CELERY_BROKER_URL=redis://:yourpassword@localhost:6379/1