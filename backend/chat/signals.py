"""
chat/signals.py
Automatically create a ChatRoom when a Project is saved,
and sync membership when resources are assigned.
"""
from projects.models import Project
from django.db.models.signals import m2m_changed, post_save
from django.dispatch import receiver
import logging
logger = logging.getLogger('nexus')


def _add_admins_and_managers(room):
    """Add all active admins and managers to a chat room."""
    from accounts.models import User
    staff = User.objects.filter(
        role__in=[User.Role.ADMIN, User.Role.LEADERSHIP, User.Role.MANAGER],
        is_active=True
    )
    room.members.add(*staff)


@receiver(post_save, sender='projects.Project')
def create_project_chat_room(sender, instance, created, **kwargs):
    if not created:
        return
    from .models import ChatRoom
    room, was_created = ChatRoom.objects.get_or_create(
        project=instance,
        defaults={'room_type': 'project', 'name': f'{instance.name} Chat'}
    )
    if was_created:
        # Add manager + all admins/managers
        _add_admins_and_managers(room)
        if instance.manager:
            room.members.add(instance.manager)
        # Add already-assigned resources
        for user in instance.resources.filter(is_active=True):
            room.members.add(user)
        logger.info('ChatRoom auto-created for project "%s"', instance.name)


@receiver(m2m_changed, sender=Project.resources.through)
def sync_chat_room_members(sender, instance, action, pk_set, **kwargs):
    """Keep chat room membership in sync with project resources."""
    from .models import ChatRoom
    try:
        room = instance.chat_room
    except ChatRoom.DoesNotExist:
        return

    if action == 'post_add' and pk_set:
        from accounts.models import User
        new_members = User.objects.filter(pk__in=pk_set)
        room.members.add(*new_members)

    elif action == 'post_remove' and pk_set:
        from accounts.models import User
        removed = User.objects.filter(pk__in=pk_set)
        room.members.remove(*removed)