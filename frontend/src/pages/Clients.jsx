import React, { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Building2, Search, Download } from 'lucide-react'
import { clientsApi } from '@/api/index.js'
import { Btn, Badge, EmptyState, Modal, Input, Select, Textarea, Pagination, Alert, FormGrid } from '@/components/ui/index.jsx'
import { downloadBlob, extractError, timeAgo } from '@/utils/index.js'
import { useAuthStore } from '@/stores/authStore.js'

const STATUS_COLOR = { active: 'var(--success)', prospect: 'var(--info)', inactive: 'var(--text-3)' }
const PAGE_SIZE = 15

export default function ClientsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    setPage(1)
  }, [search, statusFilter])

  const { data, isLoading } = useQuery({
    queryKey: ['clients', search, statusFilter, page],
    queryFn: () => clientsApi.list({
      search: search || undefined,
      status: statusFilter || undefined,
      page,
      page_size: PAGE_SIZE,
    }).then(r => r.data),
  })

  const clients = data?.results || data || []
  const total = data?.count ?? clients.length
  const totalPages = data?.total_pages ?? 1

  async function exportClients() {
    setExporting(true)
    try {
      const response = await clientsApi.export()
      downloadBlob(response, 'clients.xlsx')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.8rem', letterSpacing: '-0.02em' }}>Clients</h1>
          <p style={{ color: 'var(--text-2)', fontSize: '14px', marginTop: 4 }}>{total} total</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          {isAdmin && <Btn variant="ghost" icon={<Download size={14} />} loading={exporting} onClick={exportClients}>Export Excel</Btn>}
          {isAdmin && <Btn icon={<Plus size={14} />} onClick={() => setShowCreate(true)}>New Client</Btn>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients..."
            style={{ width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '8px 12px 8px 32px', outline: 'none' }} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-1)', fontSize: '15px', padding: '8px 12px', outline: 'none', cursor: 'pointer' }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 'var(--sp-8)', display: 'flex', justifyContent: 'center' }}>
            <div style={{ color: 'var(--text-3)', fontSize: '14px' }}>Loading...</div>
          </div>
        ) : clients.length === 0 ? (
          <EmptyState icon={Building2} title="No clients found" description="Add your first client to get started." />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Client Name', 'Contact Person 1', 'Contact Person 2', 'Email 1', 'Email 2', 'Website', 'Status', 'Projects', 'Added'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: '13px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map((c, i) => (
                <tr key={c.id}
                  onClick={() => navigate(`/clients/${c.id}`)}
                  style={{ borderBottom: i < clients.length - 1 ? '1px solid var(--border)' : 'none', cursor: 'pointer', transition: 'background var(--t-fast)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                      <div style={{ width: 32, height: 32, borderRadius: 'var(--r-md)', background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-display)', flexShrink: 0 }}>
                        {c.name[0].toUpperCase()}
                      </div>
                      <span style={{ fontWeight: 600, fontSize: '15px', whiteSpace: 'nowrap' }}>{c.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '15px', color: 'var(--text-2)' }}>{c.contact_person || '?'}</td>
                  <td style={{ padding: '12px 16px', fontSize: '15px', color: 'var(--text-2)' }}>{c.contact_person2 || '?'}</td>
                  <td style={{ padding: '12px 16px', fontSize: '14px', color: 'var(--text-2)' }}>{c.email || '?'}</td>
                  <td style={{ padding: '12px 16px', fontSize: '14px', color: 'var(--text-2)' }}>{c.email2 || '?'}</td>
                  <td style={{ padding: '12px 16px', fontSize: '14px', color: 'var(--text-3)' }}>
                    {c.website ? c.website.replace(/^https?:\/\//, '') : '?'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <Badge color={STATUS_COLOR[c.status]}>{c.status}</Badge>
                  </td>
                  <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: '15px', color: 'var(--text-2)' }}>
                    {c.project_count ?? '?'}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{timeAgo(c.onboarded_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        loading={isLoading}
      />

      {showCreate && <CreateClientModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); setPage(1); qc.invalidateQueries({ queryKey: ['clients'] }) }} />}
    </div>
  )
}

function CreateClientModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '',
    email: '', email2: '',
    phone: '', phone2: '',
    contact_person: '', contact_person2: '',
    website: '',
    status: 'active',
    notes: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      await clientsApi.create({
        name: form.name,
        email: form.email,
        email2: form.email2,
        phone: form.phone,
        phone2: form.phone2,
        contact_person: form.contact_person,
        contact_person2: form.contact_person2,
        website: form.website,
        notes: form.notes,
        status: form.status,
      })
      onCreated()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="New Client" width={640}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        {error && <Alert type="error" message={error} onClose={() => setError('')} />}

        <Input label="Company Name" value={form.name} onChange={e => f('name', e.target.value)} required />

        <FormGrid>
          <Input label="Email 1" type="email" value={form.email} onChange={e => f('email', e.target.value)} required />
          <Input label="Email 2" type="email" value={form.email2} onChange={e => f('email2', e.target.value)} />
        </FormGrid>

        <FormGrid>
          <Input label="Phone 1" value={form.phone} onChange={e => f('phone', e.target.value)} />
          <Input label="Phone 2" value={form.phone2} onChange={e => f('phone2', e.target.value)} />
        </FormGrid>

        <FormGrid>
          <Input label="Name 1" value={form.contact_person} onChange={e => f('contact_person', e.target.value)} />
          <Input label="Name 2" value={form.contact_person2} onChange={e => f('contact_person2', e.target.value)} />
        </FormGrid>

        <FormGrid>
          <Input label="Website" value={form.website} onChange={e => f('website', e.target.value)} placeholder="https://example.com" />
          <Select label="Status" value={form.status} onChange={e => f('status', e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </FormGrid>

        <Textarea label="Notes" value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Internal notes..." rows={3} />

        <div style={{ display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end', marginTop: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" loading={loading}>Create Client</Btn>
        </div>
      </form>
    </Modal>
  )
}