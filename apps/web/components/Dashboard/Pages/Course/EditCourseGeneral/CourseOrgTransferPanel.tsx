'use client'

// Course org transfer panel · shown on the course General settings tab.
// Lets an org admin duplicate the course into another organization they
// belong to, or move it there entirely (duplicate + delete source). The move
// is guarded server-side: 409 while learners have progress on the course.
import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, Copy, Loader2, MoveRight, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { apiFetch } from '@services/utils/ts/requests'
import { getAPIUrl } from '@services/config/config'
import { duplicateCourseToOrg, moveCourseToOrg } from '@services/courses/courses'
import { useTranslation } from 'react-i18next'
import {
  CustomSelect,
  CustomSelectContent,
  CustomSelectItem,
  CustomSelectTrigger,
  CustomSelectValue,
} from './CustomSelect'

type CourseOrgTransferPanelProps = {
  course_uuid: string
}

function CourseOrgTransferPanel({ course_uuid }: CourseOrgTransferPanelProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any

  const [targetOrgId, setTargetOrgId] = useState<string>('')
  const [busy, setBusy] = useState<'duplicate' | 'move' | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const { data: orgs } = useQuery({
    queryKey: ['orgs', 'user', 'transfer-panel'],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/user/page/1/limit/50`, access_token),
    enabled: !!access_token,
    staleTime: 60_000,
  })

  const otherOrgs: any[] = Array.isArray(orgs)
    ? orgs.filter((o: any) => o?.id !== org?.id)
    : []

  const run = async (mode: 'duplicate' | 'move', force = false) => {
    if (!targetOrgId) {
      setFeedback({ kind: 'err', text: t('dashboard.courses.general.transfer.pick_target', 'Choisissez une organisation cible.') })
      return
    }
    if (mode === 'move' && !force) {
      const ok = window.confirm(
        t(
          'dashboard.courses.general.transfer.move_confirm',
          'Déplacer ce cours le supprime de l\'organisation actuelle (fichiers inclus). Les progressions des apprenants ne sont pas transférées. Continuer ?'
        )
      )
      if (!ok) return
    }
    setBusy(mode)
    setFeedback(null)
    try {
      const res =
        mode === 'duplicate'
          ? await duplicateCourseToOrg(course_uuid, Number(targetOrgId), access_token)
          : await moveCourseToOrg(course_uuid, Number(targetOrgId), access_token, force)
      if (res.status === 200) {
        const name = res.data?.name || ''
        setFeedback({
          kind: 'ok',
          text:
            mode === 'duplicate'
              ? t('dashboard.courses.general.transfer.duplicated', 'Cours dupliqué : {{name}} (privé, non publié).', { name })
              : t('dashboard.courses.general.transfer.moved', 'Cours déplacé : {{name}}.', { name }),
        })
      } else if (res.status === 409) {
        const forceIt = window.confirm(
          t(
            'dashboard.courses.general.transfer.learners_warning',
            'Des apprenants ont de la progression sur ce cours. Le déplacement supprimera cette progression. Forcer le déplacement ?'
          )
        )
        if (forceIt) {
          setBusy(null)
          return run('move', true)
        }
        setFeedback({ kind: 'err', text: t('dashboard.courses.general.transfer.cancelled', 'Déplacement annulé.') })
      } else {
        const detail = res.data?.detail
        const text =
          typeof detail === 'string'
            ? detail
            : detail?.message || t('dashboard.courses.general.transfer.failed', 'L\'opération a échoué.')
        setFeedback({ kind: 'err', text })
      }
    } catch {
      setFeedback({ kind: 'err', text: t('dashboard.courses.general.transfer.failed', 'L\'opération a échoué.') })
    } finally {
      setBusy(null)
    }
  }

  if (otherOrgs.length === 0) return null

  return (
    <div className="mt-6 rounded-xl border border-[var(--ordria-border,#e4e4e7)] bg-white p-5">
      <div className="flex items-center gap-2">
        <Building2 size={16} className="opacity-60" />
        <h3 className="text-sm font-bold">
          {t('dashboard.courses.general.transfer.title', 'Transférer vers une autre organisation')}
        </h3>
      </div>
      <p className="mt-1 text-[13px] opacity-60">
        {t(
          'dashboard.courses.general.transfer.description',
          'Dupliquez ce cours (contenu, fichiers, devoirs) dans une autre organisation, ou déplacez-le : il sera alors supprimé de l\'organisation actuelle.'
        )}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="min-w-[240px] grow">
          <CustomSelect value={targetOrgId} onValueChange={(v) => v && setTargetOrgId(v)}>
            <CustomSelectTrigger className="w-full bg-white">
              <CustomSelectValue>
                {targetOrgId
                  ? otherOrgs.find((o) => String(o.id) === targetOrgId)?.name
                  : t('dashboard.courses.general.transfer.pick_target', 'Choisissez une organisation cible.')}
              </CustomSelectValue>
            </CustomSelectTrigger>
            <CustomSelectContent>
              {otherOrgs.map((o) => (
                <CustomSelectItem key={o.id} value={String(o.id)}>
                  {o.name}
                </CustomSelectItem>
              ))}
            </CustomSelectContent>
          </CustomSelect>
        </div>
        <button
          onClick={() => run('duplicate')}
          disabled={busy !== null || !targetOrgId}
          className="inline-flex h-[38px] items-center gap-2 rounded-lg bg-[var(--ordria-accent,#111827)] px-4 text-[13px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-40"
        >
          {busy === 'duplicate' ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
          {t('dashboard.courses.general.transfer.duplicate', 'Dupliquer')}
        </button>
        <button
          onClick={() => run('move')}
          disabled={busy !== null || !targetOrgId}
          className="inline-flex h-[38px] items-center gap-2 rounded-lg border border-[var(--ordria-border,#e4e4e7)] bg-white px-4 text-[13px] font-semibold transition-colors hover:bg-black/[0.03] disabled:opacity-40"
        >
          {busy === 'move' ? <Loader2 size={14} className="animate-spin" /> : <MoveRight size={14} />}
          {t('dashboard.courses.general.transfer.move', 'Déplacer')}
        </button>
      </div>
      {feedback && (
        <div
          className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[13px] ${
            feedback.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {feedback.kind === 'ok' ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
          <span>{feedback.text}</span>
        </div>
      )}
    </div>
  )
}

export default CourseOrgTransferPanel
