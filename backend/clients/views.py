import logging
from django.db.models import Q
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.models import User
from accounts.permissions import IsAdmin, IsAdminOrManager, IsAdminOrManagerOrReadOnly
from nexus.excel import workbook_response
from notifications.utils import notify_admins_and_managers
from .models import Client, ClientContact
from .serializers import ClientContactSerializer, ClientSerializer

logger = logging.getLogger('nexus')

ADMIN_ROLES = (User.Role.ADMIN, User.Role.LEADERSHIP)

class ClientViewSet(viewsets.ModelViewSet):
    serializer_class = ClientSerializer
    permission_classes = [IsAdminOrManagerOrReadOnly]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['status', 'industry']
    search_fields = ['name', 'email', 'contact_person', 'industry']
    ordering_fields = ['name', 'onboarded_at', 'status']

    def get_queryset(self):
        user = self.request.user
        base = Client.objects.select_related('onboarded_by', 'portal_user')
        if self.action in ('retrieve', 'projects', 'contacts'):
            base = base.prefetch_related('contacts')
        if user.role in ADMIN_ROLES:
            return base.all()
        if user.role == User.Role.MANAGER:
            return base.filter(projects__manager=user).distinct()
        if user.role == User.Role.RESOURCE:
            # Resources need the client list for timesheet/project dropdowns, but
            # ClientSerializer strips all PII (email/phone/address/notes/contacts)
            # for the resource role — they only receive id/name/industry/status.
            return base.all()
        if user.role == User.Role.CLIENT:
            return base.filter(Q(portal_user=user) | Q(projects__resources=user)).distinct()
        return base.none()

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx

    def perform_create(self, serializer):
        client = serializer.save(onboarded_by=self.request.user)
        logger.info('Client "%s" onboarded by %s', client.name, self.request.user.email)
        notify_admins_and_managers(
            notif_type='update',
            title=f'New client: {client.name}',
            message=f'"{client.name}" has been onboarded by {self.request.user.name}.',
            action_url=f'/clients/{client.id}',
        )

    def perform_update(self, serializer):
        old_status = self.get_object().status
        client = serializer.save()
        if old_status != client.status:
            notify_admins_and_managers(
                notif_type='status_change',
                title=f'Client status changed: {client.name}',
                message=f'"{client.name}" status changed to {client.get_status_display()}.',
                action_url=f'/clients/{client.id}',
            )

    @action(detail=False, methods=['get'], permission_classes=[IsAdmin])
    def export(self, request):
        clients = self.filter_queryset(self.get_queryset()).order_by('name')
        return workbook_response(
            filename='clients.xlsx',
            sheet_name='Clients',
            headers=['Name', 'Email 1', 'Email 2', 'Phone 1', 'Phone 2', 'Contact Person 1', 'Contact Person 2', 'Industry', 'Website', 'Status', 'Projects', 'Onboarded By'],
            rows=[
                [
                    client.name,
                    client.email,
                    client.email2,
                    client.phone,
                    client.phone2,
                    client.contact_person,
                    client.contact_person2,
                    client.industry,
                    client.website,
                    client.status,
                    client.projects.count(),
                    client.onboarded_by.name if client.onboarded_by else '',
                ]
                for client in clients
            ],
        )

    @action(detail=True, methods=['get'])
    def projects(self, request, pk=None):
        client = self.get_object()
        from projects.serializers import ProjectListSerializer
        qs = client.projects.select_related('manager').prefetch_related('resources')
        if request.user.role == User.Role.MANAGER:
            qs = qs.filter(manager=request.user)
        elif request.user.role == User.Role.RESOURCE:
            qs = qs.filter(resources=request.user)
        elif request.user.role == User.Role.CLIENT:
            qs = qs.filter(Q(client__portal_user=request.user) | Q(resources=request.user)).distinct()
        return Response(ProjectListSerializer(qs, many=True, context={'request': request}).data)

    @action(detail=True, methods=['get', 'post'], url_path='contacts')
    def contacts(self, request, pk=None):
        client = self.get_object()
        if request.method == 'GET':
            return Response(ClientContactSerializer(client.contacts.all(), many=True).data)
        serializer = ClientContactSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(client=client)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ClientContactViewSet(viewsets.ModelViewSet):
    queryset = ClientContact.objects.select_related('client').all()
    serializer_class = ClientContactSerializer
    permission_classes = [IsAdminOrManager]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['client', 'is_primary']

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user.role in ADMIN_ROLES:
            return qs
        if user.role == User.Role.MANAGER:
            return qs.filter(client__projects__manager=user).distinct()
        return qs.none()
