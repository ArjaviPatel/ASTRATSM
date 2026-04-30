import React, { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bell, Trash2, FolderKanban, MessageSquare, AlertTriangle,
  CheckCircle, User, Calendar, Wrench, Shield, Users, Mail,
} from 'lucide-react'
import { notificationsApi, resourcesApi, authApi } from '@/api/index.js'
import { Btn, Badge, EmptyState, Spinner, Avatar, Input, Textarea, Modal } from '@/components/ui/index.jsx'
import { timeAgo, extractError, downloadBlob } from '@/utils/index.js'
import { useAuthStore } from '@/stores/authStore.js'

/* ─────────────────────────────────────────────────
   NOTIFICATIONS PAGE
───────────────────────────────────────────────── */
const NOTIF_ICON = {
  project_assigned: FolderKanban,
  status_change: AlertTriangle,
  deadline: Calendar,
  timeline_complete: CheckCircle,
  message: MessageSquare,
  update: FolderKanban,
  mention: User,
}

export function NotificationsPage() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState('all')

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list().then(r => r.data.results || r.data),
  })

  const notifications = data || []
  const unread    = notifications.filter(n => !n.is_read)
  const displayed = filter === 'unread' ? notifications.filter(n => !n.is_read)
    : filter === 'read' ? notifications.filter(n => n.is_read)
    : notifications

  useEffect(() => {
    if (unread.length === 0) return
    const timer = setTimeout(async () => {
      await notificationsApi.markAllRead()
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['unread-count'] })
    }, 2000)
    return () => clearTimeout(timer)
  }, [unread.length])

  async function markRead(id) {
    await notificationsApi.markRead(id)
    qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['unread-count'] })
  }
  async function markAll() {
    await notificationsApi.markAllRead()
    qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['unread-count'] })
  }
  async function clearAll() {
    await notificationsApi.clearAll()
    qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['unread-count'] })
  }

  const NOTIF_TYPE_LABEL = { project_assigned:'Project', status_change:'Status', deadline:'Deadline', timeline_complete:'Timeline', message:'Message', update:'Update', mention:'Mention' }
  const NOTIF_TYPE_COLOR = { project_assigned:'var(--accent)', status_change:'var(--warning)', deadline:'var(--danger)', timeline_complete:'var(--success)', message:'var(--info)', update:'var(--info)', mention:'var(--accent)' }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:0, height:'calc(100vh - 60px)', overflow:'hidden', margin:'-32px' }}>

      {/* Sticky top bar */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'20px 32px 16px', borderBottom:'1px solid var(--border)', background:'var(--bg-1)', flexShrink:0, flexWrap:'wrap', gap:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <div>
            <h1 style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:'1.6rem', letterSpacing:'-0.02em' }}>Notifications</h1>
            <p style={{ color:'var(--text-2)', fontSize:'12px', marginTop:2 }}>
              {unread.length > 0
                ? <><span style={{ color:'var(--accent)', fontWeight:700 }}>{unread.length} unread</span> · {notifications.length} total</>
                : <span style={{ color:'var(--success)' }}>All caught up ✓</span>
              }
            </p>
          </div>

          {/* Filter tabs */}
          {notifications.length > 0 && (
            <div style={{ display:'flex', gap:3, background:'var(--bg-2)', padding:3, borderRadius:'var(--r-md)', border:'1px solid var(--border)' }}>
              {[['all','All',notifications.length],['unread','Unread',unread.length],['read','Read',notifications.length-unread.length]].map(([val,label,count]) => (
                <button key={val} onClick={() => setFilter(val)} style={{ background:filter===val?'var(--bg-1)':'transparent', border:filter===val?'1px solid var(--border)':'1px solid transparent', borderRadius:'var(--r-sm)', padding:'5px 12px', fontSize:'12px', fontWeight:filter===val?600:400, color:filter===val?'var(--text-0)':'var(--text-3)', cursor:'pointer', transition:'all var(--t-fast)', display:'flex', alignItems:'center', gap:5 }}>
                  {label}
                  {count > 0 && <span style={{ background:filter===val?'var(--bg-3)':'transparent', borderRadius:'var(--r-full)', padding:'0 5px', fontSize:'10px', fontFamily:'var(--font-mono)', color:'var(--text-3)' }}>{count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {notifications.length > 0 && (
          <div style={{ display:'flex', gap:8 }}>
            {unread.length > 0 && (
              <button onClick={markAll} style={{ background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:'var(--r-md)', cursor:'pointer', padding:'7px 16px', fontSize:'12px', fontWeight:600, color:'var(--text-1)', transition:'all var(--t-fast)' }}
                onMouseEnter={e => e.currentTarget.style.borderColor='var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.borderColor='var(--border)'}
              >✓ Mark all read</button>
            )}
            <button onClick={clearAll} style={{ background:'none', border:'1px solid var(--border)', borderRadius:'var(--r-md)', cursor:'pointer', padding:'7px 16px', fontSize:'12px', color:'var(--text-3)', transition:'all var(--t-fast)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor='var(--danger)'; e.currentTarget.style.color='var(--danger)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text-3)' }}
            >Clear all</button>
          </div>
        )}
      </div>

      {/* Full-height scrollable list */}
      <div style={{ flex:1, overflowY:'auto', padding:'20px 32px' }}>
        {isLoading ? (
          <div style={{ display:'flex', justifyContent:'center', paddingTop:80 }}><Spinner /></div>
        ) : notifications.length === 0 ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', paddingTop:100, gap:12 }}>
            <div style={{ width:56, height:56, borderRadius:'50%', background:'var(--bg-2)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Bell size={24} color="var(--text-3)" />
            </div>
            <div style={{ fontWeight:600, fontSize:'15px', color:'var(--text-1)' }}>All caught up!</div>
            <div style={{ fontSize:'13px', color:'var(--text-3)' }}>No notifications to show.</div>
          </div>
        ) : displayed.length === 0 ? (
          <div style={{ textAlign:'center', paddingTop:80, color:'var(--text-3)', fontSize:'13px' }}>No {filter} notifications.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {displayed.map((n) => {
              const Icon = NOTIF_ICON[n.notif_type] || Bell
              const typeColor = NOTIF_TYPE_COLOR[n.notif_type] || 'var(--text-3)'
              const typeLabel = NOTIF_TYPE_LABEL[n.notif_type] || n.notif_type
              return (
                <div key={n.id} style={{ display:'flex', gap:16, padding:'14px 18px', background:!n.is_read?'var(--bg-1)':'transparent', border:'1px solid var(--border)', borderLeft:!n.is_read?'3px solid var(--accent)':'3px solid transparent', borderRadius:'var(--r-md)', transition:'background var(--t-fast)' }}
                  onMouseEnter={e => e.currentTarget.style.background='var(--bg-2)'}
                  onMouseLeave={e => e.currentTarget.style.background=!n.is_read?'var(--bg-1)':'transparent'}
                >
                  <div style={{ width:40, height:40, borderRadius:'var(--r-md)', flexShrink:0, background:`${typeColor}14`, border:`1px solid ${typeColor}30`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <Icon size={17} color={typeColor} />
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3, flexWrap:'wrap' }}>
                      <span style={{ fontWeight:n.is_read?500:700, fontSize:'13px', color:'var(--text-0)' }}>{n.title}</span>
                      <span style={{ fontSize:'10px', fontWeight:700, padding:'1px 7px', borderRadius:'var(--r-full)', background:`${typeColor}14`, color:typeColor, border:`1px solid ${typeColor}28`, textTransform:'uppercase', letterSpacing:'0.06em' }}>{typeLabel}</span>
                      {!n.is_read && <div style={{ width:7, height:7, borderRadius:'50%', background:'var(--accent)', flexShrink:0 }} />}
                    </div>
                    <div style={{ fontSize:'12px', color:'var(--text-2)', lineHeight:1.5, marginBottom:4 }}>{n.message}</div>
                    <div style={{ fontSize:'11px', color:'var(--text-3)', fontFamily:'var(--font-mono)' }}>{timeAgo(n.created_at)}</div>
                  </div>
                  {!n.is_read && (
                    <button onClick={() => markRead(n.id)} style={{ background:'none', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', cursor:'pointer', padding:'4px 10px', color:'var(--text-3)', fontSize:'11px', flexShrink:0, alignSelf:'flex-start', transition:'all var(--t-fast)' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.color='var(--accent)' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text-3)' }}
                    >Mark read</button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}


/* ─────────────────────────────────────────────────
   RESOURCES PAGE
───────────────────────────────────────────────── */
export function ResourcesPage() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const isManager = user?.role === 'manager'
  const [showCreate, setShowCreate] = useState(false)
  const [editingResource, setEditingResource] = useState(null)
  const [deletingResource, setDeletingResource] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [approvingId, setApprovingId] = useState(null)

  const { data, isLoading } = useQuery({
    queryKey: ['resources', page, search],
    queryFn: () => resourcesApi.list({ page, page_size: 25, search: search || undefined }).then(r => r.data),
    placeholderData: (prev) => prev,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  })

  const { data: managersData } = useQuery({
    queryKey: ['managers-all'],
    queryFn: () => authApi.users({ role: 'manager', is_active: true, page_size: 500 }).then(r => r.data.results || r.data),
    enabled: isAdmin,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const { data: pendingEntriesData, isLoading: pendingEntriesLoading } = useQuery({
    queryKey: ['pending-time-entries', user?.id],
    queryFn: async () => {
      // Django BooleanField filterset: use 'false' string
      const res = await resourcesApi.timeEntries({ approved: 'false', page_size: 500 })
      const all = res.data.results || res.data || []
      // Extra client-side guard: only unapproved entries
      return all.filter(e => e.approved === false || e.approved === 'false')
    },
    enabled: isManager,
    staleTime: 10_000,
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  })

  const resources = data?.results || data || []
  const totalResources = data?.count ?? resources.length
  const totalPages = data?.total_pages ?? 1
  const managers = managersData || []
  const pendingEntries = pendingEntriesData || []
  const bench = resources.filter(r => (r.active_project_count ?? 0) === 0)
  const active = resources.filter(r => (r.active_project_count ?? 0) > 0)

  useEffect(() => {
    setPage(1)
  }, [search])

  async function exportResources() {
    setExporting(true)
    try {
      const response = await resourcesApi.export()
      downloadBlob(response, 'resources.xlsx')
    } finally {
      setExporting(false)
    }
  }

  async function confirmDelete() {
    if (!deletingResource) return
    setDeleting(true)
    try {
      await resourcesApi.delete(deletingResource.id)
      setDeletingResource(null)
      qc.invalidateQueries({ queryKey: ['resources'] })
    } finally {
      setDeleting(false)
    }
  }

  async function approveEntry(entryId) {
    setApprovingId(entryId)
    try {
      await resourcesApi.approveTimeEntry(entryId)
      qc.setQueryData(['pending-time-entries', user?.id], (prev = []) => prev.filter(e => e.id !== entryId))
      qc.invalidateQueries({ queryKey: ['pending-time-entries'] })
      qc.invalidateQueries({ queryKey: ['resources'] })
      qc.invalidateQueries({ queryKey: ['dashboard-time-entries'] })
      qc.invalidateQueries({ queryKey: ['dashboard-projects'] })
      qc.invalidateQueries({ queryKey: ['dashboard-timelines'] })
      qc.invalidateQueries({ queryKey: ['dashboard-resources'] })
      qc.invalidateQueries({ queryKey: ['dashboard-notifications'] })
    } finally {
      setApprovingId(null)
    }
  }

  async function downloadResourceTimesheet(resource) {
    const response = await resourcesApi.timesheetReport(resource.id)
    const name = (resource.name || resource.user_detail?.name || 'resource').replace(/\s+/g, '_').toLowerCase()
    downloadBlob(response, `timesheet_${name}.xlsx`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      <div className="mobile-center-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.8rem', letterSpacing: '-0.02em' }}>Resources</h1>
          <p style={{ color: 'var(--text-2)', fontSize: '14px', marginTop: 4 }}>
            {totalResources} resources | <span style={{ color: 'var(--success)' }}>{active.length} active on this page</span> | <span style={{ color: 'var(--danger)' }}>{bench.length} on bench on this page</span>
            {user?.role === 'manager' && <span style={{ marginLeft: 8, color: 'var(--info)' }}>Assigned to you only</span>}
          </p>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <Btn variant="ghost" icon={<FolderKanban size={14} />} loading={exporting} onClick={exportResources}>Export Excel</Btn>
            <Btn icon={<Users size={14} />} onClick={() => setShowCreate(true)}>New Resource</Btn>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 360 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, resource ID, or manager..."
            style={{ width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '9px 12px', outline: 'none' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          <Btn variant="ghost" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</Btn>
          <span style={{ fontSize: '14px', color: 'var(--text-2)', minWidth: 90, textAlign: 'center' }}>Page {page} / {totalPages}</span>
          <Btn variant="ghost" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</Btn>
        </div>
      </div>

      {isManager && (
        <PendingTimeApprovalTable
          entries={pendingEntries}
          isLoading={pendingEntriesLoading}
          approvingId={approvingId}
          onApprove={approveEntry}
        />
      )}

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--sp-8)' }}><Spinner /></div>
      ) : resources.length === 0 ? (
        <EmptyState icon={Wrench} title="No resources" description={search ? 'No resources matched your search.' : 'Add your first resource to get started.'} />
      ) : (
        <>
          <ResourceTable
            title="Active"
            badge={{ text: `${active.length} assigned`, color: 'var(--success)', bg: 'rgba(74,222,128,0.12)' }}
            resources={active}
            emptyText="No active resources on this page."
            canManage={isAdmin}
            onEdit={setEditingResource}
            onDelete={setDeletingResource}
            onDownloadReport={downloadResourceTimesheet}
          />
          <ResourceTable
            title="On Bench"
            badge={{ text: `${bench.length} unassigned`, color: 'var(--danger)', bg: 'rgba(248,113,113,0.12)' }}
            resources={bench}
            emptyText="No bench resources on this page."
            borderColor="rgba(248,113,113,0.25)"
            canManage={isAdmin}
            onEdit={setEditingResource}
            onDelete={setDeletingResource}
            onDownloadReport={downloadResourceTimesheet}
          />
        </>
      )}

      {showCreate && (
        <ResourceFormModal
          managers={managers}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['resources'] }); qc.invalidateQueries({ queryKey: ['dashboard-resources'] }) }}
        />
      )}

      {editingResource && (
        <ResourceFormModal
          resource={editingResource}
          managers={managers}
          onClose={() => setEditingResource(null)}
          onSaved={() => { setEditingResource(null); qc.invalidateQueries({ queryKey: ['resources'] }); qc.invalidateQueries({ queryKey: ['dashboard-resources'] }) }}
        />
      )}

      {deletingResource && (
        <Modal open onClose={() => setDeletingResource(null)} title="Delete Resource" width={460}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            <p style={{ fontSize: '15px', color: 'var(--text-2)', lineHeight: 1.6 }}>
              Delete <strong style={{ color: 'var(--text-0)' }}>{deletingResource.name || deletingResource.user_detail?.name}</strong>? This also removes the linked resource login.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
              <Btn variant="ghost" onClick={() => setDeletingResource(null)}>Cancel</Btn>
              <Btn loading={deleting} onClick={confirmDelete} style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}>Delete</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function ResourceTable({ title, badge, resources, emptyText, borderColor, canManage, onEdit, onDelete, onDownloadReport }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{title}</span>
        <span style={{ background: badge.bg, color: badge.color, borderRadius: 'var(--r-full)', padding: '2px 8px', fontSize: '13px', fontWeight: 700 }}>
          {badge.text}
        </span>
      </div>

      <div style={{ background: 'var(--bg-1)', border: `1px solid ${borderColor || 'var(--border)'}`, borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        {resources.length === 0 ? (
          <p style={{ padding: 'var(--sp-5)', color: 'var(--text-3)', fontSize: '15px' }}>{emptyText}</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name', 'Resource ID', 'Email', 'Level', 'Manager', 'Logged', 'Approved', 'Pending', 'Active Projects', 'Availability', ...(canManage ? ['Actions'] : [])].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: '13px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resources.map((r, i) => (
                <tr key={r.id} style={{ borderBottom: i < resources.length - 1 ? '1px solid var(--border)' : 'none' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                      <Avatar name={r.name || r.user_detail?.name} src={r.user_detail?.avatar || r.user_detail?.avatar_url} size={32} role="resource" />
                      <span style={{ fontWeight: 600, fontSize: '15px' }}>{r.name || r.user_detail?.name || '?'}</span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: '15px', color: 'var(--accent)' }}>{r.resource_id || '?'}</td>
                  <td style={{ padding: '12px 16px', fontSize: '14px', color: 'var(--text-3)' }}>{r.email || r.user_detail?.email || '?'}</td>
                  <td style={{ padding: '12px 16px', fontSize: '15px', color: 'var(--text-2)' }}>{r.level || '?'}</td>
                  <td style={{ padding: '12px 16px', fontSize: '15px', color: 'var(--text-2)' }}>{r.manager_detail?.name || '?'}</td>
                  <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: '15px', color: 'var(--text-1)' }}>{Number(r.total_hours_logged || 0).toFixed(1)}h</td>
                  <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: '15px', color: 'var(--success)', fontWeight: 600 }}>{Number(r.approved_hours_logged || 0).toFixed(1)}h</td>
                  <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: '15px', color: Number(r.pending_hours_logged || 0) > 0 ? 'var(--warning)' : 'var(--text-3)', fontWeight: 600 }}>{Number(r.pending_hours_logged || 0).toFixed(1)}h</td>
                  <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: '15px', color: badge.color, fontWeight: 600 }}>{r.active_project_count ?? 0}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                      <div style={{ flex: 1, maxWidth: 80, height: 4, background: 'var(--bg-3)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${r.availability}%`, height: '100%', background: r.availability > 50 ? 'var(--success)' : r.availability > 20 ? 'var(--warning)' : 'var(--danger)', borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: '14px', fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{r.availability}%</span>
                    </div>
                  </td>
                  {canManage && (
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                        <Btn variant="ghost" onClick={() => onDownloadReport(r)}>Report</Btn>
                        <Btn variant="ghost" onClick={() => onEdit(r)}>Edit</Btn>
                        <Btn variant="ghost" onClick={() => onDelete(r)} style={{ color: 'var(--danger)' }}><Trash2 size={14} /></Btn>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function PendingTimeApprovalTable({ entries, isLoading, approvingId, onApprove }) {
  return (
    <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
      <div style={{ padding: 'var(--sp-4) var(--sp-5)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem' }}>Pending Time Approvals</h3>
          <p style={{ fontSize: '14px', color: 'var(--text-3)', marginTop: 4 }}>Review submitted work logs and approve them directly from here.</p>
        </div>
        <Badge color={entries.length ? 'var(--warning)' : 'var(--success)'}>{entries.length} pending</Badge>
      </div>
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--sp-6)' }}><Spinner /></div>
      ) : entries.length === 0 ? (
        <div style={{ padding: 'var(--sp-6)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: 'var(--text-3)' }}>
          <div style={{ fontSize: '24px' }}>✓</div>
          <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-2)' }}>No pending timesheets</p>
          <p style={{ fontSize: '13px', textAlign: 'center', maxWidth: 380 }}>
            When resources assigned to you submit their work logs, they will appear here for your approval.
            Make sure resources have you set as their manager.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Resource', 'Project', 'Phase', 'Date', 'Hours', 'Notes', 'Action'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: '13px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={entry.id} style={{ borderBottom: index < entries.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600, fontSize: '15px' }}>{entry.resource_name}</td>
                  <td style={{ padding: '12px 16px', fontSize: '15px', color: 'var(--text-2)' }}>{entry.project_name}</td>
                  <td style={{ padding: '12px 16px', fontSize: '15px', color: 'var(--text-2)' }}>{entry.timeline_name || 'Project-level log'}</td>
                  <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--text-2)' }}>{entry.date}</td>
                  <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: '15px', color: 'var(--accent)', fontWeight: 700 }}>{entry.hours}h</td>
                  <td style={{ padding: '12px 16px', fontSize: '14px', color: 'var(--text-3)', maxWidth: 320, whiteSpace: 'pre-wrap' }}>{entry.description || 'No notes provided.'}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <Btn size="sm" loading={approvingId === entry.id} onClick={() => onApprove(entry.id)} icon={<CheckCircle size={13} />}>Approve</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ResourceFormModal({ resource, managers, onClose, onSaved }) {
  const isEdit = !!resource
  const [form, setForm] = useState({
    name: resource?.name || resource?.user_detail?.name || '',
    email: resource?.email || resource?.user_detail?.email || '',
    password: '',
    resource_id: resource?.resource_id || '',
    level: resource?.level || '',
    manager: resource?.manager || '',
    availability: resource?.availability ?? 100,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const dropdownStyle = {
    width: '100%',
    background: 'var(--bg-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)',
    color: 'var(--text-0)',
    fontSize: '15px',
    padding: '9px 12px',
    outline: 'none',
    cursor: 'pointer',
  }

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const payload = {
        name: form.name,
        email: form.email,
        resource_id: form.resource_id,
        level: form.level,
        manager: form.manager || null,
        availability: Number(form.availability || 0),
      }
      if (form.password) payload.password = form.password

      if (isEdit) {
        await resourcesApi.update(resource.id, payload)
      } else {
        if (!payload.password) throw new Error('Password is required for new resources.')
        await resourcesApi.create(payload)
      }
      onSaved()
    } catch (err) {
      setError(err.message || extractError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit Resource' : 'New Resource'} width={560}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        {error && <div style={{ color: 'var(--danger)', fontSize: '15px', background: 'rgba(248,113,113,0.1)', padding: '8px 12px', borderRadius: 'var(--r-md)' }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
          <Input label="Name" value={form.name} onChange={e => f('name', e.target.value)} required />
          <Input label="Email" type="email" value={form.email} onChange={e => f('email', e.target.value)} required />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
          <Input label="Resource ID" value={form.resource_id} onChange={e => f('resource_id', e.target.value)} placeholder="e.g. E001" required />
          <Input label={isEdit ? 'Reset Password (optional)' : 'Password'} type="password" value={form.password} onChange={e => f('password', e.target.value)} required={!isEdit} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Resource Level</div>
            <select value={form.level} onChange={e => f('level', e.target.value)} style={dropdownStyle}>
              <option value="">Select level</option>
              <option value="L1">L1</option>
              <option value="L2">L2</option>
              <option value="L3">L3</option>
              <option value="L4">L4</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Manager</div>
            <select value={form.manager} onChange={e => f('manager', e.target.value)} style={dropdownStyle}>
              <option value="">Unassigned</option>
              {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>

        <Input label="Availability %" type="number" min="0" max="100" value={form.availability} onChange={e => f('availability', e.target.value)} />

        <div style={{ display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end', marginTop: 'var(--sp-2)' }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" loading={loading}>{isEdit ? 'Save Changes' : 'Create Resource'}</Btn>
        </div>
      </form>
    </Modal>
  )
}

export function ProfilePage() {
  const user = useAuthStore(s => s.user)
  const setUser = useAuthStore(s => s.setUser)
  const [form, setForm] = useState({
    name: user?.name || '',
    phone: user?.phone || '',
    department: user?.department || '',
    bio: user?.bio || '',
    avatar: null,
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [pwForm, setPwForm] = useState({ old_password: '', new_password: '', confirm: '' })
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState('')
  const [isEditingPassword, setIsEditingPassword] = useState(false)

  useEffect(() => {
    if (!user) return
    setForm(prev => ({
      ...prev,
      name: user.name || '',
      phone: user.phone || '',
      department: user.department || '',
      bio: user.bio || '',
    }))
  }, [user])
  const avatarPreview = React.useMemo(
    () => (form.avatar ? URL.createObjectURL(form.avatar) : (user?.avatar || user?.avatar_url || '')),
    [form.avatar, user?.avatar, user?.avatar_url]
  )

  useEffect(() => () => {
    if (form.avatar && avatarPreview) URL.revokeObjectURL(avatarPreview)
  }, [avatarPreview, form.avatar])

  async function saveProfile(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => {
        if (k === 'avatar') {
          if (v) fd.append(k, v)
          return
        }
        fd.append(k, v ?? '')
      })
      const { data } = await authApi.updateMe(fd)
      setUser(data)
      setForm(prev => ({ ...prev, avatar: null }))
      setMsg('Profile updated!')
      setIsEditingProfile(false)
    } catch (err) {
      setMsg(extractError(err))
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(''), 3000)
    }
  }

  async function changePassword(e) {
    e.preventDefault()
    if (pwForm.new_password !== pwForm.confirm) { setPwMsg('Passwords do not match'); return }
    setPwSaving(true)
    try {
      await authApi.changePassword({ old_password: pwForm.old_password, new_password: pwForm.new_password })
      setPwMsg('Password changed!')
      setPwForm({ old_password: '', new_password: '', confirm: '' })
      setIsEditingPassword(false)
    } catch (err) {
      setPwMsg(extractError(err))
    } finally {
      setPwSaving(false)
      setTimeout(() => setPwMsg(''), 3000)
    }
  }

  if (!user) return null

  const ROLE_COLOR = { admin: 'var(--danger)', manager: 'var(--info)', resource: 'var(--success)', client: 'var(--warning)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)', maxWidth: 1120, margin: '0 auto', width: '100%' }}>

      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.8rem', letterSpacing: '-0.02em' }}>Profile</h1>

      {/* Top identity card — full width */}
      <div className="animate-rise-in" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
        {/* Accent banner */}
        <div style={{ height: 96, background: 'linear-gradient(135deg, rgba(35,114,39,0.28) 0%, rgba(59,73,83,0.55) 50%, rgba(19,36,64,0.9) 100%)', borderBottom: '1px solid var(--border)' }} />

        <div style={{ padding: '0 var(--sp-8) var(--sp-6)', marginTop: -40 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-4)' }}>
              <Avatar name={user.name} src={avatarPreview} size={88} role={user.role} />
              <div style={{ paddingBottom: 4 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.4rem', color: 'var(--text-0)' }}>{user.name}</div>
                <div style={{ fontSize: '15px', color: 'var(--text-3)', marginTop: 2 }}>{user.email}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  <span style={{ fontSize: '13px', padding: '3px 10px', borderRadius: 'var(--r-full)', background: 'rgba(35,114,39,0.12)', color: 'var(--accent)', border: '1px solid rgba(35,114,39,0.25)' }}>
                    {user.department || 'General'}
                  </span>
                  <span style={{ fontSize: '13px', padding: '3px 10px', borderRadius: 'var(--r-full)', background: 'rgba(122,166,184,0.12)', color: 'var(--info)', border: '1px solid rgba(122,166,184,0.25)' }}>
                    {user.phone || 'No phone added'}
                  </span>
                </div>
              </div>
            </div>
            <span style={{
              fontSize: '13px', fontWeight: 800, letterSpacing: '0.1em',
              textTransform: 'uppercase', padding: '4px 14px',
              borderRadius: 'var(--r-full)', marginBottom: 6,
              background: `${ROLE_COLOR[user.role]}18`,
              color: ROLE_COLOR[user.role],
              border: `1px solid ${ROLE_COLOR[user.role]}40`,
            }}>
              {user.role}
            </span>
          </div>
        </div>
      </div>

      {/* Two column layout — Edit Info + Change Password */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--sp-6)', alignItems: 'start' }}>

        {/* Edit Profile */}
        <div className="animate-rise-in" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ padding: 'var(--sp-4) var(--sp-6)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem' }}>Profile Details</div>
            <Btn variant={isEditingProfile ? 'secondary' : 'primary'} onClick={() => setIsEditingProfile(v => !v)}>
              {isEditingProfile ? 'Close Edit' : 'Edit Profile'}
            </Btn>
          </div>
          <div style={{ padding: 'var(--sp-6)', display: 'grid', gap: 'var(--sp-3)' }}>
            {[
              ['Name', user.name || 'Not set'],
              ['Phone', user.phone || 'Not added yet'],
              ['Department', user.department || 'Not assigned yet'],
              ['Role Summary', user.bio || 'No profile summary added yet'],
            ].map(([label, value]) => (
              <div key={label} style={{ padding: '14px 16px', borderRadius: 'var(--r-md)', background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: '15px', color: 'var(--text-1)' }}>{value}</div>
              </div>
            ))}
          </div>
          {isEditingProfile && <form onSubmit={saveProfile} style={{ padding: '0 var(--sp-6) var(--sp-6)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--sp-4)', alignItems: 'center', padding: 'var(--sp-4)', borderRadius: 'var(--r-md)', background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
              <Avatar name={user.name} src={avatarPreview} size={72} role={user.role} />
              <div>
                <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: 8 }}>Profile image</div>
                <input type="file" accept="image/*" onChange={e => setForm(f => ({ ...f, avatar: e.target.files?.[0] || null }))} style={{ width: '100%' }} />
                <div style={{ fontSize: '13px', color: 'var(--text-3)', marginTop: 6 }}>PNG, JPG, or WEBP up to 2 MB.</div>
              </div>
            </div>
            <Input label="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Enter your full name" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
              <Input label="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Add contact number" />
              <Input label="Department" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="Add team or department" />
            </div>
            <Textarea label="Role Summary" value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} placeholder="Add your role focus, working style, skills, or project context..." rows={5} />
            {msg && (
              <div style={{ fontSize: '14px', padding: '8px 12px', borderRadius: 'var(--r-md)', background: msg.includes('!') ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)', color: msg.includes('!') ? 'var(--success)' : 'var(--danger)' }}>
                {msg}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-3)' }}>
              <Btn variant="secondary" type="button" onClick={() => setIsEditingProfile(false)}>Cancel</Btn>
              <Btn type="submit" loading={saving}>Save Changes</Btn>
            </div>
          </form>}
        </div>

        {/* Change Password */}
        <div className="animate-rise-in" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ padding: 'var(--sp-4) var(--sp-6)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem' }}>Access & Security</div>
            <Btn variant={isEditingPassword ? 'secondary' : 'primary'} onClick={() => setIsEditingPassword(v => !v)}>
              {isEditingPassword ? 'Close Form' : 'Change Password'}
            </Btn>
          </div>
          <div style={{ padding: 'var(--sp-6)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            <div style={{ padding: '14px 16px', borderRadius: 'var(--r-md)', background: 'var(--surface-1)', border: '1px solid var(--border)', fontSize: '14px', color: 'var(--text-2)' }}>
              Your role permissions are still controlled by admins and managers. This section only updates your own password.
            </div>
            {isEditingPassword && <form onSubmit={changePassword} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', paddingTop: 'var(--sp-2)', borderTop: '1px solid var(--border)' }}>
            <Input label="Current Password" type="password" value={pwForm.old_password} onChange={e => setPwForm(f => ({ ...f, old_password: e.target.value }))} />
            <Input label="New Password" type="password" value={pwForm.new_password} onChange={e => setPwForm(f => ({ ...f, new_password: e.target.value }))} />
            <Input label="Confirm New Password" type="password" value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))} />
            {pwMsg && (
              <div style={{ fontSize: '14px', padding: '8px 12px', borderRadius: 'var(--r-md)', background: pwMsg.includes('!') ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)', color: pwMsg.includes('!') ? 'var(--success)' : 'var(--danger)' }}>
                {pwMsg}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-3)' }}>
              <Btn variant="secondary" type="button" onClick={() => setIsEditingPassword(false)}>Cancel</Btn>
              <Btn type="submit" loading={pwSaving}>Update Password</Btn>
            </div>
          </form>}
          </div>
        </div>

      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────
   SETTINGS PAGE
───────────────────────────────────────────────── */
export function SettingsPage() {
  const hasPermission = useAuthStore(s => s.hasPermission)
  const qc = useQueryClient()
  const [userSearch, setUserSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')

  const { data: users, isLoading: uLoad } = useQuery({
    queryKey: ['users-all'],
    queryFn: () => authApi.users({ page_size: 200 }).then(r => r.data.results || r.data),
    enabled: hasPermission('access_control'),
  })

  const { data: rolePerms, isLoading: rpLoad } = useQuery({
    queryKey: ['role-permissions'],
    queryFn: () => authApi.rolePermissions().then(r => r.data.results || r.data),
    enabled: hasPermission('access_control'),
  })

  async function toggleStatus(userId) {
    await authApi.toggleStatus(userId)
    qc.invalidateQueries({ queryKey: ['users-all'] })
  }

  async function changeRole(userId, role) {
    await authApi.changeRole(userId, role)
    qc.invalidateQueries({ queryKey: ['users-all'] })
  }

  if (!hasPermission('access_control')) {
    return <div style={{ color: 'var(--text-2)', padding: 'var(--sp-8)' }}>You don't have permission to view settings.</div>
  }

  const allUsers = users || []
  const filteredUsers = allUsers.filter(u => {
    const matchSearch = !userSearch || u.name.toLowerCase().includes(userSearch.toLowerCase()) || u.email.toLowerCase().includes(userSearch.toLowerCase())
    const matchRole = !roleFilter || u.role === roleFilter
    return matchSearch && matchRole
  })

  const roleCount = { admin: 0, manager: 0, resource: 0, client: 0 }
  allUsers.forEach(u => { if (roleCount[u.role] != null) roleCount[u.role]++ })
  const activeCount = allUsers.filter(u => u.is_active).length

  const ROLE_COLOR = { admin: 'var(--danger)', manager: 'var(--info)', resource: 'var(--success)', client: 'var(--warning)' }
  const ROLE_BG    = { admin: 'rgba(217,108,108,0.12)', manager: 'rgba(122,166,184,0.12)', resource: 'rgba(73,163,95,0.12)', client: 'rgba(111,166,118,0.12)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.8rem', letterSpacing: '-0.02em' }}>Settings</h1>

      {/* ── User Management ─────────────────────────────── */}
      <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>

        {/* Section header */}
        <div style={{ padding: 'var(--sp-4) var(--sp-5)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <Users size={16} color="var(--text-2)" />
            <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem' }}>User Management</h3>
            <span style={{ fontSize: '13px', color: 'var(--text-3)', background: 'var(--bg-3)', padding: '2px 8px', borderRadius: 'var(--r-full)', fontFamily: 'var(--font-mono)' }}>
              {activeCount}/{allUsers.length} active
            </span>
          </div>

          {/* Role summary pills */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(roleCount).map(([role, count]) => (
              <button key={role} onClick={() => setRoleFilter(f => f === role ? '' : role)} style={{
                background: roleFilter === role ? ROLE_BG[role] : 'var(--bg-2)',
                border: `1px solid ${roleFilter === role ? ROLE_COLOR[role] + '50' : 'var(--border)'}`,
                borderRadius: 'var(--r-full)', padding: '3px 10px', fontSize: '13px', fontWeight: 600,
                color: roleFilter === role ? ROLE_COLOR[role] : 'var(--text-3)',
                cursor: 'pointer', transition: 'all var(--t-fast)',
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: ROLE_COLOR[role], display: 'inline-block' }} />
                {role} <span style={{ opacity: 0.7 }}>{count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Search bar */}
        <div style={{ padding: 'var(--sp-3) var(--sp-5)', borderBottom: '1px solid var(--border)', background: 'var(--bg-2)' }}>
          <div style={{ position: 'relative', maxWidth: 340 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none', fontSize: 13 }}>🔍</span>
            <input
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
              placeholder="Search by name or email…"
              style={{
                width: '100%', background: 'var(--bg-1)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '14px',
                padding: '7px 12px 7px 32px', outline: 'none', boxSizing: 'border-box',
              }}
            />
            {(userSearch || roleFilter) && (
              <button onClick={() => { setUserSearch(''); setRoleFilter('') }} style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 13, padding: 2,
              }}>✕</button>
            )}
          </div>
        </div>

        {/* Table — fixed height, scrollable */}
        {uLoad ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--sp-8)' }}><Spinner /></div>
        ) : (
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-1)', zIndex: 1 }}>
                <tr>
                  {['User', 'Role', 'Status', 'Action'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '9px 16px', fontSize: '12px', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: 'var(--sp-6)', textAlign: 'center', color: 'var(--text-3)', fontSize: '15px' }}>No users match your search.</td></tr>
                ) : filteredUsers.map((u, i) => (
                  <tr key={u.id}
                    style={{ borderBottom: i < filteredUsers.length - 1 ? '1px solid var(--border)' : 'none', opacity: u.is_active ? 1 : 0.5 }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>

                    {/* User */}
                    <td style={{ padding: '10px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar name={u.name} src={u.avatar || u.avatar_url} size={30} role={u.role} />
                        <div>
                          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-0)' }}>{u.name}</div>
                          <div style={{ fontSize: '13px', color: 'var(--text-3)' }}>{u.email}</div>
                        </div>
                      </div>
                    </td>

                    {/* Role dropdown */}
                    <td style={{ padding: '10px 16px' }}>
                      <select value={u.role} onChange={e => changeRole(u.id, e.target.value)}
                        style={{
                          background: ROLE_BG[u.role], border: `1px solid ${ROLE_COLOR[u.role]}40`,
                          borderRadius: 'var(--r-sm)', color: ROLE_COLOR[u.role],
                          fontSize: '13px', fontWeight: 700, padding: '4px 8px',
                          cursor: 'pointer', outline: 'none', textTransform: 'capitalize',
                        }}>
                        {['admin', 'manager', 'resource', 'client'].map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>

                    {/* Status */}
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{
                        fontSize: '13px', fontWeight: 700, padding: '3px 9px', borderRadius: 'var(--r-full)',
                        background: u.is_active ? 'rgba(74,222,128,0.12)' : 'var(--bg-3)',
                        color: u.is_active ? 'var(--success)' : 'var(--text-3)',
                        border: `1px solid ${u.is_active ? 'rgba(74,222,128,0.3)' : 'var(--border)'}`,
                      }}>
                        {u.is_active ? '● Active' : '○ Inactive'}
                      </span>
                    </td>

                    {/* Toggle */}
                    <td style={{ padding: '10px 16px' }}>
                      <button onClick={() => toggleStatus(u.id)} style={{
                        background: 'none',
                        border: `1px solid ${u.is_active ? 'var(--border)' : 'rgba(74,222,128,0.4)'}`,
                        borderRadius: 'var(--r-sm)', cursor: 'pointer', padding: '4px 12px',
                        fontSize: '13px', fontWeight: 600,
                        color: u.is_active ? 'var(--text-3)' : 'var(--success)',
                        transition: 'all var(--t-fast)',
                      }}
                        onMouseEnter={e => {
                          e.currentTarget.style.borderColor = u.is_active ? 'var(--danger)' : 'var(--success)'
                          e.currentTarget.style.color = u.is_active ? 'var(--danger)' : 'var(--success)'
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.borderColor = u.is_active ? 'var(--border)' : 'rgba(74,222,128,0.4)'
                          e.currentTarget.style.color = u.is_active ? 'var(--text-3)' : 'var(--success)'
                        }}
                      >
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer count */}
        {!uLoad && filteredUsers.length > 0 && (
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-2)', fontSize: '13px', color: 'var(--text-3)' }}>
            Showing {filteredUsers.length} of {allUsers.length} users
          </div>
        )}
      </div>

      <NotificationPreferencesSection />

      <EmailRoutingSection />

      {/* ── Role Permissions ─────────────────────────────── */}
      <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        <div style={{ padding: 'var(--sp-4) var(--sp-5)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <Shield size={16} color="var(--text-2)" />
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem' }}>Role Permissions</h3>
        </div>
        {rpLoad ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--sp-8)' }}><Spinner /></div>
        ) : (
          <div style={{ padding: 'var(--sp-5)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            {(rolePerms || []).map(rp => (
              <div key={rp.id} style={{ background: 'var(--bg-2)', borderRadius: 'var(--r-md)', padding: 'var(--sp-4)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--sp-3)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: ROLE_COLOR[rp.role] || 'var(--text-3)', display: 'inline-block' }} />
                  <span style={{ fontSize: '14px', fontWeight: 700, color: ROLE_COLOR[rp.role] || 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{rp.role}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {Object.entries(rp.permissions || {}).map(([key, val]) => (
                    <div key={key} style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px',
                      background: val ? 'rgba(74,222,128,0.08)' : 'var(--bg-3)',
                      border: `1px solid ${val ? 'rgba(74,222,128,0.25)' : 'var(--border)'}`,
                      borderRadius: 'var(--r-full)', fontSize: '13px',
                      color: val ? 'var(--success)' : 'var(--text-3)',
                    }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: val ? 'var(--success)' : 'var(--text-3)', flexShrink: 0 }} />
                      {key}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────
   NOTIFICATION PREFERENCES SECTION (used in Settings)
───────────────────────────────────────────────── */
// All notification types — hardcoded to avoid extra API call
const NOTIF_TYPES = [
  { value: 'project_assigned', label: 'Project Assigned' },
  { value: 'status_change',    label: 'Status Change' },
  { value: 'deadline',         label: 'Deadline' },
  { value: 'timeline_complete',label: 'Timeline Complete' },
  { value: 'update',           label: 'Project Update' },
  { value: 'mention',          label: 'Mention' },
]


const EMAIL_EVENT_MATRIX = [
  {
    event: 'Login OTP',
    admin: true,
    manager: true,
    resource: true,
    client: true,
    rule: 'Sent only to the user who is logging in. Valid for 90 seconds.',
  },
  {
    event: 'Project Assigned',
    admin: false,
    manager: false,
    resource: true,
    client: false,
    rule: 'Sent to the assigned resource when added from assign action or project edit.',
  },
  {
    event: 'Project Updated',
    admin: false,
    manager: true,
    resource: true,
    client: false,
    rule: 'Sent to the visible project team currently assigned on that project.',
  },
  {
    event: 'Project Update Note',
    admin: false,
    manager: true,
    resource: true,
    client: false,
    rule: 'Sent to the same project team whenever an update/note is posted.',
  },
  {
    event: 'Timesheet Submitted',
    admin: false,
    manager: true,
    resource: false,
    client: false,
    rule: "Sent only to the resource's assigned manager for approval.",
  },
  {
    event: 'Timesheet Approved',
    admin: false,
    manager: false,
    resource: true,
    client: false,
    rule: 'Sent to the resource after their assigned manager approves the entry.',
  },
  {
    event: 'Project Approval Resolved',
    admin: false,
    manager: true,
    resource: false,
    client: false,
    rule: 'Sent to the manager/requester after approve or reject.',
  },
  {
    event: 'Timeline Approval Resolved',
    admin: false,
    manager: true,
    resource: true,
    client: false,
    rule: 'Sent to the user who created the timeline approval request.',
  },
]

function EmailRoutingSection() {
  return (
    <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
      <div style={{ padding: 'var(--sp-4) var(--sp-5)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <Mail size={16} color="var(--text-2)" />
          <div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem' }}>Email Delivery Matrix</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-3)', marginTop: 2 }}>Read-only map of which workflow sends email to which role.</p>
          </div>
        </div>
        <span style={{ fontSize: '13px', color: 'var(--text-3)', background: 'var(--bg-3)', padding: '2px 8px', borderRadius: 'var(--r-full)', fontFamily: 'var(--font-mono)' }}>live rules</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Email Event', 'Admin', 'Manager', 'Resource', 'Client', 'Rule'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: '13px', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {EMAIL_EVENT_MATRIX.map((row, index) => (
              <tr key={row.event} style={{ borderBottom: index < EMAIL_EVENT_MATRIX.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <td style={{ padding: '14px 16px', fontWeight: 700, fontSize: '15px', color: 'var(--text-0)' }}>{row.event}</td>
                {['admin', 'manager', 'resource', 'client'].map(role => (
                  <td key={role} style={{ padding: '14px 16px' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: row[role] ? 'var(--success)' : 'var(--text-3)', fontSize: '14px', fontWeight: 600 }}>
                      <input type="checkbox" checked={row[role]} readOnly disabled style={{ width: 14, height: 14, accentColor: 'var(--accent)' }} />
                      {row[role] ? 'Yes' : 'No'}
                    </label>
                  </td>
                ))}
                <td style={{ padding: '14px 16px', fontSize: '14px', color: 'var(--text-2)', lineHeight: 1.6, minWidth: 280 }}>{row.rule}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


export function NotificationPreferencesSection() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [approvingId, setApprovingId] = useState(null)

  const { data: resources, isLoading: rLoad } = useQuery({
    queryKey: ['users-resources'],
    queryFn: () => authApi.users({ page_size: 200, role: 'resource' }).then(r => r.data.results || r.data),
  })

  const { data: existingPrefs } = useQuery({
    queryKey: ['notif-prefs'],
    queryFn: () => notificationsApi.listPrefs().then(r => r.data.results || r.data),
  })

  const prefsMap = {}
  ;(existingPrefs || []).forEach(p => {
    prefsMap[p.resource] = { id: p.id, allowed_types: p.allowed_types }
  })

  async function toggleType(resourceId, notifType, currentAllowed) {
    const isAllowed = currentAllowed.includes(notifType)
    const newTypes = isAllowed
      ? currentAllowed.filter(t => t !== notifType)
      : [...currentAllowed, notifType]
    const existing = prefsMap[resourceId]
    if (existing?.id) {
      await notificationsApi.updatePrefs(existing.id, { allowed_types: newTypes })
    } else {
      await notificationsApi.createPrefs({ resource: resourceId, allowed_types: newTypes })
    }
    qc.invalidateQueries({ queryKey: ['notif-prefs'] })
  }

  const allResources = (resources || []).filter(u => u.role === 'resource')
  const filtered = allResources.filter(r =>
    !search || r.name.toLowerCase().includes(search.toLowerCase()) || (r.email || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: 'var(--sp-4) var(--sp-5)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <Bell size={16} color="var(--text-2)" />
          <div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem' }}>Resource Notification Permissions</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-3)', marginTop: 2 }}>Toggle which notifications each resource receives.</p>
          </div>
        </div>
        <span style={{ fontSize: '13px', color: 'var(--text-3)', background: 'var(--bg-3)', padding: '2px 8px', borderRadius: 'var(--r-full)', fontFamily: 'var(--font-mono)' }}>
          {allResources.length} resources
        </span>
      </div>

      {/* Search */}
      <div style={{ padding: 'var(--sp-3) var(--sp-5)', borderBottom: '1px solid var(--border)', background: 'var(--bg-2)' }}>
        <div style={{ position: 'relative', maxWidth: 340 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none', fontSize: 13 }}>🔍</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search resources…"
            style={{
              width: '100%', background: 'var(--bg-1)', border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '14px',
              padding: '7px 12px 7px 32px', outline: 'none', boxSizing: 'border-box',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 13, padding: 2,
            }}>✕</button>
          )}
        </div>
      </div>

      {/* Table — fixed height, scrollable */}
      {rLoad ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--sp-8)' }}><Spinner /></div>
      ) : (
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-1)', zIndex: 1 }}>
              <tr>
                <th style={{ textAlign: 'left', padding: '9px 16px', fontSize: '12px', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--border)', width: 200 }}>Resource</th>
                {NOTIF_TYPES.map(t => (
                  <th key={t.value} style={{ textAlign: 'center', padding: '9px 10px', fontSize: '12px', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                    {t.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={NOTIF_TYPES.length + 1} style={{ padding: 'var(--sp-6)', textAlign: 'center', color: 'var(--text-3)', fontSize: '15px' }}>No resources found.</td></tr>
              ) : filtered.map((resource, i) => {
                const prefs = prefsMap[resource.id]
                const allowed = prefs?.allowed_types ?? NOTIF_TYPES.map(t => t.value)
                return (
                  <tr key={resource.id}
                    style={{ borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>

                    {/* Resource info */}
                    <td style={{ padding: '10px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar name={resource.name} size={28} role="resource" />
                        <div>
                          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-0)' }}>{resource.name}</div>
                          <div style={{ fontSize: '13px', color: 'var(--text-3)' }}>{resource.department || 'Resource'}</div>
                        </div>
                      </div>
                    </td>

                    {/* Toggle per notification type */}
                    {NOTIF_TYPES.map(type => {
                      const on = allowed.includes(type.value)
                      return (
                        <td key={type.value} style={{ textAlign: 'center', padding: '10px' }}>
                          <button
                            onClick={() => toggleType(resource.id, type.value, allowed)}
                            title={on ? `Disable ${type.label}` : `Enable ${type.label}`}
                            style={{
                              width: 28, height: 28, borderRadius: 'var(--r-sm)',
                              border: `1px solid ${on ? 'rgba(35,114,39,0.35)' : 'var(--border)'}`,
                              background: on ? 'rgba(35,114,39,0.12)' : 'var(--bg-3)',
                              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'all var(--t-fast)', margin: '0 auto',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = on ? 'var(--danger)' : 'var(--accent)'; e.currentTarget.style.transform = 'scale(1.1)' }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = on ? 'rgba(35,114,39,0.35)' : 'var(--border)'; e.currentTarget.style.transform = 'scale(1)' }}
                          >
                            {on
                              ? <span style={{ fontSize: 13, color: 'var(--accent)', lineHeight: 1 }}>✓</span>
                              : <span style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1 }}>—</span>
                            }
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      {!rLoad && filtered.length > 0 && (
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-2)', fontSize: '13px', color: 'var(--text-3)' }}>
          Showing {filtered.length} of {allResources.length} resources
        </div>
      )}
    </div>
  )
}