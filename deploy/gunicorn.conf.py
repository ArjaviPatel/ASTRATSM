"""Gunicorn configuration for AstraTSM (WSGI / REST API).

Used by deploy/astratsm-gunicorn.service. Tune `workers` to your CPU count:
a common rule of thumb is (2 * cores) + 1.
"""
import multiprocessing

# Bind to a UNIX socket that nginx proxies to. Use a TCP bind instead
# (e.g. "127.0.0.1:8000") if you prefer.
bind = "unix:/run/astratsm/gunicorn.sock"

workers = multiprocessing.cpu_count() * 2 + 1
worker_class = "sync"
timeout = 60
graceful_timeout = 30
keepalive = 5

# Recycle workers periodically to bound memory growth.
max_requests = 1000
max_requests_jitter = 100

accesslog = "-"   # stdout → captured by journald
errorlog = "-"
loglevel = "info"
