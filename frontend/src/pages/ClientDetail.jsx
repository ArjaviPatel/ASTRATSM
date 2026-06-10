import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Briefcase, User, Mail, Phone, Globe, Edit2, Trash2, Plus, X, Save } from 'lucide-react'
import { clientsApi } from '@/api/index.js'
import { Btn, Badge, Tabs, Spinner, Input, Textarea, Modal, Alert } from '@/components/ui/index.jsx'
import { STATUS_COLOR, STATUS_LABEL, PRIORITY_COLOR, PRIORITY_LABEL, formatDate, timeAgo, extractError } from '@/utils/index.js'
import { useAuthStore } from '@/stores/authStore.js'

const CLIENT_STATUS_COLOR = {
  active: 'var(--success)',
  prospect: 'var(--info)',
  inactive: 'var(--text-3)',
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'projects', label: 'Projects', icon: Briefcase },
  { id: 'contacts', label: 'Contacts', icon: User },
]

export default function ClientDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState('overview')
  const [editing, setEditing] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showAddContact, setShowAddContact] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(null)

  const user = useAuthStore(s => s.user)
  const canEdit = user?.role === 'admin'

  const { data: client, isLoading } = useQuery({
    queryKey: ['client', id],
    queryFn: () => clientsApi.get(id).then(r => r.data),
  })

  const { data: clientProjects, isLoading: projectsLoading } = useQuery({
    queryKey: ['client-projects', id],
    queryFn: () => clientsApi.getProjects(id).then(r => r.data),
  })

  function startEdit() {
    setForm({
      name:             client.name || '',
      email:            client.email || '',
      email2:           client.email2 || '',
      phone:            client.phone || '',
      phone2:           client.phone2 || '',
      contact_person:   client.contact_person || '',
      contact_person2:  client.contact_person2 || '',
      website:          client.website || '',
      notes:            client.notes || '',
      status:           client.status || 'active',
    })
    setEditing(true)
    setError('')
  }

  function cancelEdit() {
    setEditing(false)
    setForm(null)
    setError('')
  }

  async function saveEdit() {
    setSaving(true)
    setError('')
    try {
      await clientsApi.update(id, {
        name:            form.name,
        email:           form.email,
        email2:          form.email2,
        phone:           form.phone,
        phone2:          form.phone2,
        contact_person:  form.contact_person,
        contact_person2: form.contact_person2,
        website:         form.website,
        notes:           form.notes,
        status:          form.status,
      })
      await qc.invalidateQueries(['client', id])
      await qc.invalidateQueries(['clients'])
      setEditing(false)
      setForm(null)
    } catch (err) {
      setError(extractError(err))
    } finally {
      setSaving(false)
    }
  }

  async function deleteClient() {
    try {
      await clientsApi.delete(id)
      qc.invalidateQueries(['clients'])
      navigate('/clients')
    } catch (err) {
      setError(extractError(err))
    }
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  if (isLoading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--sp-16)' }}>
      <Spinner size={32} />
    </div>
  )

  if (!client) return <div style={{ color: 'var(--text-2)' }}>Client not found.</div>

  const c = editing ? { ...client, ...form } : client

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>

      {/* Back */}
      <button onClick={() => navigate('/clients')}
        style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', width: 'fit-content' }}>
        <ArrowLeft size={14} /> Back to Clients
      </button>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)' }}>
          {client.logo_url ? (
            <img src={client.logo_url} alt={client.name}
              style={{ width: 56, height: 56, borderRadius: 'var(--r-lg)', objectFit: 'cover', border: '1px solid var(--border)' }} />
          ) : (
            <div style={{ width: 56, height: 56, borderRadius: 'var(--r-lg)', background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-display)', border: '1px solid var(--border)' }}>
              {client.name[0].toUpperCase()}
            </div>
          )}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 4 }}>
              <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.8rem', letterSpacing: '-0.02em' }}>{client.name}</h1>
              <Badge color={CLIENT_STATUS_COLOR[client.status]}>{client.status}</Badge>
            </div>
            <div style={{ color: 'var(--text-2)', fontSize: '14px' }}>
              {client.industry || 'No industry'} · Added {timeAgo(client.onboarded_at)}
            </div>
          </div>
        </div>

        {canEdit && !editing && (
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <Btn variant="ghost" size="sm" onClick={startEdit} icon={<Edit2 size={14} />}>Edit</Btn>
            <Btn variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(true)}
              style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
              icon={<Trash2 size={14} />}>Delete</Btn>
          </div>
        )}

        {canEdit && editing && (
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <Btn variant="ghost" size="sm" onClick={cancelEdit} icon={<X size={14} />}>Cancel</Btn>
            <Btn size="sm" loading={saving} onClick={saveEdit} icon={<Save size={14} />}>Save Changes</Btn>
          </div>
        )}
      </div>

      {error && <Alert type="error" message={error} onClose={() => setError('')} />}

      {/* Edit Form */}
      {editing && form && (
        <div style={{ background: 'var(--bg-1)', border: '1px solid var(--accent)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-5)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Editing Client</div>

          {/* Company Name */}
          <Input label="Company Name" value={form.name} onChange={e => f('name', e.target.value)} required />

          {/* Email 1 & Email 2 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
            <Input label="Email 1" type="email" value={form.email} onChange={e => f('email', e.target.value)} />
            <Input label="Email 2" type="email" value={form.email2} onChange={e => f('email2', e.target.value)} />
          </div>

          {/* Phone 1 & Phone 2 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
            <Input label="Phone 1" value={form.phone} onChange={e => f('phone', e.target.value)} />
            <Input label="Phone 2" value={form.phone2} onChange={e => f('phone2', e.target.value)} />
          </div>

          {/* Contact Person 1 & 2 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
            <Input label="Contact Person 1" value={form.contact_person} onChange={e => f('contact_person', e.target.value)} />
            <Input label="Contact Person 2" value={form.contact_person2} onChange={e => f('contact_person2', e.target.value)} />
          </div>

          {/* Website & Status */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
            <Input label="Website" value={form.website} onChange={e => f('website', e.target.value)} placeholder="https://" />
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>Status</div>
              <select value={form.status} onChange={e => f('status', e.target.value)}
                style={{ width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-1)', fontSize: '15px', padding: '8px 12px', outline: 'none' }}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <Textarea label="Notes" value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Internal notes about this client…" />
        </div>
      )}

      {/* Metric Boxes — read-only view */}
      {!editing && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--sp-3)' }}>
          <MetricBox icon={Mail}      label="Email 1"          value={c.email} />
          <MetricBox icon={Mail}      label="Email 2"          value={c.email2} />
          <MetricBox icon={Phone}     label="Phone 1"          value={c.phone} />
          <MetricBox icon={Phone}     label="Phone 2"          value={c.phone2} />
          <MetricBox icon={User}      label="Contact Person 1" value={c.contact_person} />
          <MetricBox icon={User}      label="Contact Person 2" value={c.contact_person2} />
          <MetricBox icon={Globe}     label="Website"          value={c.website ? c.website.replace(/^https?:\/\//, '') : null} />
          <MetricBox icon={Briefcase} label="Projects"         value={c.project_count != null ? String(c.project_count) : '—'} />
        </div>
      )}

      {/* Tabs */}
      <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        <div style={{ padding: 'var(--sp-4) var(--sp-5) 0', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Tabs
            tabs={TABS.map(t => ({
              ...t,
              count: t.id === 'projects' ? c.project_count : t.id === 'contacts' ? c.contacts?.length : undefined
            }))}
            active={tab}
            onChange={setTab}
          />
          {canEdit && tab === 'contacts' && (
            <Btn size="sm" onClick={() => setShowAddContact(true)} icon={<Plus size={13} />} style={{ marginBottom: 'var(--sp-2)' }}>
              Add Contact
            </Btn>
          )}
        </div>
        <div style={{ padding: 'var(--sp-6)' }}>
          {tab === 'overview' && <OverviewTab client={c} />}
          {tab === 'projects' && <ProjectsTab projects={clientProjects} loading={projectsLoading} navigate={navigate} />}
          {tab === 'contacts' && (
            <ContactsTab
              contacts={c.contacts || []}
              clientId={id}
              canEdit={canEdit}
              onRefresh={() => qc.invalidateQueries(['client', id])}
            />
          )}
        </div>
      </div>

      {/* Delete Confirm Modal */}
      {showDeleteConfirm && (
        <Modal open onClose={() => setShowDeleteConfirm(false)} title="Delete Client" width={420}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
            <p style={{ color: 'var(--text-2)', fontSize: '14px' }}>
              Are you sure you want to delete <strong style={{ color: 'var(--text-0)' }}>{client.name}</strong>? This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end' }}>
              <Btn variant="ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</Btn>
              <Btn onClick={deleteClient} style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}>Delete Client</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Add Contact Modal */}
      {showAddContact && (
        <AddContactModal
          clientId={id}
          onClose={() => setShowAddContact(false)}
          onSaved={() => { qc.invalidateQueries(['client', id]); setShowAddContact(false) }}
        />
      )}

    </div>
  )
}

/* ── Sub-components ─────────────────────────────────────── */

function MetricBox({ icon: Icon, label, value }) {
  return (
    <div style={{
      background: 'var(--bg-1)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      padding: 'var(--sp-4)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon size={11} color="var(--text-3)" />
        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {label}
        </span>
      </div>
      <div style={{
        fontSize: '15px',
        fontWeight: 600,
        color: value ? 'var(--text-0)' : 'var(--text-3)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {value || '—'}
      </div>
    </div>
  )
}

function OverviewTab({ client: c }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      {c.notes && (
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 'var(--sp-2)' }}>Notes</div>
          <p style={{ fontSize: '14px', color: 'var(--text-1)', lineHeight: 1.7 }}>{c.notes}</p>
        </div>
      )}
      {!c.notes && (
        <p style={{ color: 'var(--text-3)', fontSize: '14px' }}>No additional notes.</p>
      )}
    </div>
  )
}

function ProjectsTab({ projects, loading, navigate }) {
  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--sp-10)' }}>
      <div style={{ color: 'var(--text-3)', fontSize: '14px' }}>Loading projects…</div>
    </div>
  )
  if (!projects || !projects.length) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-3)', padding: 'var(--sp-10)' }}>
      <Briefcase size={32} color="var(--text-3)" />
      <p style={{ color: 'var(--text-3)', fontSize: '14px' }}>No projects linked to this client.</p>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      {projects.map(p => {
        const progress = p.progress ?? 0
        const budgetUtil = p.budget_utilization ?? 0
        const isOverBudget = parseFloat(p.spent) > parseFloat(p.budget) && parseFloat(p.budget) > 0

        return (
          <div
            key={p.id}
            onClick={() => navigate(`/projects/${p.id}`)}
            style={{
              background: 'var(--bg-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              padding: 'var(--sp-4) var(--sp-5)',
              cursor: 'pointer',
              transition: 'all var(--t-fast)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--sp-3)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--bg-3)'
              e.currentTarget.style.borderColor = 'var(--border-light)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'var(--bg-2)'
              e.currentTarget.style.borderColor = 'var(--border)'
            }}
          >
            {/* Row 1 — Name + Badges */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', minWidth: 0 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: `var(--status-${p.status?.replace('_', '-')})`,
                }} />
                <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexShrink: 0 }}>
                <Badge color={STATUS_COLOR[p.status]}>{STATUS_LABEL[p.status] || p.status}</Badge>
                <Badge color={PRIORITY_COLOR[p.priority]}>{PRIORITY_LABEL[p.priority] || p.priority}</Badge>
              </div>
            </div>

            {/* Row 2 — Meta info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
              {(p.start_date || p.end_date) && (
                <span style={{ fontSize: '14px', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  📅 {p.start_date ? formatDate(p.start_date) : '?'} → {p.end_date ? formatDate(p.end_date) : '?'}
                </span>
              )}
              {p.manager_name && (
                <span style={{ fontSize: '14px', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  👤 {p.manager_name}
                </span>
              )}
              {p.resource_count !== undefined && (
                <span style={{ fontSize: '14px', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  🔧 {p.resource_count} resource{p.resource_count !== 1 ? 's' : ''}
                </span>
              )}
              {parseFloat(p.budget) > 0 && (
                <span style={{ fontSize: '14px', color: isOverBudget ? 'var(--danger)' : 'var(--text-3)', fontWeight: isOverBudget ? 600 : 400 }}>
                  💰 ${parseFloat(p.spent).toLocaleString()} / ${parseFloat(p.budget).toLocaleString()}
                  {isOverBudget && ' ⚠ Over budget'}
                </span>
              )}
            </div>

            {/* Row 3 — Progress bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
              <div style={{ flex: 1, height: 5, background: 'var(--bg-4)', borderRadius: 'var(--r-full)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${progress}%`,
                  borderRadius: 'var(--r-full)',
                  background: progress === 100 ? 'var(--success)' : 'var(--accent)',
                  transition: 'width 0.4s ease',
                }} />
              </div>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-2)', minWidth: 32, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                {progress}%
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ContactsTab({ contacts, clientId, canEdit, onRefresh }) {
  const [deletingId, setDeletingId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving] = useState(false)

  async function deleteContact(contactId) {
    setDeletingId(contactId)
    try {
      await clientsApi.deleteContact(contactId)
      onRefresh()
    } finally {
      setDeletingId(null)
    }
  }

  function startEditContact(contact) {
    setEditingId(contact.id)
    setEditForm({ name: contact.name, email: contact.email || '', phone: contact.phone || '', position: contact.position || '', is_primary: contact.is_primary || false })
  }

  async function saveContact() {
    setSaving(true)
    try {
      await clientsApi.updateContact(editingId, editForm)
      setEditingId(null)
      onRefresh()
    } finally {
      setSaving(false)
    }
  }

  const ef = (k, v) => setEditForm(p => ({ ...p, [k]: v }))

  if (!contacts.length) return <p style={{ color: 'var(--text-3)', fontSize: '14px' }}>No contacts added.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      {contacts.map(contact => (
        <div key={contact.id} style={{ background: 'var(--bg-2)', borderRadius: 'var(--r-md)', border: `1px solid ${editingId === contact.id ? 'var(--accent)' : 'var(--border)'}`, overflow: 'hidden' }}>
          {editingId === contact.id ? (
            <div style={{ padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' }}>
                <Input label="Name" value={editForm.name} onChange={e => ef('name', e.target.value)} />
                <Input label="Position" value={editForm.position} onChange={e => ef('position', e.target.value)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' }}>
                <Input label="Email" type="email" value={editForm.email} onChange={e => ef('email', e.target.value)} />
                <Input label="Phone" value={editForm.phone} onChange={e => ef('phone', e.target.value)} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '15px', color: 'var(--text-2)' }}>
                  <input type="checkbox" checked={editForm.is_primary} onChange={e => ef('is_primary', e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
                  Primary contact
                </label>
                <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                  <Btn variant="ghost" size="sm" onClick={() => setEditingId(null)}><X size={13} /></Btn>
                  <Btn size="sm" loading={saving} onClick={saveContact}><Save size={13} /> Save</Btn>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', padding: 'var(--sp-4)' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-display)', flexShrink: 0 }}>
                {contact.name[0].toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '15px', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                  {contact.name}
                  {contact.is_primary && <Badge color="var(--accent)">Primary</Badge>}
                </div>
                <div style={{ fontSize: '14px', color: 'var(--text-3)' }}>
                  {contact.position && <span>{contact.position} · </span>}
                  {contact.email}
                  {contact.phone && <span> · {contact.phone}</span>}
                </div>
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => startEditContact(contact)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4 }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}>
                    <Edit2 size={13} />
                  </button>
                  <button onClick={() => deleteContact(contact.id)} disabled={deletingId === contact.id}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4 }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}>
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function AddContactModal({ clientId, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', position: '', is_primary: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  async function submit() {
    setLoading(true)
    setError('')
    try {
      await clientsApi.addContact(clientId, form)
      onSaved()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Add Contact" width={460}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        {error && <Alert type="error" message={error} onClose={() => setError('')} />}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' }}>
          <Input label="Full Name" value={form.name} onChange={e => f('name', e.target.value)} required />
          <Input label="Position / Role" value={form.position} onChange={e => f('position', e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' }}>
          <Input label="Email" type="email" value={form.email} onChange={e => f('email', e.target.value)} />
          <Input label="Phone" value={form.phone} onChange={e => f('phone', e.target.value)} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '15px', color: 'var(--text-2)' }}>
          <input type="checkbox" checked={form.is_primary} onChange={e => f('is_primary', e.target.checked)}
            style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
          Mark as primary contact
        </label>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn loading={loading} onClick={submit}>Add Contact</Btn>
        </div>
      </div>
    </Modal>
  )
}