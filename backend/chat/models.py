"""chat/models.py"""
from django.db import models
from accounts.models import User
from accounts.permissions import ADMIN_ROLES
from projects.models import Project


class ChatRoom(models.Model):
    class Type(models.TextChoices):
        PROJECT = 'project', 'Project Room'
        DIRECT  = 'direct',  'Direct Message'

    room_type  = models.CharField(max_length=10, choices=Type.choices, default=Type.PROJECT)
    project    = models.OneToOneField(
        Project, on_delete=models.CASCADE,
        related_name='chat_room', null=True, blank=True
    )
    members    = models.ManyToManyField(User, related_name='chat_rooms', blank=True)
    name       = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Room: {self.project.name if self.project else self.name}'

    @property
    def last_message(self):
        return self.messages.order_by('-created_at').first()

    def is_accessible_by(self, user: User) -> bool:
        if user.role in (*ADMIN_ROLES, User.Role.MANAGER):
            return True
        return self.members.filter(pk=user.pk).exists()


class Message(models.Model):
    class Type(models.TextChoices):
        TEXT   = 'text',   'Text'
        FILE   = 'file',   'File'
        SYSTEM = 'system', 'System'
        IMAGE  = 'image',  'Image'

    room       = models.ForeignKey(ChatRoom, on_delete=models.CASCADE, related_name='messages', db_index=True)
    sender     = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='sent_messages')
    text       = models.TextField(blank=True)
    msg_type   = models.CharField(max_length=10, choices=Type.choices, default=Type.TEXT)
    attachment = models.FileField(upload_to='chat/attachments/%Y/%m/', null=True, blank=True)
    is_edited  = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    read_by    = models.ManyToManyField(User, related_name='read_messages', blank=True)

    class Meta:
        ordering = ['created_at']
        indexes  = [models.Index(fields=['room', 'created_at'])]

    def __str__(self):
        return f'[{self.room}] {self.sender}: {self.text[:60]}'

    def clean(self):
        from django.core.exceptions import ValidationError
        if self.msg_type == self.Type.TEXT and not self.text.strip():
            raise ValidationError({'text': 'Text messages cannot be empty.'})
