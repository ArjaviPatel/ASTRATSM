"""chat/views.py — secured polling-based chat"""
import logging
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.throttling import UserRateThrottle
from .models import ChatRoom, Message
from .serializers import ChatRoomSerializer, MessageSerializer
from accounts.models import User

logger = logging.getLogger('nexus')


# ── Custom throttle classes ──────────────────────────────────────────────────

class ChatPollThrottle(UserRateThrottle):
    """60 polls/min per user = 1 per second max"""
    scope = 'chat_poll'

class ChatSendThrottle(UserRateThrottle):
    """30 messages/min per user — prevents spam"""
    scope = 'chat_send'


# ── Helpers ──────────────────────────────────────────────────────────────────

def sanitize_text(text: str) -> str:
    """
    Basic sanitization:
    - Strip leading/trailing whitespace
    - Remove null bytes (can cause DB issues)
    - Limit length
    """
    if not text:
        return ''
    text = text.replace('\x00', '')   # null bytes
    text = text.strip()
    return text[:4000]                # hard cap


def check_file_content(file) -> bool:
    """
    Read first few bytes to detect dangerous file types
    regardless of extension (content sniffing protection).
    Blocks: EXE, DLL, ELF, PHP, scripts with <?php
    """
    DANGEROUS_SIGNATURES = [
        b'MZ',           # Windows EXE/DLL
        b'\x7fELF',      # Linux ELF executable
        b'<?php',        # PHP script
        b'#!/',          # Shell script
    ]
    try:
        header = file.read(8)
        file.seek(0)  # reset for actual saving
        for sig in DANGEROUS_SIGNATURES:
            if header.startswith(sig):
                return False
    except Exception:
        pass
    return True


# ── ViewSet ──────────────────────────────────────────────────────────────────

class ChatRoomViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class   = ChatRoomSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs   = ChatRoom.objects.select_related('project').prefetch_related('members')
        if user.role in (User.Role.ADMIN, User.Role.LEADERSHIP) :
            return qs.all()
        if user.role == User.Role.MANAGER:
            return (qs.filter(members=user) | qs.filter(project__manager=user)).distinct()
        return qs.filter(members=user)

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx

    @action(detail=True, methods=['get'], throttle_classes=[ChatPollThrottle])
    def messages(self, request, pk=None):
        """
        GET /chat/rooms/<id>/messages/
        ?limit=50       — initial load
        ?after=<id>     — polling: only messages newer than this id
        ?before=<id>    — load older messages (pagination)

        Security:
        - room.get_object() enforces membership check automatically
        - ChatPollThrottle limits to 60 req/min per user
        """
        room   = self.get_object()  # 403 if not a member
        limit  = min(int(request.query_params.get('limit', 50)), 200)
        before = request.query_params.get('before')
        after  = request.query_params.get('after')

        qs = room.messages.select_related('sender').order_by('-created_at')

        if after:
            try:
                qs = qs.filter(pk__gt=int(after)).order_by('created_at')
                msgs = list(qs)
                return Response(MessageSerializer(msgs, many=True, context={'request': request}).data)
            except ValueError:
                return Response([], status=200)

        if before:
            try:
                qs = qs.filter(pk__lt=int(before))
            except ValueError:
                pass

        msgs = list(reversed(list(qs[:limit])))
        return Response(MessageSerializer(msgs, many=True, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        room   = self.get_object()
        unread = room.messages.exclude(sender=request.user).exclude(read_by=request.user)
        for msg in unread:
            msg.read_by.add(request.user)
        return Response({'marked_read': unread.count()})

    @action(detail=True, methods=['post'], throttle_classes=[ChatSendThrottle])
    def send_message(self, request, pk=None):
        """
        POST /chat/rooms/<id>/send_message/
        Supports JSON (text only) and multipart (file upload).

        Security checks:
        1. JWT auth — must be logged in
        2. Membership — must be in this room
        3. Rate limit — 30 messages/min (ChatSendThrottle)
        4. Text sanitization — null bytes, length cap
        5. File content check — blocks EXE, PHP, shell scripts
        6. File type whitelist — from serializer validation
        7. File size limit — 10MB from settings
        """
        room = self.get_object()  # 403 if not member

        text = sanitize_text(request.data.get('text', ''))
        data = {'room': room.id, 'text': text}

        # ── File upload ──────────────────────────────────────────────────
        if 'file' in request.FILES:
            f = request.FILES['file']

            # Content sniffing check
            if not check_file_content(f):
                return Response(
                    {'detail': 'File type not allowed for security reasons.'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            data['attachment'] = f
            data['msg_type'] = 'image' if f.content_type.startswith('image/') else 'file'
            if not data['text']:
                data['text'] = sanitize_text(f.name)
        else:
            data['msg_type'] = 'text'
            if not text:
                return Response(
                    {'detail': 'Message text cannot be empty.'},
                    status=status.HTTP_400_BAD_REQUEST
                )

        serializer = MessageSerializer(data=data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        msg = serializer.save(sender=request.user, room=room)

        # ── Notify other room members ────────────────────────────────────
        try:
            from notifications.utils import notify_user
            other_members = room.members.exclude(pk=request.user.pk).filter(is_active=True)
            room_name = room.project.name if room.project else room.name
            preview = (data.get('text') or '')[:60] or '📎 Attachment'
            for member in other_members:
                notify_user(
                    user=member,
                    notif_type='message',
                    title=f'{request.user.name} in #{room_name}',
                    message=preview,
                    action_url='/chat',
                )
        except Exception:
            pass  # Never let notification failure break message sending

        logger.info('Message sent by %s in room %s', request.user.email, room.id)

        return Response(
            MessageSerializer(msg, context={'request': request}).data,
            status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=['patch'])
    def edit_message(self, request, pk=None):
        """PATCH /chat/rooms/<id>/edit_message/ — edit own message"""
        room = self.get_object()
        msg_id = request.data.get('message_id')
        text   = sanitize_text(request.data.get('text', ''))
        if not text:
            return Response({'detail': 'Text cannot be empty.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            msg = room.messages.get(pk=msg_id, sender=request.user)
        except Message.DoesNotExist:
            return Response({'detail': 'Message not found or not yours.'}, status=status.HTTP_404_NOT_FOUND)
        msg.text      = text
        msg.is_edited = True
        msg.save(update_fields=['text', 'is_edited', 'updated_at'])
        return Response(MessageSerializer(msg, context={'request': request}).data)

    @action(detail=True, methods=['delete'])
    def delete_message(self, request, pk=None):
        """DELETE /chat/rooms/<id>/delete_message/ — delete own message"""
        room   = self.get_object()
        msg_id = request.data.get('message_id')
        try:
            msg = room.messages.get(pk=msg_id, sender=request.user)
        except Message.DoesNotExist:
            return Response({'detail': 'Message not found or not yours.'}, status=status.HTTP_404_NOT_FOUND)
        msg.delete()
        return Response({'deleted': True})
