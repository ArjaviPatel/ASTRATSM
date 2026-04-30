"""resources/urls.py"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

app_name = 'resources'
router   = DefaultRouter()
router.register('time-entries', views.TimeEntryViewSet,       basename='time-entry')
router.register('late-entry-approvals', views.TimesheetLateEntryApprovalViewSet, basename='late-entry-approval')
router.register('',             views.ResourceProfileViewSet, basename='resource')
urlpatterns = [path('', include(router.urls))]
