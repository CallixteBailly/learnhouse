'use client'
import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Briefcase, CircleNotch, Plus } from '@phosphor-icons/react'

interface JobTitle {
  id: number
  label: string
  slug: string
  is_active: boolean
  sort_order: number
}

// NOTE: the admin table is fed by the public list (active titles only).
// Deactivated titles therefore disappear from this view — the backend does
// not expose an admin listing endpoint yet.
export default function JobTitleList() {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()

  const [newLabel, setNewLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [deactivatingId, setDeactivatingId] = useState<number | null>(null)
  const [deactivateError, setDeactivateError] = useState('')

  const { data, isLoading, isError } = useQuery<JobTitle[]>({
    queryKey: ['superadmin', 'job-titles'],
    queryFn: () => apiFetch(`${getAPIUrl()}job-titles/public`, accessToken),
    enabled: !!accessToken,
  })

  const titles = data ?? []
  const canCreate = newLabel.trim().length > 0 && !creating

  const handleCreate = async () => {
    setCreating(true)
    setCreateError('')
    try {
      const res = await fetch(`${getAPIUrl()}job-titles/admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ label: newLabel.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCreateError(body?.detail || `Failed to create (${res.status})`)
        return
      }
      setNewLabel('')
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'job-titles'] })
    } catch {
      setCreateError('Network error')
    } finally {
      setCreating(false)
    }
  }

  const handleDeactivate = async (id: number) => {
    setDeactivatingId(id)
    setDeactivateError('')
    try {
      const res = await fetch(`${getAPIUrl()}job-titles/admin/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setDeactivateError(body?.detail || `Failed to deactivate (${res.status})`)
        return
      }
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'job-titles'] })
    } catch {
      setDeactivateError('Network error')
    } finally {
      setDeactivatingId(null)
    }
  }

  return (
    <div>
      {/* Toolbar: create */}
      <div className="flex items-center gap-2 mb-4">
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canCreate) handleCreate()
          }}
          placeholder="New job title (e.g. Data Analyst)"
          className="bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20 w-72"
        />
        <button
          onClick={handleCreate}
          disabled={!canCreate}
          className="flex items-center gap-2 px-3.5 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {creating ? (
            <CircleNotch size={14} className="animate-spin" />
          ) : (
            <Plus size={14} weight="bold" />
          )}
          Add
        </button>
        <span className="text-xs text-white/30 ml-auto">
          {titles.length === 0
            ? 'No job titles yet'
            : `${titles.length} title${titles.length === 1 ? '' : 's'}`}
        </span>
      </div>
      {createError && (
        <p className="text-sm text-red-400 mb-4">{createError}</p>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-white/40 text-sm py-12 justify-center">
          <CircleNotch size={16} className="animate-spin" />
          Loading job titles…
        </div>
      )}

      {isError && (
        <div className="text-sm text-red-400 py-8 text-center">
          Failed to load job titles.
        </div>
      )}

      {!isLoading && !isError && titles.length === 0 && (
        <div className="border border-dashed border-white/10 rounded-2xl py-16 text-center">
          <Briefcase size={28} weight="fill" className="text-white/30 mx-auto mb-3" />
          <p className="text-white/60 text-sm">No job titles yet.</p>
          <p className="text-white/30 text-xs mt-1">
            Add one to populate the job title picker on the signup form.
          </p>
        </div>
      )}

      {!isLoading && !isError && titles.length > 0 && (
        <div className="overflow-hidden border border-white/[0.08] rounded-2xl bg-[#111112]">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.03] text-white/40 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Label</th>
                <th className="text-left px-4 py-3 font-medium">Slug</th>
                <th className="text-left px-4 py-3 font-medium">Sort order</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {titles.map((jt) => (
                <tr key={jt.id} className="text-white/80">
                  <td className="px-4 py-3 font-medium text-white">
                    {jt.label}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-white/60">
                    {jt.slug}
                  </td>
                  <td className="px-4 py-3 text-xs text-white/50">
                    {jt.sort_order}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDeactivate(jt.id)}
                      disabled={deactivatingId !== null}
                      className="text-red-400/80 hover:text-red-400 text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {deactivatingId === jt.id
                        ? 'Deactivating…'
                        : 'Deactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deactivateError && (
        <p className="text-sm text-red-400 mt-4">{deactivateError}</p>
      )}

      <p className="text-xs text-white/30 mt-4">
        This list mirrors the public signup picker (active titles only).
        Deactivated titles disappear from both until an admin listing endpoint
        exists.
      </p>
    </div>
  )
}
