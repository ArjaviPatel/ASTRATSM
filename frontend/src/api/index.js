import axios from 'axios'
import { _getStoredAccess, _getStoredRefresh, _setStoredAccess, _clearStorage } from '@/stores/authStore'

const BASE = '/api/v1'

const api = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' },
})

// Attach access token to every request
api.interceptors.request.use((config) => {
  const token = _getStoredAccess()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Auto-refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      const refresh = _getStoredRefresh()
      if (refresh) {
        try {
          const { data } = await axios.post(`${BASE}/auth/token/refresh/`, { refresh })
          _setStoredAccess(data.access)
          original.headers.Authorization = `Bearer ${data.access}`
          return api(original)
        } catch {
          _clearStorage()
          window.location.href = '/login'
        }
      } else {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default api

// ── Auth ──────────────────────────────────────────────────────────────
export const authApi = {
  login: (data) => api.post('/auth/login/', data),
  verifyLoginOtp: (data) => api.post('/auth/login/verify-otp/', data),
  logout: (refresh) => api.post('/auth/logout/', { refresh }),
  me: () => api.get('/auth/me/'),
  updateMe: (data) => api.patch('/auth/me/', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  changePassword: (data) => api.post('/auth/change-password/', data),
  users: (params) => api.get('/auth/users/', { params }),
  createUser: (data) => api.post('/auth/users/', data),
  toggleStatus: (id) => api.patch(`/auth/users/${id}/toggle_status/`),
  changeRole: (id, role) => api.patch(`/auth/users/${id}/change_role/`, { role }),
  rolePermissions: () => api.get('/auth/role-permissions/'),
  updateRolePermission: (id, data) => api.patch(`/auth/role-permissions/${id}/`, data),
}

// ── Clients ───────────────────────────────────────────────────────────
export const clientsApi = {
  list: (params) => api.get('/clients/', { params }),
  create: (data) => api.post('/clients/', data),
  get: (id) => api.get(`/clients/${id}/`),
  update: (id, data) => api.patch(`/clients/${id}/`, data),
  delete: (id) => api.delete(`/clients/${id}/`),
  export: () => api.get('/clients/export/', { responseType: 'blob' }),
  getProjects: (id) => api.get(`/clients/${id}/projects/`),
  addContact: (id, data) => api.post(`/clients/${id}/contacts/`, data),
  deleteContact: (contactId) => api.delete(`/clients/contacts/${contactId}/`),
  updateContact: (contactId, data) => api.patch(`/clients/contacts/${contactId}/`, data),
}

// ── Projects ──────────────────────────────────────────────────────────
export const projectsApi = {
  list: (params) => api.get('/projects/', { params }),
  create: (data) => api.post('/projects/', data),
  get: (id) => api.get(`/projects/${id}/`),
  update: (id, data) => api.patch(`/projects/${id}/`, data),
  delete: (id) => api.delete(`/projects/${id}/`),
  addUpdate: (id, data) => api.post(`/projects/${id}/add_update/`, data),
  uploadDocument: (id, form) => api.post(`/projects/${id}/upload_document/`, form, { headers: { 'Content-Type': 'multipart/form-data' } }),
  updateProgress: (id, progress) => api.patch(`/projects/${id}/update_progress/`, { progress }),
  assignResource: (id, userId) => api.post(`/projects/${id}/assign_resource/`, { user_id: userId }),
  removeResource: (id, userId) => api.post(`/projects/${id}/remove_resource/`, { user_id: userId }),
  export: () => api.get('/projects/export/', { responseType: 'blob' }),
}

// ── Timelines ─────────────────────────────────────────────────────────
export const timelinesApi = {
  list: (params) => api.get('/timelines/', { params }),
  create: (data) => api.post('/timelines/', data),
  get: (id) => api.get(`/timelines/${id}/`),
  update: (id, data) => api.patch(`/timelines/${id}/`, data),
  delete: (id) => api.delete(`/timelines/${id}/`),
  updateProgress: (id, progress) => api.patch(`/timelines/${id}/update_progress/`, { progress }),
  updateWork: (id, data) => api.patch(`/timelines/${id}/update_work/`, data),
  addMilestone: (id, data) => api.post(`/timelines/${id}/add_milestone/`, data),
  completeMilestone: (milestoneId) => api.patch(`/timelines/milestones/${milestoneId}/complete/`),
}

// ── Resources ─────────────────────────────────────────────────────────
export const resourcesApi = {
  list: (params) => api.get('/resources/', { params }),
  create: (data) => api.post('/resources/', data),
  get: (id) => api.get(`/resources/${id}/`),
  update: (id, data) => api.patch(`/resources/${id}/`, data),
  delete: (id) => api.delete(`/resources/${id}/`),
  export: () => api.get('/resources/export/', { responseType: 'blob' }),
  exportTimeEntries: (params) => api.get('/resources/time-entries/export/', { params, responseType: 'blob' }),
  timesheetReport: (id) => api.get(`/resources/${id}/timesheet_report/`, { responseType: 'blob' }),
  setAvailability: (id, data) => api.patch(`/resources/${id}/set_availability/`, data),
  myDashboard: () => api.get('/resources/my_dashboard/'),
  timeEntries: (params) => api.get('/resources/time-entries/', { params }),
  createTimeEntry: (data) => api.post('/resources/time-entries/', data),
  updateTimeEntry: (id, data) => api.patch(`/resources/time-entries/${id}/`, data),
  deleteTimeEntry: (id) => api.delete(`/resources/time-entries/${id}/`),
  approveTimeEntry: (id) => api.patch(`/resources/time-entries/${id}/approve/`),
  rejectTimeEntry: (id, data) => api.patch(`/resources/time-entries/${id}/reject/`, data || {}),
  lateEntryApprovals: (params) => api.get('/resources/late-entry-approvals/', { params }),
  requestLateEntryApproval: (data) => api.post('/resources/late-entry-approvals/', data),
  approveLateEntryApproval: (id, data) => api.post(`/resources/late-entry-approvals/${id}/approve/`, data || {}),
  rejectLateEntryApproval: (id, data) => api.post(`/resources/late-entry-approvals/${id}/reject/`, data || {}),
  dailyReport: (date) => api.get('/resources/daily_report/', { params: { date } }),
}

// ── Chat ──────────────────────────────────────────────────────────────
export const chatApi = {
  rooms:         () => api.get('/chat/rooms/'),
  messages:      (roomId, params) => api.get(`/chat/rooms/${roomId}/messages/`, { params }),
  sendMessage:   (roomId, data) => {
    const isFile = data instanceof FormData
    return api.post(`/chat/rooms/${roomId}/send_message/`, data, isFile ? { headers: { 'Content-Type': 'multipart/form-data' } } : {})
  },
  editMessage:   (roomId, msgId, text) => api.patch(`/chat/rooms/${roomId}/edit_message/`, { message_id: msgId, text }),
  deleteMessage: (roomId, msgId) => api.delete(`/chat/rooms/${roomId}/delete_message/`, { data: { message_id: msgId } }),
  markRead:      (roomId) => api.post(`/chat/rooms/${roomId}/mark_read/`),
}

// ── Approvals ─────────────────────────────────────────────────────────
export const approvalsApi = {
  list: (params) => api.get('/approvals/', { params }),
  get: (id) => api.get(`/approvals/${id}/`),
  create: (data) => api.post('/approvals/', data),
  approve: (id, data) => api.post(`/approvals/${id}/approve/`, data || {}),
  reject: (id, data) => api.post(`/approvals/${id}/reject/`, data || {}),
  applyEdit: (id, data) => api.post(`/approvals/${id}/apply_edit/`, data),
  pendingCount: () => api.get('/approvals/pending_count/'),
  markAllRead: () => api.post('/approvals/mark_all_read/'),
}
export const notificationsApi = {
  list: () => api.get('/notifications/'),
  markRead: (id) => api.patch(`/notifications/${id}/mark_read/`),
  markAllRead: () => api.post('/notifications/mark_all_read/'),
  unreadCount: () => api.get('/notifications/unread_count/'),
  clearAll: () => api.delete('/notifications/clear_all/'),
  allTypes: () => api.get('/notifications/preferences/all_types/'),
  getPrefsForResource: (userId) => api.get(`/notifications/preferences/for_resource/?user_id=${userId}`),
  listPrefs: () => api.get('/notifications/preferences/'),
  createPrefs: (data) => api.post('/notifications/preferences/', data),
  updatePrefs: (id, data) => api.patch(`/notifications/preferences/${id}/`, data),
}

// ── Timeline Approvals ─────────────────────────────────────────────────────────
export const timelineApprovalsApi = {
  list:         (params) => api.get('/timelines/approvals/', { params }),
  create:       (data)   => api.post('/timelines/approvals/', data),
  approve:      (id, data) => api.post(`/timelines/approvals/${id}/approve/`, data),
  reject:       (id, data) => api.post(`/timelines/approvals/${id}/reject/`, data),
  applyEdit:    (id, data) => api.post(`/timelines/approvals/${id}/apply_edit/`, data),
  pendingCount: ()         => api.get('/timelines/approvals/pending_count/'),
}